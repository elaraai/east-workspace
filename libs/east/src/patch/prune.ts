/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Patch pruning — drop leaves from a patch by path predicate.
 *
 * @remarks
 * `prunePatchFor(type)(patch, keep)` returns a copy of `patch` where every
 * leaf for which `keep(path) === false` is collapsed to `unchanged`. Empty
 * container patches (whose every descendant was dropped) cascade up the
 * tree — a struct patch with all-unchanged fields, an array patch with
 * zero ops, etc. all collapse to `unchanged` themselves.
 *
 * Round-trip invariants:
 *   - `applyFor(t)(v, prunePatchFor(t)(p, () => true))` ≡ `applyFor(t)(v, p)`
 *     (keep-all is identity)
 *   - `applyFor(t)(v, prunePatchFor(t)(p, () => false))` ≡ `v`
 *     (keep-none is no-op)
 *
 * Common use cases:
 *   - Diff-review UIs: filter out leaves the user has rejected before
 *     applying / committing the patch.
 *   - Conflict-resolution flows: project a patch onto a subset of its
 *     leaves to merge piecemeal.
 *
 * @example
 * ```ts
 * import { diffFor, applyFor, prunePatchFor, pathToString, StructType, IntegerType, FloatType } from "@elaraai/east";
 *
 * const PolicyType = StructType({ maxHours: IntegerType, penalty: FloatType });
 * const before = { maxHours: 38n, penalty: 1.5 };
 * const after  = { maxHours: 40n, penalty: 2.0 };
 *
 * const patch = diffFor(PolicyType)(before, after);
 * // Keep only the `penalty` change — drop `maxHours`.
 * const pruned = prunePatchFor(PolicyType)(patch, p => pathToString(p) === "penalty");
 * const result = applyFor(PolicyType)(before, pruned);
 * // result.maxHours === 38n  (unchanged — the maxHours leaf was pruned)
 * // result.penalty === 2.0   (kept)
 * ```
 *
 * @packageDocumentation
 */

import type { EastTypeValue } from "../type_of_type.js";
import { toEastTypeValue } from "../type_of_type.js";
import { isVariant, variant, type variant as VariantValue } from "../containers/variant.js";
import type { EastType } from "../types.js";
import { printFor } from "../serialization/east.js";
import { SortedMap } from "../containers/sortedmap.js";
import { compareFor } from "../comparison.js";
import {
    type PatchPath,
    field,
    index,
    dictKey,
    variantTag,
} from "./path.js";

/** Any patch variant — patches are always east `variant("unchanged"|"replace"|"patch", v)`. */
type AnyPatch = VariantValue<string, any>;

/** Array op shape inside an array patch's `value` payload. */
interface ArrayOp { key: bigint; offset: bigint; operation: AnyPatch }

/**
 * Predicate the caller supplies to {@link prunePatchFor}. Returns `true` to
 * keep the leaf at the given path, `false` to collapse it back to
 * `unchanged`.
 */
export type PrunePredicate = (path: PatchPath) => boolean;

const UNCHANGED = variant("unchanged", null);

/**
 * Build a closure that prunes patches against a path predicate.
 *
 * @typeParam T - East type the patch was computed against. The inferred
 *   value type matches `applyFor<T>` so chaining with `applyFor` doesn't
 *   require casts.
 *
 * @param type - The east type the patch corresponds to. Accepts an
 *   `EastType` (e.g. `StructType({...})`) or a runtime `EastTypeValue`.
 * @returns A closure `(patch, keep) → prunedPatch`.
 *
 * @example
 * ```ts
 * const prune = prunePatchFor(MyType);
 * const pruned = prune(myPatch, path => !rejectedPaths.has(pathToString(path)));
 * ```
 */
export function prunePatchFor(type: EastTypeValue): (patch: AnyPatch, keep: PrunePredicate) => AnyPatch;
export function prunePatchFor<T extends EastType>(type: T): (patch: AnyPatch, keep: PrunePredicate) => AnyPatch;
export function prunePatchFor(type: EastType | EastTypeValue): (patch: AnyPatch, keep: PrunePredicate) => AnyPatch {
    const t = isVariant(type) ? type : toEastTypeValue(type as EastType);
    return (patch: AnyPatch, keep: PrunePredicate) => prune(t, patch, [], keep);
}

// ============================================================================
// Internal recursion
// ============================================================================

