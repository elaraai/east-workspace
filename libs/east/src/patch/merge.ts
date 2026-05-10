/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Patch merge — 3-way merge of two patches against the same base.
 *
 * Given a snapshot S and two patches P_A, P_B both diffed against S, produce
 * a single patch P_merged that captures the intent of both A and B. Where the
 * two patches touch the same leaf with different intents, that is a conflict.
 *
 * Three operation modes:
 *   - {@link mergeFor}                — throws ConflictError on any conflict
 *   - {@link detectConflictsFor}      — returns the list of conflicts (no throw)
 *   - {@link mergeWithResolutionsFor} — applies caller-supplied per-path
 *     resolutions (`keepA` / `keepB` / `manual`); throws if any unresolved
 *
 * @module
 */

import { toEastTypeValue, type EastTypeValue } from "../type_of_type.js";
import type { EastType } from "../types.js";
import { isVariant, variant, type variant as VariantValue } from "../containers/variant.js";
import { equalFor, compareFor } from "../comparison.js";
import { printFor } from "../serialization/east.js";
import { SortedMap } from "../containers/sortedmap.js";
import { type MergeContext, type Conflict, type Resolution, ConflictError } from "./types.js";
import {
    joinField as join,
    joinIndex as arrayIdx,
    joinKey as dictKey,
    joinVariant as variantTag,
} from "./path.js";

// ============================================================================
// Internal walker types
// ============================================================================

type AnyVariant = VariantValue<string, any>;
type ConflictAcc = (path: string, valueA: AnyVariant, valueB: AnyVariant) => void;
type Lookup = (path: string) => Resolution | undefined;

type MergeWalker = (
  a: AnyVariant,
  b: AnyVariant,
  path: string,
  acc: ConflictAcc,
  lookup: Lookup | null,
) => AnyVariant;

interface ResolutionResolved { resolved: true; value: AnyVariant; }
interface ResolutionUnresolved { resolved: false; }

/**
 * Apply a caller-supplied resolution at a conflict point.
 *
 * `keepA` / `keepB` return the corresponding patch arm verbatim. `manual`
 * synthesises a `replace { before, after }` where `before` is extracted from
 * either patch's `before` slot (both patches share the same snapshot, so the
 * before is well-defined when at least one arm is `replace`). When neither
 * arm is `replace` (e.g. structural patch+patch with cross-tag variant or
 * disjoint key sets), `manual` cannot be honoured — caller must use
 * `keepA` / `keepB` at non-leaf conflicts. We surface this by returning
 * `unresolved`, which causes the caller to record the conflict.
 */
function applyResolution(
  a: AnyVariant,
  b: AnyVariant,
  path: string,
  lookup: Lookup | null,
): ResolutionResolved | ResolutionUnresolved {
  if (!lookup) return { resolved: false };
  const r = lookup(path);
  if (!r) return { resolved: false };
  if (r.type === "keepA") return { resolved: true, value: a };
  if (r.type === "keepB") return { resolved: true, value: b };
  // manual: requires a `before` from either arm (i.e. at least one is replace).
  const before =
    a.type === "replace" ? a.value.before
    : b.type === "replace" ? b.value.before
    : undefined;
  if (before === undefined) {
    return { resolved: false };
  }
  return { resolved: true, value: variant("replace", { before, after: r.value }) };
}

// ============================================================================
// Workhorse: builds the recursive walker for a given East type.
// ============================================================================

