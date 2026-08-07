/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Host-side ValueTree materialize + edit-apply.
 *
 * `nodeOf` / `rebuild` (this module's `index.ts`) are the East-SIDE factory —
 * they build IR from an `Expr` at authoring time, for `ValueTree.Root` inside a
 * UI task. A host consumer (e.g. the e3 extension preview) instead holds a
 * DECODED value + its type, so it needs the same walk HOST-side: over plain JS
 * values, returning plain JS node values.
 *
 * These are runtime type-reflection utilities in the family of east's
 * {@link isFor} / {@link compareFor} / {@link defaultValue}: they accept EITHER
 * an `EastType` or a runtime `EastTypeValue` (normalizing via
 * {@link toEastTypeValue}), and reuse {@link defaultValue} for the zero payloads
 * of inserts / tag switches — no separate host mirror of that logic.
 *
 * Edits are a CONCRETE path walk (the path is a known value here, so there is
 * none of the IR macro's per-shape conditional fan-out): descend struct fields /
 * array indices / dict keys / option `some` / variant tags, then apply the op at
 * the addressed node.
 */

import {
    isVariant,
    toEastTypeValue,
    fromEastTypeValue,
    defaultValue,
    printFor,
    parseFor,
    compareFor,
    SortedMap,
    variant,
    some,
    none,
    type EastType,
    type EastTypeValue,
    type ValueTypeOf,
} from '@elaraai/east';
import type { ValueTreeNodeType, ValueTreeLeafType, ValueTreeStepType } from './types.js';

/** Decoded JS value of a materialized node. */
export type ValueTreeNodeValue = ValueTypeOf<typeof ValueTreeNodeType>;
/** Decoded JS value of a primitive leaf. */
export type ValueTreeLeafValue = ValueTypeOf<typeof ValueTreeLeafType>;
/** Decoded JS value of one path step. */
export type ValueTreeStepValue = ValueTypeOf<typeof ValueTreeStepType>;

/** One structural edit reported by the ValueTree renderer's callbacks. */
export type ValueTreeEditOp =
    | { kind: 'edit'; leaf: ValueTreeLeafValue }
    | { kind: 'insert' }
    | { kind: 'remove' }
    | { kind: 'tag'; tag: string };

const MAX_DEPTH = 24;
// The node budget guards runaway materialization, but must comfortably
// exceed anything the inline preview's byte gate admits — an exhausted
// budget degrades rows to opaque leaves, so a low cap silently truncates
// mid-list while the value itself is small.
const MAX_NODES = 500_000;
const MAX_PRINT = 200;

/** A field/case list entry of a Struct/Variant `EastTypeValue`. */
interface NamedType { name: string; type: EastTypeValue; }
/** A decoded variant value (also the option / EastTypeValue shape). */
interface VariantValue { type: string; value: unknown; }

/** Normalize `EastType | EastTypeValue` to an `EastTypeValue` (the `isFor`
 *  pattern) — a type-value is already a variant; a type object is converted. */
function asTypeValue(type: EastType | EastTypeValue): EastTypeValue {
    return isVariant(type) ? (type as EastTypeValue) : toEastTypeValue(type as EastType);
}

function clampPrint(s: string): string {
    return s.length > MAX_PRINT ? `${s.slice(0, MAX_PRINT)}…` : s;
}

/** East-canonical print with a non-throwing fallback to the kind marker. */
function printEast(tv: EastTypeValue, value: unknown): string {
    try {
        return clampPrint(printFor(fromEastTypeValue(tv))(value as never));
    } catch {
        return `[${tv.type}]`;
    }
}

/**
 * Display label for a dict entry key — PRESENTATION ONLY, never identity
 * (labels can collide; the entry's `key` carries the canonical text the
 * path steps round-trip). Struct keys read as their " · "-joined field
 * labels (the same reading as struct value summaries), string fields
 * stay verbatim, and every other kind prints through East's canonical
 * printer.
 *
 * @param type - The key's East type (an `EastType` or a runtime `EastTypeValue`)
 * @param key - The decoded key value
 * @returns The display label
 */
export function dictKeyLabel(type: EastType | EastTypeValue, key: unknown): string {
    const tv = asTypeValue(type);
    if (tv.type === 'Struct') {
        const fields = tv.value as NamedType[];
        const obj = key as Record<string, unknown>;
        return clampPrint(fields.map(f => dictKeyLabel(f.type, obj[f.name])).join(' · '));
    }
    if (tv.type === 'String') return clampPrint(key as string);
    return printEast(tv, key);
}

/** Kind-aware summary for the read-only `opaque` node kinds. */
function opaqueSummary(tv: EastTypeValue, value: unknown): string {
    switch (tv.type) {
        case 'Set': return `Set · ${(value as Set<unknown>).size} items`;
        case 'Blob': return `Blob · ${(value as Uint8Array).length} bytes`;
        case 'Vector': return `Vector · ${(value as { length: number }).length} values`;
        case 'Matrix': {
            const m = value as { rows?: number; cols?: number };
            return typeof m.rows === 'number' && typeof m.cols === 'number' ? `Matrix · ${m.rows}×${m.cols}` : 'Matrix';
        }
        case 'Ref': return 'Ref';
        case 'Function':
        case 'AsyncFunction': return 'Function';
        default: return printEast(tv, value);
    }
}

/** True for a Variant type-value whose cases are exactly `some` + `none`. */
function isOptionTV(tv: EastTypeValue): boolean {
    if (tv.type !== 'Variant') return false;
    const tags = (tv.value as NamedType[]).map(c => c.name);
    return tags.length === 2 && tags.includes('some') && tags.includes('none');
}

const someType = (tv: EastTypeValue): EastTypeValue => (tv.value as NamedType[]).find(c => c.name === 'some')!.type;
const caseType = (tv: EastTypeValue, tag: string): EastTypeValue => (tv.value as NamedType[]).find(c => c.name === tag)!.type;
const fieldType = (tv: EastTypeValue, name: string): EastTypeValue => (tv.value as NamedType[]).find(f => f.name === name)!.type;
const elemType = (tv: EastTypeValue): EastTypeValue => tv.value as EastTypeValue;
const dictValueType = (tv: EastTypeValue): EastTypeValue => (tv.value as { key: EastTypeValue; value: EastTypeValue }).value;
const dictKeyType = (tv: EastTypeValue): EastTypeValue => (tv.value as { key: EastTypeValue; value: EastTypeValue }).key;

const leafNode = (l: ValueTreeLeafValue): ValueTreeNodeValue => variant('leaf', l) as unknown as ValueTreeNodeValue;
const opaqueNode = (s: string): ValueTreeNodeValue => variant('opaque', s) as unknown as ValueTreeNodeValue;

// ── Materialize ─────────────────────────────────────────────────────────────

/** Honest label for a node the materializer will not descend into —
 *  cheap counts for composites (never a whole-value print, the budget is
 *  exhausted precisely when the value is big), scalars printed as usual. */
function truncatedSummary(tv: EastTypeValue, value: unknown): string {
    switch (tv.type) {
        case 'Struct': return `${(tv.value as NamedType[]).length} fields · truncated`;
        case 'Array': return `${(value as unknown[]).length} items · truncated`;
        case 'Dict': return `${(value as Map<unknown, unknown>).size} entries · truncated`;
        case 'Variant': return `${(value as VariantValue).type} · truncated`;
        default: return opaqueSummary(tv, value);
    }
}

function nodeOf(tv: EastTypeValue, value: unknown, depth: number, state: { budget: number }): ValueTreeNodeValue {
    state.budget -= 1;
    if (depth > MAX_DEPTH || state.budget <= 0) {
        return opaqueNode(truncatedSummary(tv, value));
    }
    switch (tv.type) {
        case 'Null': return leafNode(variant('null', null) as unknown as ValueTreeLeafValue);
        case 'Boolean': return leafNode(variant('boolean', value as boolean) as unknown as ValueTreeLeafValue);
        case 'Integer': return leafNode(variant('integer', value as bigint) as unknown as ValueTreeLeafValue);
        case 'Float': return leafNode(variant('float', value as number) as unknown as ValueTreeLeafValue);
        case 'String': return leafNode(variant('string', value as string) as unknown as ValueTreeLeafValue);
        case 'DateTime': return leafNode(variant('datetime', value as Date) as unknown as ValueTreeLeafValue);

        case 'Struct': {
            const fields = tv.value as NamedType[];
            const obj = value as Record<string, unknown>;
            return variant('struct', {
                fields: fields.map(f => ({ name: f.name, node: nodeOf(f.type, obj[f.name], depth, state) })),
            }) as unknown as ValueTreeNodeValue;
        }
        case 'Array': {
            const elem = elemType(tv);
            return variant('array', {
                items: (value as unknown[]).map(x => nodeOf(elem, x, depth, state)),
            }) as unknown as ValueTreeNodeValue;
        }
        case 'Dict': {
            const vt = dictValueType(tv);
            const kt = dictKeyType(tv);
            const editable = kt.type === 'String';
            // `key` is identity (unclamped canonical print, parsed back by
            // the edit-appliers); `label` is presentation.
            const printKey = editable ? null : printFor(fromEastTypeValue(kt));
            const entries = Array.from((value as Map<unknown, unknown>).entries()).map(([k, v]) => ({
                key: printKey === null ? (k as string) : printKey(k as never),
                label: printKey === null ? (k as string) : dictKeyLabel(kt, k),
                node: nodeOf(vt, v, depth, state),
            }));
            return variant('dict', { entries, editable }) as unknown as ValueTreeNodeValue;
        }
        case 'Variant': {
            const vv = value as VariantValue;
            if (isOptionTV(tv)) {
                return variant('option', {
                    value: vv.type === 'some' ? some(nodeOf(someType(tv), vv.value, depth, state)) : none,
                }) as unknown as ValueTreeNodeValue;
            }
            const tags = (tv.value as NamedType[]).map(c => c.name);
            const ct = (tv.value as NamedType[]).find(c => c.name === vv.type);
            const payload = ct ? nodeOf(ct.type, vv.value, depth, state) : opaqueNode(clampPrint(vv.type));
            return variant('variant', { tag: vv.type, tags, value: payload }) as unknown as ValueTreeNodeValue;
        }

        default:
            // Set, Blob, Vector, Matrix, Ref, Function, Recursive, Never — read-only.
            return opaqueNode(opaqueSummary(tv, value));
    }
}

/**
 * Materialize a decoded East value into a {@link ValueTreeNodeValue}.
 *
 * @param type - The value's East type (an `EastType` or a runtime `EastTypeValue`)
 * @param value - The decoded JS value
 * @returns The materialized root node the ValueTree renderer consumes
 */
export function materialize(type: EastType | EastTypeValue, value: unknown): ValueTreeNodeValue {
    return nodeOf(asTypeValue(type), value, 0, { budget: MAX_NODES });
}

// ── Edit application ────────────────────────────────────────────────────────

/** The zero payload for an inserted element / switched case — reuses east's
 *  {@link defaultValue} (option → `none`), the SAME source the East-side
 *  rebuild uses. */
function zeroFor(tv: EastTypeValue): unknown {
    return defaultValue(fromEastTypeValue(tv));
}

/** The primitive payload carried by a leaf edit (`variant(kind, payload)`). */
function leafPayload(l: ValueTreeLeafValue): unknown {
    return (l as unknown as { value: unknown }).value;
}

function apply(tv: EastTypeValue, value: unknown, path: ValueTreeStepValue[], i: number, op: ValueTreeEditOp): unknown {
    // Path exhausted → the op acts on THIS node.
    if (i >= path.length) {
        if (op.kind === 'edit') return leafPayload(op.leaf);
        if (op.kind === 'tag') {
            if (isOptionTV(tv)) return op.tag === 'some' ? some(zeroFor(someType(tv))) : none;
            return variant(op.tag, zeroFor(caseType(tv, op.tag)));
        }
        return value;
    }

    const step = path[i] as unknown as VariantValue;
    const last = i === path.length - 1;

    switch (step.type) {
        case 'field': {
            const name = step.value as string;
            const obj = value as Record<string, unknown>;
            return { ...obj, [name]: apply(fieldType(tv, name), obj[name], path, i + 1, op) };
        }
        case 'index': {
            const idx = Number(step.value as bigint);
            const arr = value as unknown[];
            if (last && op.kind === 'remove') return arr.filter((_, j) => j !== idx);
            return arr.map((x, j) => (j === idx ? apply(elemType(tv), x, path, i + 1, op) : x));
        }
        case 'append': {
            // Terminal array insert.
            return [...(value as unknown[]), zeroFor(elemType(tv))];
        }
        case 'key': {
            const kt = dictKeyType(tv);
            const text = step.value as string;
            // The step carries the key's canonical print (string keys are
            // their own text) — parse it back to the key VALUE and address
            // the entry with east's own key semantics, never the label.
            let k: unknown = text;
            if (kt.type !== 'String') {
                const parsed = parseFor(fromEastTypeValue(kt))(text);
                if (!parsed.success) {
                    throw new Error(`ValueTree: dict key step ${JSON.stringify(text)} is not the canonical print of a ${kt.type} key: ${parsed.error}`);
                }
                k = parsed.value;
            }
            // Copy as a SortedMap keyed by the type's comparator — keyed
            // ops resolve by VALUE (struct/date keys included), and the
            // result stays a canonical East dict container for re-encoding.
            const cmp = compareFor(fromEastTypeValue(kt)) as (a: unknown, b: unknown) => number;
            const map = new SortedMap((value as Map<unknown, unknown>).entries(), cmp);
            if (last && op.kind === 'insert') { map.set(k, zeroFor(dictValueType(tv))); return map; }
            if (last && op.kind === 'remove') { map.delete(k); return map; }
            if (!map.has(k)) {
                throw new Error(`ValueTree: no dict entry for key step ${JSON.stringify(text)}`);
            }
            map.set(k, apply(dictValueType(tv), map.get(k), path, i + 1, op));
            return map;
        }
        case 'some': {
            return some(apply(someType(tv), (value as VariantValue).value, path, i + 1, op));
        }
        case 'tag': {
            const vv = value as VariantValue;
            return variant(vv.type, apply(caseType(tv, vv.type), vv.value, path, i + 1, op));
        }
        default:
            return value;
    }
}

/**
 * Apply one ValueTree edit to a decoded East value, returning a NEW value
 * (immutable along the touched path). The write-side mirror of
 * {@link materialize} — the host reconciles by re-materializing the result.
 *
 * @param type - The value's East type (`EastType` or runtime `EastTypeValue`)
 * @param value - The current decoded value
 * @param path - The node path the renderer reported
 * @param op - The structural edit (leaf edit / insert / remove / tag switch)
 * @returns The new decoded value
 */
export function applyEdit(
    type: EastType | EastTypeValue,
    value: unknown,
    path: ValueTreeStepValue[],
    op: ValueTreeEditOp,
): unknown {
    return apply(asTypeValue(type), value, path, 0, op);
}