function prune(type: EastTypeValue, patch: AnyPatch, path: PatchPath, keep: PrunePredicate): AnyPatch {
    if (patch.type === "unchanged") return patch;
    if (patch.type === "replace") return keep(path) ? patch : UNCHANGED;

    // patch.type === "patch"
    switch (type.type) {
        case "Struct":  return pruneStruct(type, patch.value, path, keep);
        case "Array":   return pruneArray(type, patch.value, path, keep);
        case "Dict":    return pruneDict(type, patch.value, path, keep);
        case "Set":     return pruneSet(type, patch.value, path, keep);
        case "Variant": return pruneVariant(type, patch.value, path, keep);
        case "Ref":     {
            const inner = prune(type.value as EastTypeValue, patch.value, path, keep);
            return inner.type === "unchanged" ? UNCHANGED : variant("patch", inner);
        }
        default:        return patch;
    }
}

function pruneStruct(type: EastTypeValue, patchSub: Record<string, AnyPatch>, path: PatchPath, keep: PrunePredicate): AnyPatch {
    const fields = type.value as Array<{ name: string; type: EastTypeValue }>;
    const next: Record<string, AnyPatch> = {};
    let anyChanged = false;
    for (const { name: fname, type: ftype } of fields) {
        const child = patchSub[fname];
        if (child === undefined) continue;
        const pruned = prune(ftype, child, [...path, field(fname)], keep);
        next[fname] = pruned;
        if (pruned.type !== "unchanged") anyChanged = true;
    }
    return anyChanged ? variant("patch", next) : UNCHANGED;
}

function pruneArray(type: EastTypeValue, ops: ArrayOp[], path: PatchPath, keep: PrunePredicate): AnyPatch {
    const elemType = type.value as EastTypeValue;
    const opsOut: ArrayOp[] = [];
    for (const op of ops) {
        const subPath: PatchPath = [...path, index(op.key)];
        const inner = op.operation;
        if (inner.type === "update") {
            const pruned = prune(elemType, inner.value, subPath, keep);
            if (pruned.type !== "unchanged") {
                opsOut.push({
                    key: op.key,
                    offset: op.offset,
                    operation: variant("update", pruned),
                });
            }
        } else if (keep(subPath)) {
            opsOut.push(op);
        }
    }
    return opsOut.length > 0 ? variant("patch", opsOut) : UNCHANGED;
}

function pruneDict(type: EastTypeValue, patchSub: SortedMap<unknown, AnyPatch>, path: PatchPath, keep: PrunePredicate): AnyPatch {
    const keyType = (type.value as { key: EastTypeValue }).key;
    const valueType = (type.value as { value: EastTypeValue }).value;
    const keyPrint = printFor(keyType);
    const out = new SortedMap<unknown, AnyPatch>(undefined, compareFor(keyType));
    for (const [k, op] of patchSub) {
        const subPath: PatchPath = [...path, dictKey(keyPrint(k))];
        if (op.type === "update") {
            const pruned = prune(valueType, op.value, subPath, keep);
            if (pruned.type !== "unchanged") {
                out.set(k, variant("update", pruned));
            }
        } else if (keep(subPath)) {
            out.set(k, op);
        }
    }
    return out.size > 0 ? variant("patch", out) : UNCHANGED;
}

function pruneSet(type: EastTypeValue, patchSub: SortedMap<unknown, AnyPatch>, path: PatchPath, keep: PrunePredicate): AnyPatch {
    const elemType = type.value as EastTypeValue;
    const keyPrint = printFor(elemType);
    const out = new SortedMap<unknown, AnyPatch>(undefined, compareFor(elemType));
    for (const [k, op] of patchSub) {
        const subPath: PatchPath = [...path, dictKey(keyPrint(k))];
        if (keep(subPath)) out.set(k, op);
    }
    return out.size > 0 ? variant("patch", out) : UNCHANGED;
}

function pruneVariant(type: EastTypeValue, patchSub: AnyPatch, path: PatchPath, keep: PrunePredicate): AnyPatch {
    const cases = type.value as Array<{ name: string; type: EastTypeValue }>;
    const sub = cases.find(c => c.name === patchSub.type);
    if (!sub) return variant("patch", patchSub);
    const pruned = prune(sub.type, patchSub.value, [...path, variantTag(patchSub.type)], keep);
    return pruned.type === "unchanged"
        ? UNCHANGED
        : variant("patch", variant(patchSub.type, pruned));
}