function buildWalker(t: EastTypeValue, ctx: MergeContext): MergeWalker {
  if (t.type === "Never") {
    return () => { throw new Error("Cannot merge patches for type Never"); };
  }

  // ----- Primitives + Vector + Matrix -----
  if (
    t.type === "Null"     || t.type === "Boolean" || t.type === "Integer" ||
    t.type === "Float"    || t.type === "String"  || t.type === "DateTime" ||
    t.type === "Blob"     || t.type === "Vector"  || t.type === "Matrix"
  ) {
    const valueEqual = equalFor(t, ctx.equal);
    return (a, b, path, acc, lookup) => {
      if (a.type === "unchanged" && b.type === "unchanged") return variant("unchanged", null);
      if (a.type === "unchanged") return b;
      if (b.type === "unchanged") return a;
      // both replace
      if (valueEqual(a.value.after, b.value.after)) return a;
      const r = applyResolution(a, b, path, lookup);
      if (r.resolved) return r.value;
      acc(path, a, b);
      return a;
    };
  }

  // ----- Array -----
  if (t.type === "Array") {
    let elementMerge!: MergeWalker;
    let elementEqual!: (x: any, y: any) => boolean;
    let arrayValueEqual!: (x: any, y: any) => boolean;

    const ret: MergeWalker = (a, b, path, acc, lookup) => {
      if (a.type === "unchanged" && b.type === "unchanged") return variant("unchanged", null);
      if (a.type === "unchanged") return b;
      if (b.type === "unchanged") return a;

      // both replace — converge if same after, else conflict
      if (a.type === "replace" && b.type === "replace") {
        if (arrayValueEqual(a.value.after, b.value.after)) return a;
        const r = applyResolution(a, b, path, lookup);
        if (r.resolved) return r.value;
        acc(path, a, b);
        return a;
      }

      // mixed replace+patch — conflict at this level; we don't auto-merge
      if (a.type !== b.type) {
        const r = applyResolution(a, b, path, lookup);
        if (r.resolved) return r.value;
        acc(path, a, b);
        return a;
      }

      // both patch — index ops by destination index, look for overlaps.
      const aOps = a.value as any[];
      const bOps = b.value as any[];

      // Bucket ops by destination index only. Same dest with same tag is
      // mergeable; same dest with different tags is a conflict surfaced at
      // the [N] path so the caller can resolve via keepA / keepB / manual.
      const destKey = (op: any): string =>
        String((op.key as bigint) + (op.offset as bigint));

      const aMap = new Map<string, any>();
      const bMap = new Map<string, any>();
      for (const op of aOps) aMap.set(destKey(op), op);
      for (const op of bOps) bMap.set(destKey(op), op);

      const merged: any[] = [];
      const allKeys = new Set<string>([...aMap.keys(), ...bMap.keys()]);

      for (const k of allKeys) {
        const opA = aMap.get(k);
        const opB = bMap.get(k);
        if (opA && !opB) { merged.push(opA); continue; }
        if (opB && !opA) { merged.push(opB); continue; }
        // Both have ops at this destination key.
        // Mixed op kinds at the same dest — surface as a conflict at [N].
        if (opA.operation.type !== opB.operation.type) {
          const subPath = arrayIdx(path, opA.key);
          const r = applyResolution(opA.operation, opB.operation, subPath, lookup);
          if (r.resolved) {
            merged.push({ key: opA.key, offset: opA.offset, operation: r.value });
          } else {
            acc(subPath, opA.operation, opB.operation);
            // Default to keeping arm A's op so the patch shape stays
            // applicable until the caller resolves.
            merged.push(opA);
          }
          continue;
        }
        const tag = opA.operation.type as "delete" | "insert" | "update";
        if (tag === "delete") {
          // both delete — values must agree (apply would already check, but be
          // defensive)
          if (elementEqual(opA.operation.value, opB.operation.value)) {
            merged.push(opA);
          } else {
            const subPath = arrayIdx(path, opA.key);
            const r = applyResolution(opA.operation, opB.operation, subPath, lookup);
            if (r.resolved) {
              merged.push({ key: opA.key, offset: opA.offset, operation: r.value });
            } else {
              acc(subPath, opA, opB);
              merged.push(opA);
            }
          }
        } else if (tag === "insert") {
          if (elementEqual(opA.operation.value, opB.operation.value)) {
            merged.push(opA);
          } else {
            const subPath = arrayIdx(path, opA.key);
            const r = applyResolution(opA.operation, opB.operation, subPath, lookup);
            if (r.resolved) {
              merged.push({ key: opA.key, offset: opA.offset, operation: r.value });
            } else {
              acc(subPath, opA, opB);
              merged.push(opA);
            }
          }
        } else {
          // update — always recurse into element merge; sub-walker handles
          // identical-replace convergence at the leaves.
          const sub = elementMerge(
            opA.operation.value as AnyVariant,
            opB.operation.value as AnyVariant,
            arrayIdx(path, opA.key),
            acc,
            lookup,
          );
          merged.push({
            key: opA.key,
            offset: opA.offset,
            operation: variant("update", sub),
          });
        }
      }

      if (merged.length === 0) return variant("unchanged", null);
      return variant("patch", merged);
    };

    // Push self into ctx, recurse for element walkers, pop.
    ctx.merge.push(ret);
    ctx.types.push(t);
    elementMerge = buildWalker(t.value, ctx);
    elementEqual = equalFor(t.value, ctx.equal);
    arrayValueEqual = equalFor(t, ctx.equal);
    ctx.merge.pop();
    ctx.types.pop();
    return ret;
  }

  // ----- Set -----
  if (t.type === "Set") {
    const keyCompare = compareFor(t.value);
    const keyPrint = printFor(t.value);
    const setValueEqual = equalFor(t, ctx.equal);

    return (a, b, path, acc, lookup) => {
      if (a.type === "unchanged" && b.type === "unchanged") return variant("unchanged", null);
      if (a.type === "unchanged") return b;
      if (b.type === "unchanged") return a;

      if (a.type === "replace" && b.type === "replace") {
        if (setValueEqual(a.value.after, b.value.after)) return a;
        const r = applyResolution(a, b, path, lookup);
        if (r.resolved) return r.value;
        acc(path, a, b);
        return a;
      }

      if (a.type !== b.type) {
        const r = applyResolution(a, b, path, lookup);
        if (r.resolved) return r.value;
        acc(path, a, b);
        return a;
      }

      // both patch — Dict<K, {delete | insert}>
      const aMap = a.value as SortedMap<any, any>;
      const bMap = b.value as SortedMap<any, any>;
      const merged = new SortedMap<any, any>(undefined, keyCompare);

      for (const [k, op] of aMap) merged.set(k, op);
      for (const [k, op] of bMap) {
        if (merged.has(k)) {
          const opA = merged.get(k)!;
          if (opA.type === op.type) continue;          // same op, idempotent
          const subPath = dictKey(path, keyPrint(k));
          const r = applyResolution(opA, op, subPath, lookup);
          if (r.resolved) {
            merged.set(k, r.value);
          } else {
            acc(subPath, opA, op);
            // leave opA in place as the default merged value
          }
        } else {
          merged.set(k, op);
        }
      }

      if (merged.size === 0) return variant("unchanged", null);
      return variant("patch", merged);
    };
  }

  // ----- Dict -----
  if (t.type === "Dict") {
    let valueMerge!: MergeWalker;
    let valueEqual!: (x: any, y: any) => boolean;
    let dictValueEqual!: (x: any, y: any) => boolean;
    const keyCompare = compareFor(t.value.key);
    const keyPrint = printFor(t.value.key);

    const ret: MergeWalker = (a, b, path, acc, lookup) => {
      if (a.type === "unchanged" && b.type === "unchanged") return variant("unchanged", null);
      if (a.type === "unchanged") return b;
      if (b.type === "unchanged") return a;

      if (a.type === "replace" && b.type === "replace") {
        if (dictValueEqual(a.value.after, b.value.after)) return a;
        const r = applyResolution(a, b, path, lookup);
        if (r.resolved) return r.value;
        acc(path, a, b);
        return a;
      }

      if (a.type !== b.type) {
        const r = applyResolution(a, b, path, lookup);
        if (r.resolved) return r.value;
        acc(path, a, b);
        return a;
      }

      // both patch — Dict<K, {delete | insert | update}>
      const aMap = a.value as SortedMap<any, any>;
      const bMap = b.value as SortedMap<any, any>;
      const merged = new SortedMap<any, any>(undefined, keyCompare);

      for (const [k, op] of aMap) merged.set(k, op);
      for (const [k, op] of bMap) {
        const subPath = dictKey(path, keyPrint(k));
        if (merged.has(k)) {
          const opA = merged.get(k)!;
          if (opA.type === "insert" && op.type === "insert" && valueEqual(opA.value, op.value)) {
            continue;
          }
          if (opA.type === "delete" && op.type === "delete") continue;
          if (opA.type === "update" && op.type === "update") {
            // Always recurse — sub-walker handles identical-replace convergence.
            const sub = valueMerge(opA.value as AnyVariant, op.value as AnyVariant, subPath, acc, lookup);
            if (sub.type === "unchanged") {
              merged.delete(k);
            } else {
              merged.set(k, variant("update", sub));
            }
            continue;
          }
          // any other combo (or insert+insert with different values) → conflict
          const r = applyResolution(opA, op, subPath, lookup);
          if (r.resolved) {
            merged.set(k, r.value);
          } else {
            acc(subPath, opA, op);
            // leave opA in place
          }
        } else {
          merged.set(k, op);
        }
      }

      if (merged.size === 0) return variant("unchanged", null);
      return variant("patch", merged);
    };

    ctx.merge.push(ret);
    ctx.types.push(t);
    valueMerge = buildWalker(t.value.value, ctx);
    valueEqual = equalFor(t.value.value, ctx.equal);
    dictValueEqual = equalFor(t, ctx.equal);
    ctx.merge.pop();
    ctx.types.pop();
    return ret;
  }

  // ----- Struct -----
  if (t.type === "Struct") {
    const fieldMerges: Record<string, MergeWalker> = {};
    let structValueEqual!: (x: any, y: any) => boolean;

    const ret: MergeWalker = (a, b, path, acc, lookup) => {
      if (a.type === "unchanged" && b.type === "unchanged") return variant("unchanged", null);
      if (a.type === "unchanged") return b;
      if (b.type === "unchanged") return a;

      if (a.type === "replace" && b.type === "replace") {
        if (structValueEqual(a.value.after, b.value.after)) return a;
        const r = applyResolution(a, b, path, lookup);
        if (r.resolved) return r.value;
        acc(path, a, b);
        return a;
      }

      if (a.type !== b.type) {
        const r = applyResolution(a, b, path, lookup);
        if (r.resolved) return r.value;
        acc(path, a, b);
        return a;
      }

      // both patch — recurse field-by-field
      const fa = a.value as Record<string, AnyVariant>;
      const fb = b.value as Record<string, AnyVariant>;
      const result: Record<string, AnyVariant> = {};
      let allUnchanged = true;
      for (const { name } of t.value) {
        const sub = fieldMerges[name]!(fa[name]!, fb[name]!, join(path, name), acc, lookup);
        result[name] = sub;
        if (sub.type !== "unchanged") allUnchanged = false;
      }
      if (allUnchanged) return variant("unchanged", null);
      return variant("patch", result);
    };

    ctx.merge.push(ret);
    ctx.types.push(t);
    structValueEqual = equalFor(t, ctx.equal);
    for (const { name, type: fieldType } of t.value) {
      fieldMerges[name] = buildWalker(fieldType, ctx);
    }
    ctx.merge.pop();
    ctx.types.pop();
    return ret;
  }

  // ----- Variant -----
  if (t.type === "Variant") {
    const caseMerges: Record<string, MergeWalker> = {};
    let variantValueEqual!: (x: any, y: any) => boolean;

    const ret: MergeWalker = (a, b, path, acc, lookup) => {
      if (a.type === "unchanged" && b.type === "unchanged") return variant("unchanged", null);
      if (a.type === "unchanged") return b;
      if (b.type === "unchanged") return a;

      if (a.type === "replace" && b.type === "replace") {
        if (variantValueEqual(a.value.after, b.value.after)) return a;
        const r = applyResolution(a, b, path, lookup);
        if (r.resolved) return r.value;
        acc(path, a, b);
        return a;
      }

      if (a.type !== b.type) {
        const r = applyResolution(a, b, path, lookup);
        if (r.resolved) return r.value;
        acc(path, a, b);
        return a;
      }

      // both patch — value is a variant<caseTag, sub>
      const ai = a.value as AnyVariant;
      const bi = b.value as AnyVariant;
      if (ai.type !== bi.type) {
        const r = applyResolution(a, b, variantTag(path, ai.type), lookup);
        if (r.resolved) return r.value;
        acc(variantTag(path, ai.type), a, b);
        return a;
      }
      const sub = caseMerges[ai.type]!(
        ai.value as AnyVariant,
        bi.value as AnyVariant,
        variantTag(path, ai.type),
        acc,
        lookup,
      );
      if (sub.type === "unchanged") return variant("unchanged", null);
      return variant("patch", variant(ai.type, sub));
    };

    ctx.merge.push(ret);
    ctx.types.push(t);
    variantValueEqual = equalFor(t, ctx.equal);
    for (const { name, type: caseType } of t.value) {
      caseMerges[name] = buildWalker(caseType, ctx);
    }
    ctx.merge.pop();
    ctx.types.pop();
    return ret;
  }

  // ----- Ref -----
  if (t.type === "Ref") {
    let innerMerge!: MergeWalker;
    let refValueEqual!: (x: any, y: any) => boolean;

    const ret: MergeWalker = (a, b, path, acc, lookup) => {
      if (a.type === "unchanged" && b.type === "unchanged") return variant("unchanged", null);
      if (a.type === "unchanged") return b;
      if (b.type === "unchanged") return a;

      if (a.type === "replace" && b.type === "replace") {
        if (refValueEqual(a.value.after, b.value.after)) return a;
        const r = applyResolution(a, b, path, lookup);
        if (r.resolved) return r.value;
        acc(path, a, b);
        return a;
      }

      if (a.type !== b.type) {
        const r = applyResolution(a, b, path, lookup);
        if (r.resolved) return r.value;
        acc(path, a, b);
        return a;
      }

      // both patch — recurse into inner
      const sub = innerMerge(a.value as AnyVariant, b.value as AnyVariant, path, acc, lookup);
      if (sub.type === "unchanged") return variant("unchanged", null);
      return variant("patch", sub);
    };

    ctx.merge.push(ret);
    ctx.types.push(t);
    innerMerge = buildWalker(t.value, ctx);
    refValueEqual = equalFor(t, ctx.equal);
    ctx.merge.pop();
    ctx.types.pop();
    return ret;
  }

  // ----- Recursive (replace-only) -----
  if (t.type === "Recursive") {
    const recursiveValueEqual = equalFor(t, ctx.equal);
    return (a, b, path, acc, lookup) => {
      if (a.type === "unchanged" && b.type === "unchanged") return variant("unchanged", null);
      if (a.type === "unchanged") return b;
      if (b.type === "unchanged") return a;
      if (a.type === "replace" && b.type === "replace") {
        if (recursiveValueEqual(a.value.after, b.value.after)) return a;
        const r = applyResolution(a, b, path, lookup);
        if (r.resolved) return r.value;
        acc(path, a, b);
        return a;
      }
      throw new Error(`Invalid patch types for recursive merge: ${a.type}, ${b.type}`);
    };
  }

  // ----- Function / AsyncFunction -----
  if (t.type === "Function" || t.type === "AsyncFunction") {
    return (a, b, path, acc, lookup) => {
      if (a.type === "unchanged" && b.type === "unchanged") return variant("unchanged", null);
      if (a.type === "unchanged") return b;
      if (b.type === "unchanged") return a;
      // Function values aren't structurally comparable — always conflict on
      // diverging replaces; resolution flow handles.
      const r = applyResolution(a, b, path, lookup);
      if (r.resolved) return r.value;
      acc(path, a, b);
      return a;
    };
  }

  throw new Error(`Unhandled type in mergeFor: ${(t as EastTypeValue).type}`);
}

