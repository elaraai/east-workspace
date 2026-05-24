/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Patch walker — type-driven visitor over a {@link PatchTypeOf} tree.
 *
 * @remarks
 * `walkPatch(type, patch, visitor)` traverses a patch and calls back into the
 * visitor for each container entry / leaf change. Two key behaviours that
 * separate it from raw IR walking:
 *
 * 1. **Container `replace` ops are re-diffed.** When a struct / array / dict /
 *    set / variant / ref is wholly replaced, the walker calls
 *    {@link diffFor} against the before/after pair and walks the resulting
 *    patch — so consumers always see *leaf-level* changes, never whole-value
 *    JSON dumps.
 *
 * 2. **Type tags are east's own.** `enter` / `leaf` / `exit` callbacks receive
 *    the `EastTypeValue` directly; consumers dispatch on `ctx.type.type`
 *    (which is `"Struct" | "Array" | "Dict" | "Set" | "Variant" | "Ref" | …`)
 *    rather than a parallel string enum.
 *
 * @example
 * ```ts
 * import { walkPatch, diffFor, StructType, IntegerType, FloatType } from "@elaraai/east";
 *
 * const PolicyType = StructType({ maxHours: IntegerType, penalty: FloatType });
 * const patch = diffFor(PolicyType)(
 *     { maxHours: 38n, penalty: 1.5 },
 *     { maxHours: 40n, penalty: 1.5 },
 * );
 *
 * walkPatch(PolicyType, patch, {
 *     leaf: ({ path, before, after }) => {
 *         console.log(pathToString(path), before, "→", after);
 *     },
 * });
 * // → "maxHours" 38n → 40n
 * ```
 *
 * @packageDocumentation
 */

import type { EastTypeValue } from "../type_of_type.js";
import { toEastTypeValue } from "../type_of_type.js";
import { isVariant, type variant as VariantValue } from "../containers/variant.js";
import type { EastType } from "../types.js";
import { printFor } from "../serialization/east.js";
import { diffFor } from "./diff.js";
import {
    type PatchPath,
    type PatchPathSegment,
    field,
    index,
    dictKey,
    variantTag,
} from "./path.js";

// ============================================================================
// Visitor interface
// ============================================================================

/**
 * Operation tag attached to each leaf the walker visits.
 *
 * - `update`     — primitive value changed
 * - `insert`     — array element / dict entry / set element added
 * - `delete`     — array element / dict entry / set element removed
 * - `unchanged`  — only emitted when the caller explicitly walks an
 *   `unchanged` patch at the root; never appears in interior nodes
 */
export type PatchLeafOp = "insert" | "delete" | "update" | "unchanged";

/**
 * Container kinds the walker recurses through. Matches the relevant
 * variants of `EastTypeValue.type`.
 */
export type PatchContainerKind = "Struct" | "Array" | "Dict" | "Set" | "Variant" | "Ref";

export interface PatchVisitor {
    /**
     * Fires on entry to a container node that has at least one descendant
     * change. Return `false` to skip the subtree (no `leaf`/`exit` calls
     * fire below it).
     *
     * @property type      - The container's runtime east type.
     * @property path      - Typed segments from the walk root to this node.
     * @property leafCount - Number of leaves that will be visited under this
     *   subtree if `enter` returns truthy.
     */
    readonly enter?: (ctx: {
        readonly type: EastTypeValue;
        readonly path: PatchPath;
        readonly leafCount: number;
    }) => boolean | void;

    /**
     * Fires for each primitive (or replace-only) leaf that has changed.
     *
     * @property type   - East type of the leaf value.
     * @property path   - Typed segments from the walk root to this leaf.
     * @property op     - Kind of change.
     * @property before - Previous value (`undefined` for `insert`).
     * @property after  - New value (`undefined` for `delete`).
     */
    readonly leaf: (ctx: {
        readonly type: EastTypeValue;
        readonly path: PatchPath;
        readonly op: PatchLeafOp;
        readonly before: unknown;
        readonly after:  unknown;
    }) => void;

