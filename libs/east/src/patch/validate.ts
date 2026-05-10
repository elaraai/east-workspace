/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `validatePatchFor` — non-throwing per-leaf validation of a patch against a
 * base value. Returns the list of paths where the patch's expected `before`
 * (or expected key presence/absence) disagrees with `base`'s actual value.
 *
 * This fills the gap between `applyFor` (which throws on the first stale op,
 * losing per-leaf granularity) and `mergeFor` (which compares two patches
 * against a common ancestor — different problem).
 *
 * Empty result list ⇒ `applyFor(type)(base, patch)` would succeed cleanly.
 *
 * @module
 */

import { toEastTypeValue, type EastTypeValue } from "../type_of_type.js";
import type { EastType } from "../types.js";
import { isVariant } from "../containers/variant.js";
import { equalFor } from "../comparison.js";
import { printFor } from "../serialization/east.js";
import {
  type PatchPath,
  field as structField,
  index as arrayIndex,
  dictKey,
  variantTag,
} from "./path.js";

/**
 * One per-leaf disagreement between a patch and a base value.
 *
 * @property path     - structured path from the root of the base/patch.
 * @property op       - which patch operation didn't apply cleanly.
 * @property expected - what the patch expected at this path.
 *                      For `replace`/`delete`/`update`: the patch's `before`.
 *                      For `insert`: `undefined` (insert expects absence).
 * @property actual   - what the base actually has at this path.
 *                      `undefined` when the key/index is missing.
 */
export interface PatchConflict {
  readonly path: PatchPath;
  readonly op: "replace" | "delete" | "insert" | "update";
  readonly expected: unknown;
  readonly actual: unknown;
}

/**
 * Build a validator for patches over `type`. The returned closure walks
 * `base` and `patch` in parallel and accumulates per-leaf conflicts; never
 * throws. Empty result ⇒ patch applies cleanly.
 */
export function validatePatchFor(type: EastTypeValue | EastType): (base: any, patch: any) => PatchConflict[] {
  const t: EastTypeValue = isVariant(type) ? type : toEastTypeValue(type as EastType);
  return (base: any, patch: any) => {
    const out: PatchConflict[] = [];
    walk(t, base, patch, [], out);
    return out;
  };
}

function walk(t: EastTypeValue, base: any, patch: any, path: PatchPath, out: PatchConflict[]): void {
  if (!patch || patch.type === "unchanged") return;

  if (patch.type === "replace") {
    if (!equalFor(t)(base, patch.value.before)) {
      out.push({ path, op: "replace", expected: patch.value.before, actual: base });
    }
    return;
  }

  // patch.type === "patch" — descend per container kind.
  switch (t.type) {
    case "Struct":  walkStruct(t, base, patch.value, path, out); return;
    case "Array":   walkArray(t, base, patch.value, path, out); return;
    case "Dict":    walkDict(t, base, patch.value, path, out); return;
    case "Set":     walkSet(t, base, patch.value, path, out); return;
    case "Variant": walkVariant(t, base, patch.value, path, out); return;
    case "Ref":     walk(t.value as EastTypeValue, base, patch.value, path, out); return;
    default: return;
  }
}

function walkStruct(t: EastTypeValue, base: any, sub: any, path: PatchPath, out: PatchConflict[]): void {
  const fields = t.value as Array<{ name: string; type: EastTypeValue }>;
  for (const f of fields) {
    const fieldPatch = sub?.[f.name];
    if (fieldPatch === undefined) continue;
    walk(f.type, base?.[f.name], fieldPatch, [...path, structField(f.name)], out);
  }
}