// ============================================================================
// Public entrypoints
// ============================================================================

function freshContext(): MergeContext {
  return { merge: [], types: [], equal: new Map() };
}

function normalizeType(type: EastTypeValue | EastType): EastTypeValue {
  return isVariant(type) ? type : toEastTypeValue(type as EastType);
}

/**
 * Build a merge function for a given East type. Returns a closure
 * `(patchA, patchB) => merged`. Throws {@link ConflictError} if any leaf in
 * the two patches conflicts (i.e. both patches touch the same leaf with
 * incompatible operations).
 *
 * For conflict-tolerant merging, use {@link detectConflictsFor} or
 * {@link mergeWithResolutionsFor}.
 */
export function mergeFor(type: EastTypeValue, ctx?: MergeContext): (a: any, b: any) => any;
export function mergeFor<T extends EastType>(type: T): (a: any, b: any) => any;
export function mergeFor(type: EastTypeValue | EastType, ctx: MergeContext = freshContext()): (a: any, b: any) => any {
  const walker = buildWalker(normalizeType(type), ctx);
  return (a: AnyVariant, b: AnyVariant) => {
    const conflicts: Conflict[] = [];
    const merged = walker(
      a, b, "",
      (path, valueA, valueB) => conflicts.push({ path, valueA, valueB }),
      null,
    );
    if (conflicts.length > 0) {
      throw new ConflictError(`Cannot merge patches: ${conflicts.length} conflict(s)`, conflicts);
    }
    return merged;
  };
}