    /**
     * Fires after every descendant of a container has been visited. Always
     * called after the matching `enter` (unless `enter` returned `false`).
     */
    readonly exit?: (ctx: {
        readonly type: EastTypeValue;
        readonly path: PatchPath;
    }) => void;
}

// ============================================================================
// Public entry point
// ============================================================================

/** Any patch variant — patches are always east `variant("unchanged"|"replace"|"patch", v)`. */
type AnyPatch = VariantValue<string, any>;

/**
 * Walk a patch tree, dispatching on the underlying east type at each level.
 *
 * @param type    - The east type the patch is computed against. Accepts an
 *   `EastType` (e.g. `StructType({...})`) or a runtime `EastTypeValue`.
 * @param patch   - A patch produced by {@link diffFor} (or compatible).
 * @param visitor - Callbacks for entry, leaf, and exit events.
 *
 * @remarks
 * If the root patch is `unchanged`, no callbacks fire. If the root is a
 * `replace` of a container type, the walker re-diffs to expose per-field
 * changes; if it's a `replace` of a primitive, exactly one `leaf` fires.
 */
export function walkPatch(
    type: EastType | EastTypeValue,
    patch: AnyPatch,
    visitor: PatchVisitor,
): void {
    const t = isVariant(type) ? type : toEastTypeValue(type as EastType);
    walk(t, patch, [], visitor);
}

// ============================================================================
// Internal recursion
// ============================================================================

function walk(type: EastTypeValue, patch: AnyPatch, path: PatchPath, visitor: PatchVisitor): void {
    if (patch.type === "unchanged") return;

    if (patch.type === "replace") {
        // For containers, re-diff so the user sees per-field changes instead
        // of a whole-value blob. east's Set / Dict / Variant diffs collapse
        // "everything-replaced" cases back to a `replace` op for compactness,
        // so a re-diff returns the same `replace`. In that case decompose
        // the before/after pair manually so every leaf still maps to a
        // primitive value the renderer can format.
        const isContainer =
            type.type === "Struct" || type.type === "Array" ||
            type.type === "Dict"   || type.type === "Set"   ||
            type.type === "Variant" || type.type === "Ref";
        if (isContainer) {
            const inner = diffFor(type)(patch.value.before, patch.value.after);
            if (inner.type === "patch") {
                walk(type, inner, path, visitor);
                return;
            }
            if (inner.type === "unchanged") return;
            // inner is still `replace` — east collapsed. Decompose by type.
            walkCollapsedReplace(type, patch.value.before, patch.value.after, path, visitor);
            return;
        }
        // Primitive leaf — emit one leaf event.
        visitor.leaf({
            type,
            path,
            op: "update",
            before: patch.value.before,
            after:  patch.value.after,
        });
        return;
    }

    // patch.type === "patch" — descend.
    switch (type.type) {
        case "Struct":  walkStruct(type, patch.value, path, visitor); return;
        case "Array":   walkArray(type, patch.value, path, visitor); return;
        case "Dict":    walkDict(type, patch.value, path, visitor); return;
        case "Set":     walkSet(type, patch.value, path, visitor); return;
        case "Variant": walkVariant(type, patch.value, path, visitor); return;
        case "Ref":     walk(type.value as EastTypeValue, patch.value, path, visitor); return;
        default: return;  // primitive — patch arm unreachable per PatchTypeOf
    }
}

// ----- Struct ---------------------------------------------------------------

function walkStruct(type: EastTypeValue, patchSub: any, path: PatchPath, visitor: PatchVisitor): void {
    const fields = type.value as Array<{ name: string; type: EastTypeValue }>;
    const leafCount = countStructLeaves(type, patchSub);
    const enterOk = enterContainer(type, path, leafCount, visitor);
    if (!enterOk) return;
    for (const { name: fname, type: ftype } of fields) {
        const child = patchSub[fname];
        if (child === undefined) continue;
        walk(ftype, child, [...path, field(fname)], visitor);
    }
    visitor.exit?.({ type, path });
}

function countStructLeaves(type: EastTypeValue, patchSub: any): number {
    const fields = type.value as Array<{ name: string; type: EastTypeValue }>;
    let n = 0;
    for (const { name: fname, type: ftype } of fields) {
        const child = patchSub[fname];
        if (child === undefined) continue;
        n += countLeavesIn(ftype, child);
    }
    return n;
}