function walkArray(t: EastTypeValue, base: any[], ops: any[], path: PatchPath, out: PatchConflict[]): void {
  const elemT = t.value as EastTypeValue;
  const elemEqual = equalFor(elemT);
  // Track the running offset so subsequent ops see the right destination
  // index — same as applyFor's logic. We don't actually mutate `base`.
  let runningOffset = 0;
  for (const op of ops) {
    const key = Number(op.key);
    const offset = Number(op.offset);
    const idx = key + offset;
    const subPath = [...path, arrayIndex(BigInt(idx))];
    if (op.operation.type === "delete") {
      const actualIdx = key + runningOffset;
      if (actualIdx < 0 || actualIdx >= base.length) {
        out.push({ path: subPath, op: "delete", expected: op.operation.value, actual: undefined });
      } else if (!elemEqual(base[actualIdx], op.operation.value)) {
        out.push({ path: subPath, op: "delete", expected: op.operation.value, actual: base[actualIdx] });
      }
      runningOffset -= 1;
    } else if (op.operation.type === "insert") {
      // Insert expects nothing at the destination — array can't conflict
      // structurally. Position validation is `applyFor`'s concern.
      runningOffset += 1;
    } else if (op.operation.type === "update") {
      const actualIdx = key + runningOffset;
      if (actualIdx < 0 || actualIdx >= base.length) {
        out.push({ path: subPath, op: "update", expected: undefined, actual: undefined });
      } else {
        walk(elemT, base[actualIdx], op.operation.value, subPath, out);
      }
    }
  }
}

function walkDict(t: EastTypeValue, base: any, ops: any, path: PatchPath, out: PatchConflict[]): void {
  const dictTypes = t.value as { key: EastTypeValue; value: EastTypeValue };
  const keyT = dictTypes.key;
  const valueT = dictTypes.value;
  const keyPrint = printFor(keyT);
  const valueEqual = equalFor(valueT);
  const has = (k: any): boolean => base instanceof Map ? base.has(k) : (base != null && k in base);
  const get = (k: any): any => base instanceof Map ? base.get(k) : base?.[k];
  // ops is a SortedMap or Map iterating [key, op] pairs.
  for (const [k, op] of ops as Iterable<[any, any]>) {
    const subPath = [...path, dictKey(keyPrint(k))];
    if (op.type === "delete") {
      if (!has(k)) {
        out.push({ path: subPath, op: "delete", expected: op.value, actual: undefined });
      } else if (!valueEqual(get(k), op.value)) {
        out.push({ path: subPath, op: "delete", expected: op.value, actual: get(k) });
      }
    } else if (op.type === "insert") {
      if (has(k)) {
        out.push({ path: subPath, op: "insert", expected: undefined, actual: get(k) });
      }
    } else if (op.type === "update") {
      if (!has(k)) {
        out.push({ path: subPath, op: "update", expected: undefined, actual: undefined });
      } else {
        walk(valueT, get(k), op.value, subPath, out);
      }
    }
  }
}

function walkSet(t: EastTypeValue, base: any, ops: any, path: PatchPath, out: PatchConflict[]): void {
  const elemT = t.value as EastTypeValue;
  const elemPrint = printFor(elemT);
  const has = (k: any): boolean => {
    if (base instanceof Set) return base.has(k);
    if (base && typeof base[Symbol.iterator] === "function") {
      for (const v of base as Iterable<any>) {
        if (equalFor(elemT)(v, k)) return true;
      }
    }
    return false;
  };
  for (const [k, op] of ops as Iterable<[any, any]>) {
    const subPath = [...path, dictKey(elemPrint(k))];
    if (op.type === "delete") {
      if (!has(k)) out.push({ path: subPath, op: "delete", expected: k, actual: undefined });
    } else if (op.type === "insert") {
      if (has(k)) out.push({ path: subPath, op: "insert", expected: undefined, actual: k });
    }
  }
}

function walkVariant(t: EastTypeValue, base: any, sub: any, path: PatchPath, out: PatchConflict[]): void {
  const cases = t.value as Array<{ name: string; type: EastTypeValue }>;
  const subCase = cases.find(c => c.name === sub.type);
  if (!subCase) return;
  if (!base || base.type !== sub.type) {
    out.push({
      path: [...path, variantTag(sub.type)],
      op: "update",
      expected: { tag: sub.type },
      actual: base ? { tag: base.type } : undefined,
    });
    return;
  }
  walk(subCase.type, base.value, sub.value, [...path, variantTag(sub.type)], out);
}