/**
 * Build a function that detects conflicts between two patches without
 * attempting to merge. Pure observation — never throws.
 *
 * Returns the list of {@link Conflict} descriptors, each carrying the
 * dot/bracket-encoded `path` to the conflicting leaf and both `valueA` /
 * `valueB` patch arms at that path.
 */
export function detectConflictsFor(type: EastTypeValue, ctx?: MergeContext): (a: any, b: any) => Conflict[];
export function detectConflictsFor<T extends EastType>(type: T): (a: any, b: any) => Conflict[];
export function detectConflictsFor(type: EastTypeValue | EastType, ctx: MergeContext = freshContext()): (a: any, b: any) => Conflict[] {
  const walker = buildWalker(normalizeType(type), ctx);
  return (a: AnyVariant, b: AnyVariant) => {
    const conflicts: Conflict[] = [];
    walker(
      a, b, "",
      (path, valueA, valueB) => conflicts.push({ path, valueA, valueB }),
      null,
    );
    return conflicts;
  };
}

/**
 * Build a merge function that consumes caller-supplied per-conflict
 * resolutions. The `resolutions` map is keyed on `Conflict.path` strings; for
 * each conflict, the corresponding {@link Resolution} dictates whether
 * patchA's value, patchB's value, or a manual replacement is used.
 *
 * Throws {@link ConflictError} if any conflict has no matching resolution
 * (or if a `manual` resolution targets a non-leaf where no `before` is
 * available — see `applyResolution` JSDoc in the source).
 */
export function mergeWithResolutionsFor(
  type: EastTypeValue,
  ctx?: MergeContext,
): (a: any, b: any, resolutions: Map<string, Resolution>) => any;
export function mergeWithResolutionsFor<T extends EastType>(
  type: T,
): (a: any, b: any, resolutions: Map<string, Resolution>) => any;
export function mergeWithResolutionsFor(
  type: EastTypeValue | EastType,
  ctx: MergeContext = freshContext(),
): (a: any, b: any, resolutions: Map<string, Resolution>) => any {
  const walker = buildWalker(normalizeType(type), ctx);
  return (a: AnyVariant, b: AnyVariant, resolutions: Map<string, Resolution>) => {
    const unresolved: Conflict[] = [];
    const merged = walker(
      a, b, "",
      (path, valueA, valueB) => unresolved.push({ path, valueA, valueB }),
      (path) => resolutions.get(path),
    );
    if (unresolved.length > 0) {
      throw new ConflictError(
        `Cannot merge: ${unresolved.length} unresolved conflict(s)`,
        unresolved,
      );
    }
    return merged;
  };
}