// ----- Array ----------------------------------------------------------------

function walkArray(type: EastTypeValue, patchSub: any, path: PatchPath, visitor: PatchVisitor): void {
    const elemType = type.value as EastTypeValue;
    const ops = patchSub as Array<{ key: bigint; offset: bigint; operation: any }>;
    const leafCount = countArrayLeaves(elemType, ops);
    if (!enterContainer(type, path, leafCount, visitor)) return;
    visitArrayOps(elemType, ops, path, visitor);
    visitor.exit?.({ type, path });
}

function countArrayLeaves(elemType: EastTypeValue, ops: Array<{ operation: any }>): number {
    let n = 0;
    for (const op of ops) {
        const inner = op.operation;
        if (inner.type === "delete" || inner.type === "insert") n += 1;
        else if (inner.type === "update") n += countLeavesIn(elemType, inner.value);
    }
    return n;
}

function visitArrayOps(
    elemType: EastTypeValue,
    ops: Array<{ key: bigint; offset: bigint; operation: any }>,
    path: PatchPath,
    visitor: PatchVisitor,
): void {
    for (const op of ops) {
        const idx = op.key;
        const subPath: PatchPath = [...path, index(idx)];
        const inner = op.operation;
        if (inner.type === "delete") {
            visitor.leaf({
                type: elemType, path: subPath,
                op: "delete", before: inner.value, after: undefined,
            });
        } else if (inner.type === "insert") {
            visitor.leaf({
                type: elemType, path: subPath,
                op: "insert", before: undefined, after: inner.value,
            });
        } else if (inner.type === "update") {
            walk(elemType, inner.value, subPath, visitor);
        }
    }
}

// ----- Dict / Set -----------------------------------------------------------

function walkDict(type: EastTypeValue, patchSub: SortedMapLike<any, any>, path: PatchPath, visitor: PatchVisitor): void {
    const keyType = (type.value as { key: EastTypeValue }).key;
    const valueType = (type.value as { value: EastTypeValue }).value;
    const keyPrint = printFor(keyType);
    let leafCount = 0;
    for (const [, op] of patchSub) {
        if (op.type === "delete" || op.type === "insert") leafCount++;
        else if (op.type === "update") leafCount += countLeavesIn(valueType, op.value);
    }
    if (!enterContainer(type, path, leafCount, visitor)) return;
    for (const [k, op] of patchSub) {
        const subPath: PatchPath = [...path, dictKey(keyPrint(k))];
        if (op.type === "delete") {
            visitor.leaf({ type: valueType, path: subPath, op: "delete", before: op.value, after: undefined });
        } else if (op.type === "insert") {
            visitor.leaf({ type: valueType, path: subPath, op: "insert", before: undefined, after: op.value });
        } else if (op.type === "update") {
            walk(valueType, op.value, subPath, visitor);
        }
    }
    visitor.exit?.({ type, path });
}

function walkSet(type: EastTypeValue, patchSub: SortedMapLike<any, any>, path: PatchPath, visitor: PatchVisitor): void {
    const elemType = type.value as EastTypeValue;
    const keyPrint = printFor(elemType);
    let leafCount = 0;
    for (const _ of patchSub) leafCount++;
    if (!enterContainer(type, path, leafCount, visitor)) return;
    for (const [k, op] of patchSub) {
        const subPath: PatchPath = [...path, dictKey(keyPrint(k))];
        if (op.type === "delete") {
            visitor.leaf({ type: elemType, path: subPath, op: "delete", before: k, after: undefined });
        } else if (op.type === "insert") {
            visitor.leaf({ type: elemType, path: subPath, op: "insert", before: undefined, after: k });
        }
    }
    visitor.exit?.({ type, path });
}

/** SortedMap / Map / any [Symbol.iterator] yielding [K, V]. east's patch IR
 *  uses SortedMap; declaring the iteration shape avoids `any` here. */
type SortedMapLike<K, V> = Iterable<readonly [K, V]>;

// ----- Variant --------------------------------------------------------------

function walkVariant(type: EastTypeValue, patchSub: any, path: PatchPath, visitor: PatchVisitor): void {
    const cases = type.value as Array<{ name: string; type: EastTypeValue }>;
    const sub = cases.find(c => c.name === patchSub.type);
    if (!sub) return;
    const leafCount = countLeavesIn(sub.type, patchSub.value);
    if (!enterContainer(type, path, leafCount, visitor)) return;
    walk(sub.type, patchSub.value, [...path, variantTag(patchSub.type)], visitor);
    visitor.exit?.({ type, path });
}

// ============================================================================
// Collapsed-replace decomposition
//
// east's Dict / Set / Variant diffs collapse "everything-replaced" cases
// (delete-all + insert-all) back into a `replace` op for compactness. When
// the walker hits one of these, it can't recurse via `diffFor` (which would
// produce the same `replace`); instead we walk before/after directly and
// emit per-key leaves so the renderer never has to fall back to formatting a
// whole container as one row.
// ============================================================================

function walkCollapsedReplace(
    type: EastTypeValue,
    before: any,
    after: any,
    path: PatchPath,
    visitor: PatchVisitor,
): void {
    switch (type.type) {
        case "Dict": return walkCollapsedDict(type, before, after, path, visitor);
        case "Set":  return walkCollapsedSet(type, before, after, path, visitor);
        case "Array": return walkCollapsedArray(type, before, after, path, visitor);
        case "Struct":
            // Struct diff doesn't collapse — but if a downstream consumer
            // hands us a struct `replace`, walk it as a re-diff (no infinite
            // loop risk: struct diff always produces `patch` for unequal
            // values).
            walk(type, diffFor(type)(before, after), path, visitor);
            return;
        case "Variant":
        case "Ref":
        default: {
            // Variant tag-change: emit one leaf carrying both variants.
            // Ref / unknown: same.
            visitor.leaf({ type, path, op: "update", before, after });
            return;
        }
    }
}

function walkCollapsedDict(type: EastTypeValue, before: SortedMapLike<unknown, unknown>, after: SortedMapLike<unknown, unknown>, path: PatchPath, visitor: PatchVisitor): void {
    const keyType = (type.value as { key: EastTypeValue }).key;
    const valueType = (type.value as { value: EastTypeValue }).value;
    const keyPrint = printFor(keyType);
    const beforeMap = new Map<string, { rawKey: unknown; value: unknown }>();
    for (const [k, v] of before) beforeMap.set(keyPrint(k), { rawKey: k, value: v });
    const afterMap = new Map<string, { rawKey: unknown; value: unknown }>();
    for (const [k, v] of after) afterMap.set(keyPrint(k), { rawKey: k, value: v });
    const allKeys = new Set<string>([...beforeMap.keys(), ...afterMap.keys()]);
    if (!enterContainer(type, path, allKeys.size, visitor)) return;
    for (const k of allKeys) {
        const subPath: PatchPath = [...path, dictKey(k)];
        const b = beforeMap.get(k);
        const a = afterMap.get(k);
        if (b && !a) {
            visitor.leaf({ type: valueType, path: subPath, op: "delete", before: b.value, after: undefined });
        } else if (!b && a) {
            visitor.leaf({ type: valueType, path: subPath, op: "insert", before: undefined, after: a.value });
        } else if (b && a) {
            // Same key, different values — recurse via diffFor on the inner
            // value type (which is one level deeper, no collapse risk).
            walk(valueType, diffFor(valueType)(b.value, a.value), subPath, visitor);
        }
    }
    visitor.exit?.({ type, path });
}

function walkCollapsedSet(type: EastTypeValue, before: Iterable<unknown>, after: Iterable<unknown>, path: PatchPath, visitor: PatchVisitor): void {
    const elemType = type.value as EastTypeValue;
    const keyPrint = printFor(elemType);
    const beforeKeys = new Map<string, unknown>();
    for (const k of before) beforeKeys.set(keyPrint(k), k);
    const afterKeys = new Map<string, unknown>();
    for (const k of after) afterKeys.set(keyPrint(k), k);
    const allKeys = new Set<string>([...beforeKeys.keys(), ...afterKeys.keys()]);
    if (!enterContainer(type, path, allKeys.size, visitor)) return;
    for (const k of allKeys) {
        const subPath: PatchPath = [...path, dictKey(k)];
        const inB = beforeKeys.has(k);
        const inA = afterKeys.has(k);
        if (inB && !inA) {
            visitor.leaf({ type: elemType, path: subPath, op: "delete", before: beforeKeys.get(k), after: undefined });
        } else if (!inB && inA) {
            visitor.leaf({ type: elemType, path: subPath, op: "insert", before: undefined, after: afterKeys.get(k) });
        }
    }
    visitor.exit?.({ type, path });
}

function walkCollapsedArray(type: EastTypeValue, before: any[], after: any[], path: PatchPath, visitor: PatchVisitor): void {
    // Array `replace` happens when east didn't run LCS at all (e.g. the
    // user passed a raw replace op manually). We can't easily decompose
    // by index — fall back to one leaf per index in the union of lengths.
    const elemType = type.value as EastTypeValue;
    const max = Math.max(before.length, after.length);
    if (!enterContainer(type, path, max, visitor)) return;
    for (let i = 0; i < max; i++) {
        const subPath: PatchPath = [...path, index(BigInt(i))];
        if (i < before.length && i >= after.length) {
            visitor.leaf({ type: elemType, path: subPath, op: "delete", before: before[i], after: undefined });
        } else if (i >= before.length && i < after.length) {
            visitor.leaf({ type: elemType, path: subPath, op: "insert", before: undefined, after: after[i] });
        } else {
            walk(elemType, diffFor(elemType)(before[i], after[i]), subPath, visitor);
        }
    }
    visitor.exit?.({ type, path });
}

// ============================================================================
// Helpers
// ============================================================================

function enterContainer(type: EastTypeValue, path: PatchPath, leafCount: number, visitor: PatchVisitor): boolean {
    if (leafCount === 0) return false;
    const ret = visitor.enter?.({ type, path, leafCount });
    return ret !== false;
}

/**
 * Count the leaves under a sub-patch without running visitor callbacks.
 * Used for the precomputed `leafCount` on `enter` events.
 */
function countLeavesIn(type: EastTypeValue, patch: any): number {
    if (patch.type === "unchanged") return 0;
    if (patch.type === "replace") {
        const isContainer =
            type.type === "Struct" || type.type === "Array" ||
            type.type === "Dict"   || type.type === "Set"   ||
            type.type === "Variant" || type.type === "Ref";
        if (isContainer) {
            const inner = diffFor(type)(patch.value.before, patch.value.after);
            if (inner.type === "patch") return countLeavesIn(type, inner);
            // inner unchanged → 0; inner still a `replace` → treat as one leaf.
            return inner.type === "unchanged" ? 0 : 1;
        }
        return 1;
    }
    // patch.type === "patch"
    switch (type.type) {
        case "Struct":  return countStructLeaves(type, patch.value);
        case "Array":   return countArrayLeaves(type.value as EastTypeValue, patch.value);
        case "Dict": {
            const valueType = (type.value as { value: EastTypeValue }).value;
            let n = 0;
            for (const [, op] of patch.value as SortedMapLike<unknown, AnyPatch>) {
                if (op.type === "delete" || op.type === "insert") n++;
                else if (op.type === "update") n += countLeavesIn(valueType, op.value);
            }
            return n;
        }
        case "Set": {
            let n = 0;
            for (const _ of patch.value as SortedMapLike<unknown, unknown>) n++;
            return n;
        }
        case "Variant": {
            const cases = type.value as Array<{ name: string; type: EastTypeValue }>;
            const sub = cases.find(c => c.name === patch.value.type);
            return sub ? countLeavesIn(sub.type, patch.value.value) : 0;
        }
        case "Ref":     return countLeavesIn(type.value as EastTypeValue, patch.value);
        default:        return 0;
    }
}

// suppress unused-import warning for PatchPathSegment (re-exported via type)
type _Unused = PatchPathSegment;
