/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Key-search grammar and predicates for a COLLECTION's canonical key order
 * (#520, extracted in #719).
 *
 * A search over a Set / Dict addresses one contiguous run of rows in the
 * canonical East key order: a whole-key `.east` literal (exact), a String
 * prefix, or — for struct keys — exact leading fields optionally followed by
 * a prefix on the next String field. {@link parseKeyInput} turns typed text
 * into that wire query (or a hint when it cannot parse);
 * {@link keyRangePredicates} builds the monotone lower / upper row predicates
 * of a range query over already-decoded keys — the client-side mirror of the
 * server's fence search, for inline values. {@link toSeekQuery} writes a query
 * as the East value a keyed paged source's `seek` is asked, and
 * {@link keyQueryRange} restates one as a single range of the key's flattened
 * leaves, so a search can be asked inside a longer key that the key ends: an
 * index's `{ik, k}`, under one `ik` (#1621). No DOM, no React: the browser's
 * search box, the builders' Search Records and the terminal's `/find` share it.
 *
 * @packageDocumentation
 */

import {
    compareFor, none, parseFor, printFor, some, StringType, variant,
    type EastTypeValue, type ValueTypeOf,
} from "@elaraai/east";
import type { SeekQueryType } from "../../contracts/source.js";

/**
 * Where a query landed in the collection's canonical key order.
 *
 * @property found - Whether any row matched
 * @property row - First matched row (for a miss, the query's insertion row)
 * @property count - Number of matched rows
 */
export interface DatasetKeyMatchRange {
    found: boolean;
    row: number;
    count: number;
}

/**
 * A key query in wire form: a whole-key `.east` literal (`key`), a String
 * prefix (`prefix`), exact leading-field literals for struct keys (`fields`,
 * declaration order) optionally followed by a `prefix` on the next (String)
 * field, or a half-open `from` / `to` RANGE over a leading prefix of the key's
 * FLATTENED field path, naming at least one end. Every form addresses one
 * contiguous row range in the canonical key order.
 */
export type DatasetKeyQuery =
    | { key: string }
    | { prefix: string }
    | { fields: string[]; prefix?: string }
    | { from: string[]; to?: string[] }
    | { from?: string[]; to: string[] };

/** A parsed search input: a wire query, or the hint to show instead. */
export type ParsedKeyInput =
    | { kind: "query"; query: DatasetKeyQuery }
    | { kind: "hint"; hint: string };

/**
 * A struct key type's ordered field list, or null for non-struct keys.
 *
 * @param keyType - The collection's Dict key / Set element type
 * @returns The fields, or null
 */
export function structKeyFields(keyType: EastTypeValue): { name: string; type: EastTypeValue }[] | null {
    if (keyType.type !== "Struct") return null;
    const fields = keyType.value as { name: string; type: EastTypeValue }[];
    return fields.length > 0 ? fields : null;
}

/** Splits on commas at top level — outside `"…"` strings (with `\`
 *  escapes) and outside parentheses/brackets — so typed field values can
 *  themselves contain commas. */
function splitTopLevel(text: string): string[] {
    const parts: string[] = [];
    let current = "";
    let inString = false;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;
        if (inString) {
            current += ch;
            if (ch === "\\" && i + 1 < text.length) {
                current += text[i + 1]!;
                i++;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            current += ch;
        } else if (ch === "(" || ch === "[" || ch === "{") {
            depth++;
            current += ch;
        } else if (ch === ")" || ch === "]" || ch === "}") {
            depth--;
            current += ch;
        } else if (ch === "," && depth === 0) {
            parts.push(current);
            current = "";
        } else {
            current += ch;
        }
    }
    parts.push(current);
    return parts;
}

/**
 * The human key signature for placeholders and parse hints.
 *
 * @param keyType - The collection's Dict key / Set element type
 * @returns `(name: Kind, …)` for struct keys, else the kind name
 */
export function keySignature(keyType: EastTypeValue): string {
    const fields = structKeyFields(keyType);
    if (fields === null) return keyType.type;
    return `(${fields.map((f) => `${f.name}: ${f.type.type}`).join(", ")})`;
}

/**
 * Turns typed search text into a wire query, or a hint when it cannot
 * parse. String keys: bare text is a prefix. Struct keys: `(` opens a
 * whole-key `.east` literal; otherwise comma-separated leading field values
 * — exact for all but the last segment (unquoted String segments need no
 * quotes), the last a prefix on a String field or an exact value otherwise,
 * and a trailing comma narrows to the leading exact fields. Any key:
 * `from..to` is a range over the key's flattened fields, open at one end or
 * neither.
 *
 * Quoting is the escape. A quoted value is a `.east` literal, taken exactly
 * as written — a `..` or `,` inside it is text — so a String key whose input
 * is one quoted literal is an exact key: `"../config"` finds `../config`
 * rather than everything below `/config`.
 *
 * @param keyType - The collection's Dict key / Set element type
 * @param text - The raw search input
 * @returns The query to send, or the hint to display
 */
export function parseKeyInput(keyType: EastTypeValue, text: string): ParsedKeyInput {
    const bounds = splitRange(text);
    if (bounds !== null) return parseRangeInput(keyType, bounds);
    const fields = structKeyFields(keyType);
    if (fields === null) {
        if (keyType.type === "String") {
            const literal = text.trim().startsWith('"') ? parseFor(StringType)(text) : null;
            return literal?.success === true
                ? { kind: "query", query: { key: printFor(StringType)(literal.value) } }
                : { kind: "query", query: { prefix: text } };
        }
        const parsed = parseFor(keyType)(text);
        if (!parsed.success) return { kind: "hint", hint: `Key is ${keyType.type}` };
        return { kind: "query", query: { key: printFor(keyType)(parsed.value as never) } };
    }
    if (text.trimStart().startsWith("(")) {
        const parsed = parseFor(keyType)(text);
        if (!parsed.success) return { kind: "hint", hint: `Key is ${keySignature(keyType)}` };
        return { kind: "query", query: { key: printFor(keyType)(parsed.value as never) } };
    }
    const segments = splitTopLevel(text);
    if (segments.length > fields.length) {
        return { kind: "hint", hint: `Key is ${keySignature(keyType)}` };
    }
    const exact: string[] = [];
    for (let i = 0; i < segments.length; i++) {
        const field = fields[i]!;
        const raw = segments[i]!.trim();
        const isLast = i === segments.length - 1;
        if (isLast && raw === "" && i > 0) {
            // A trailing comma narrows to the leading exact fields.
            return { kind: "query", query: { fields: exact } };
        }
        if (field.type.type === "String" && !raw.startsWith('"')) {
            if (isLast) {
                // Unquoted final String segment types ahead as a prefix.
                return exact.length === 0
                    ? { kind: "query", query: { prefix: raw } }
                    : { kind: "query", query: { fields: exact, prefix: raw } };
            }
            exact.push(printFor(StringType)(raw));
            continue;
        }
        const parsed = parseFor(field.type)(raw);
        if (!parsed.success) {
            return { kind: "hint", hint: `${field.name} is ${field.type.type} — key is ${keySignature(keyType)}` };
        }
        exact.push(printFor(field.type)(parsed.value as never));
    }
    return { kind: "query", query: { fields: exact } };
}

/**
 * Splits `from..to` at the top level, or `null` when the text names no range.
 *
 * @remarks
 * `..` is the range operator the search chrome types; either side may be
 * empty, which is an open end, though not both. Scanned with the same
 * string/bracket awareness as {@link splitTopLevel}, so a `..` inside a quoted
 * value is just text.
 */
function splitRange(text: string): { from: string; to: string } | null {
    let inString = false;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;
        if (inString) {
            if (ch === "\\" && i + 1 < text.length) i++;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        else if (ch === "." && depth === 0 && text[i + 1] === ".") {
            return { from: text.slice(0, i), to: text.slice(i + 2) };
        }
    }
    return null;
}

/** One side of a range as `.east` literals of the key's leading leaves, or
 *  `null` when a segment does not parse. */
function parseBound(leaves: readonly KeyLeaf[], text: string): string[] | null {
    const trimmed = text.trim();
    if (trimmed === "") return [];
    const segments = splitTopLevel(trimmed);
    if (segments.length > leaves.length) return null;
    const literals: string[] = [];
    for (let i = 0; i < segments.length; i++) {
        const leaf = leaves[i]!;
        const raw = segments[i]!.trim();
        if (leaf.type.type === "String" && !raw.startsWith('"')) {
            literals.push(printFor(StringType)(raw));
            continue;
        }
        const parsed = parseFor(leaf.type)(raw);
        if (!parsed.success) return null;
        literals.push(printFor(leaf.type)(parsed.value as never));
    }
    return literals;
}

/** The hint for a range the key's leading leaves cannot take. It names the
 *  escape too, since text a key holds can contain the operator. */
function rangeHint(leaves: readonly KeyLeaf[]): string {
    return `Range is from..to over ${leaves.map((l) => `${l.path.join(".") || "key"}: ${l.type.type}`).join(", ")}`
        + ` — quote text that holds ".."`;
}

/** A `from..to` search input as a range query, or the hint to display. A
 *  range open at both ends names no run, so it is a hint as well. */
function parseRangeInput(keyType: EastTypeValue, bounds: { from: string; to: string }): ParsedKeyInput {
    const leaves = flattenKeyLeaves(keyType);
    const from = parseBound(leaves, bounds.from);
    const to = parseBound(leaves, bounds.to);
    if (from === null || to === null || (from.length === 0 && to.length === 0)) {
        return { kind: "hint", hint: rangeHint(leaves) };
    }
    return {
        kind: "query",
        query: from.length === 0 ? { to } : to.length === 0 ? { from } : { from, to },
    };
}

/** Predicates that match no key — a defensively-handled malformed query. */
const MATCH_NOTHING = { lower: () => false, upper: () => false } as const;

/** One leaf of a key type, and the field path that reaches it. */
interface KeyLeaf {
    path: string[];
    type: EastTypeValue;
}

/**
 * A key type's leaves, in declaration order, recursing into nested structs —
 * the client's mirror of the server's flattening.
 *
 * @remarks
 * Struct keys compare field by field in declaration order, so this flattening
 * IS the key's sort order, which is what makes a bound on a leading prefix of
 * it one contiguous run. An index entry's `{ik: {status, due}, k}` flattens to
 * `status, due, k`, so a bound of two values bounds the index key.
 *
 * @param keyType - the collection's Dict key / Set element type
 * @returns the leaves, in sort order
 */
export function flattenKeyLeaves(keyType: EastTypeValue): KeyLeaf[] {
    if (keyType.type !== "Struct") return [{ path: [], type: keyType }];
    const out: KeyLeaf[] = [];
    for (const field of keyType.value as { name: string; type: EastTypeValue }[]) {
        for (const leaf of flattenKeyLeaves(field.type)) {
            out.push({ path: [field.name, ...leaf.path], type: leaf.type });
        }
    }
    return out;
}

/** The value at a flattened field path. */
function leafAt(key: unknown, path: string[]): unknown {
    let value = key;
    for (const segment of path) value = (value as Record<string, unknown>)[segment];
    return value;
}

/**
 * A monotone "is this key at or past the bound?" predicate over a leading
 * prefix of the flattened key, or `null` when the bound does not parse.
 */
function boundPredicate(leaves: KeyLeaf[], literals: readonly string[]): ((key: unknown) => boolean) | null {
    if (literals.length > leaves.length) return null;
    const values: unknown[] = [];
    for (let i = 0; i < literals.length; i++) {
        const parsed = parseFor(leaves[i]!.type)(literals[i]!);
        if (!parsed.success) return null;
        values.push(parsed.value);
    }
    const comparators = leaves.slice(0, values.length).map((leaf) => compareFor(leaf.type));
    return (key) => {
        for (let i = 0; i < values.length; i++) {
            const order = comparators[i]!(leafAt(key, leaves[i]!.path), values[i]);
            if (order !== 0) return order > 0;
        }
        return true; // equal on the prefix: at the bound, so past it
    };
}

/**
 * Builds the monotone lower/upper row predicates of a RANGE query over
 * keys in canonical East order — the client-side mirror of the server's
 * fence-search predicates, for inline (already-decoded) values. The
 * range is `[first row where lower holds, first row where upper holds)`.
 *
 * @param keyType - The collection's Dict key / Set element type
 * @param query - The wire query
 * @returns The predicate pair, or `null` for a whole-key literal query
 *   (an exact lookup, not a range)
 */
export function keyRangePredicates(keyType: EastTypeValue, query: DatasetKeyQuery):
    | { lower: (k: unknown) => boolean; upper: (k: unknown) => boolean }
    | null {
    if ("key" in query) return null;
    if ("from" in query || "to" in query) {
        // A half-open bound on the FLATTENED key, which is what a time window
        // or a status band asks for — and what the other forms cannot say,
        // since they all pin a leading prefix to ONE value.
        const leaves = flattenKeyLeaves(keyType);
        const lower = boundPredicate(leaves, query.from ?? []);
        const upper = boundPredicate(leaves, query.to ?? []);
        if (lower === null || upper === null) return MATCH_NOTHING;
        return {
            // An open end: every key is at or past "the start", and none is
            // at or past "the end".
            lower: (query.from ?? []).length === 0 ? () => true : lower,
            upper: (query.to ?? []).length === 0 ? () => false : upper,
        };
    }
    if (keyType.type === "Struct") {
        const meta = keyType.value as { name: string; type: EastTypeValue }[];
        const literals = "fields" in query ? query.fields : [];
        if (literals.length > meta.length) return MATCH_NOTHING;
        const values: unknown[] = [];
        for (let j = 0; j < literals.length; j++) {
            const parsed = parseFor(meta[j]!.type)(literals[j]!);
            if (!parsed.success) return MATCH_NOTHING;
            values.push(parsed.value);
        }
        const cmps = meta.map((f) => compareFor(f.type));
        const lead = (k: unknown): number => {
            for (let j = 0; j < values.length; j++) {
                const c = cmps[j]!((k as Record<string, unknown>)[meta[j]!.name], values[j]);
                if (c !== 0) return c;
            }
            return 0;
        };
        const prefix = "prefix" in query ? query.prefix : undefined;
        if (prefix === undefined) {
            return { lower: (k) => lead(k) >= 0, upper: (k) => lead(k) > 0 };
        }
        const prefixIdx = values.length;
        if (prefixIdx >= meta.length || meta[prefixIdx]!.type.type !== "String") return MATCH_NOTHING;
        const prefixName = meta[prefixIdx]!.name;
        const prefixCmp = cmps[prefixIdx]!;
        return {
            lower: (k) => {
                const c = lead(k);
                return c !== 0 ? c > 0 : prefixCmp((k as Record<string, unknown>)[prefixName], prefix) >= 0;
            },
            upper: (k) => {
                const c = lead(k);
                if (c !== 0) return c > 0;
                const field = (k as Record<string, unknown>)[prefixName] as string;
                return prefixCmp(field, prefix) > 0 && !field.startsWith(prefix);
            },
        };
    }
    // Leading fields are a Struct key's, as the server refuses them of any other.
    if ("fields" in query && query.fields.length > 0) return MATCH_NOTHING;
    if (!("prefix" in query) || query.prefix === undefined || keyType.type !== "String") return MATCH_NOTHING;
    const prefix = query.prefix;
    const cmp = compareFor(keyType);
    return {
        lower: (k) => cmp(k, prefix) >= 0,
        upper: (k) => cmp(k, prefix) > 0 && !(k as string).startsWith(prefix),
    };
}

/**
 * Locates a query over already-decoded keys in canonical order — the inline
 * counterpart of the server's `datasetFindKey`.
 *
 * @param keyType - The collection's Dict key / Set element type
 * @param keys - The decoded keys in canonical (iteration) order
 * @param query - The wire query
 * @returns The match range (an exact-key miss reports its insertion row)
 */
export function findKeyInline(keyType: EastTypeValue, keys: readonly unknown[], query: DatasetKeyQuery): DatasetKeyMatchRange {
    const range = keyRangePredicates(keyType, query);
    if (range === null) {
        const parsed = parseFor(keyType)((query as { key: string }).key);
        if (!parsed.success) return { found: false, row: 0, count: 0 };
        const cmp = compareFor(keyType);
        for (let i = 0; i < keys.length; i++) {
            const order = cmp(keys[i], parsed.value);
            if (order === 0) return { found: true, row: i, count: 1 };
            if (order > 0) return { found: false, row: i, count: 0 };
        }
        return { found: false, row: keys.length, count: 0 };
    }
    let row = keys.findIndex(range.lower);
    if (row === -1) row = keys.length;
    let count = 0;
    while (row + count < keys.length && !range.upper(keys[row + count])) count++;
    return { found: count > 0, row, count };
}

/** A decoded key query, as a keyed paged source's `seek` is asked it. */
export type SeekQueryValue = ValueTypeOf<SeekQueryType>;

/**
 * A key query as the East value a keyed paged source's `seek` is asked
 * (`SeekQueryType`): the inverse of e3-ui-components' `toFindQuery`, so one
 * vocabulary crosses the whole path, typed by the East type the source's
 * `seek` declares (#743 item 7).
 *
 * @remarks
 * A struct key's leading fields keep the prefix on the next field with them:
 * they are asked before a bare prefix.
 *
 * @param query - The query, as {@link parseKeyInput} makes it
 * @returns The query, as `seek` is asked it
 */
export function toSeekQuery(query: DatasetKeyQuery): SeekQueryValue {
    if ("key" in query) return variant("key", query.key);
    if ("fields" in query) {
        return variant("fields", {
            values: [...query.fields],
            prefix: query.prefix !== undefined ? some(query.prefix) : none,
        });
    }
    if ("prefix" in query) return variant("prefix", query.prefix);
    return variant("range", { from: [...(query.from ?? [])], to: [...(query.to ?? [])] });
}

/**
 * A key query as one half-open range over the key's flattened leaves
 * ({@link flattenKeyLeaves}), in the `.east` literals a `range` seek takes.
 *
 * @property from - The literals of the leading leaves the range starts at: its
 *   first key is the first at or past them. Empty, the order's start.
 * @property to - The literals of the leading leaves it ends before: its last
 *   key is the last before the first at or past them. `undefined`, the order's
 *   end.
 * @property exact - For a whole key that no literal can end a range at, since
 *   East writes no value after its last leaf: the key, which the range's first
 *   key is, or no key is.
 */
export interface KeyQueryRange {
    readonly from: readonly string[];
    readonly to: readonly string[] | undefined;
    readonly exact?: unknown;
}

/**
 * A key query restated as one half-open range of the key's flattened leaves:
 * the keys {@link findKeyInline} finds for it, as a `range` seek finds them.
 *
 * @remarks
 * What lets a search over a key be asked inside a longer key that the key
 * ends — an index's `{ik, k}`, the range over `k` after the literals of one
 * `ik` — since the key, prefix and fields forms address `ik` alone there.
 *
 * The keys that share some leading values end at the first key past them: the
 * last value raised to the one after it in East's order (a String's with a NUL
 * after it, the next whole number, millisecond or Float, `true` after `false`,
 * a Variant's next case at its least value), and a value that is its type's
 * last dropped, the one before it raised. The keys a prefix starts end at the
 * prefix with its last character raised by code point, the surrogates passed
 * over, so every bound is well-formed text. Keys nothing follows run to the
 * order's end. Every literal written is one East reads back as its value.
 *
 * @param keyType - The collection's Dict key / Set element type
 * @param query - The query, as {@link parseKeyInput} makes it
 * @returns The range; `null` where no key matches, as {@link findKeyInline}
 *   finds none: a literal that does not read at its type, or a form the key's
 *   type does not take
 * @throws {Error} When the query's leading parts are exact and East writes no
 *   value after the last of them that it reads back — a DateTime at the last
 *   instant it writes, or a part of a type with no next value to write — naming
 *   the part, since a range of them is searched instead
 */
export function keyQueryRange(keyType: EastTypeValue, query: DatasetKeyQuery): KeyQueryRange | null {
    const leaves = flattenKeyLeaves(keyType);
    if ("from" in query || "to" in query) {
        const from = query.from ?? [];
        const to = query.to ?? [];
        if (!readsAt(leaves, from) || !readsAt(leaves, to)) return null;
        return { from: [...from], to: to.length === 0 ? undefined : [...to] };
    }
    if ("key" in query) {
        const parsed = parseFor(keyType)(query.key);
        if (!parsed.success) return null;
        const values = leafValuesOf(keyType, parsed.value);
        const from = printLeaves(leaves, values);
        const end = runEnd(leaves, values);
        // A key with no value after it to write: the first key at or past it is it, or no key is.
        return "past" in end ? { from, to: undefined, exact: parsed.value } : { from, to: end.to };
    }
    const literals = "fields" in query ? query.fields : [];
    const prefix = query.prefix;
    if (keyType.type !== "Struct") {
        if (literals.length > 0 || prefix === undefined || keyType.type !== "String") return null;
        return { from: [printString(prefix)], to: optionalLiteral(prefixEnd(prefix)) };
    }
    const fields = keyType.value as { name: string; type: EastTypeValue }[];
    if (literals.length > fields.length) return null;
    // Each leading field read at its own type, then laid out as its leaves.
    const values: unknown[] = [];
    for (let j = 0; j < literals.length; j++) {
        const parsed = parseFor(fields[j]!.type)(literals[j]!);
        if (!parsed.success) return null;
        values.push(...leafValuesOf(fields[j]!.type, parsed.value));
    }
    const leading = printLeaves(leaves, values);
    if (prefix === undefined) return { from: leading, to: exactRunEnd(leaves, values) };
    if (fields[literals.length]?.type.type !== "String") return null;
    const after = prefixEnd(prefix);
    return {
        from: [...leading, printString(prefix)],
        // Every String the prefix starts: the keys end with the leading values'.
        to: after !== undefined ? [...leading, printString(after)] : exactRunEnd(leaves, values),
    };
}

const printString = printFor(StringType);
const compareString = compareFor(StringType);
const MAX_INTEGER = (1n << 63n) - 1n;
const MIN_INTEGER = -(1n << 63n);
/** The last millisecond a JavaScript Date holds. */
const LAST_INSTANT = 8.64e15;

/** Whether each literal reads at its leading leaf's type. */
function readsAt(leaves: readonly KeyLeaf[], literals: readonly string[]): boolean {
    return literals.length <= leaves.length && literals.every((literal, i) => parseFor(leaves[i]!.type)(literal).success);
}

/** A value's leaves at a type, in the order {@link flattenKeyLeaves} lists them. */
function leafValuesOf(type: EastTypeValue, value: unknown): unknown[] {
    return flattenKeyLeaves(type).map((leaf) => leafAt(value, leaf.path));
}

/** Leading leaves' values as `.east` literals. */
function printLeaves(leaves: readonly KeyLeaf[], values: readonly unknown[]): string[] {
    return values.map((value, i) => printFor(leaves[i]!.type)(value as never));
}

/** A String's literal, or `undefined` for none. */
function optionalLiteral(text: string | undefined): string[] | undefined {
    return text === undefined ? undefined : [printString(text)];
}

/** A value's `.east` literal where East reads it back as the value; `undefined` where it does not. */
function literalOf(type: EastTypeValue, value: unknown): string | undefined {
    const text = printFor(type)(value as never);
    const back = parseFor(type)(text);
    return back.success && compareFor(type)(back.value, value) === 0 ? text : undefined;
}

/**
 * Where the keys whose leading leaves hold `values` end: the first literals
 * every key past them is at or past, or `undefined` where no key is past them;
 * or the leaf (`past`) the value after which East cannot write.
 */
function runEnd(leaves: readonly KeyLeaf[], values: readonly unknown[]): { readonly to: string[] | undefined } | { readonly past: number } {
    for (let i = values.length - 1; i >= 0; i--) {
        const leaf = leaves[i]!;
        const after = valueAfter(leaf.type, values[i]);
        // Its type's last value: the keys end where the value before it changes.
        if (after === "last") continue;
        const literal = after === "unwritable" ? undefined : literalOf(leaf.type, after.value);
        if (literal === undefined) return { past: i };
        return { to: [...printLeaves(leaves, values.slice(0, i)), literal] };
    }
    return { to: undefined };
}

/** {@link runEnd} for leading values a search holds exact, which has no first key to fall back on. */
function exactRunEnd(leaves: readonly KeyLeaf[], values: readonly unknown[]): string[] | undefined {
    const end = runEnd(leaves, values);
    if (!("past" in end)) return end.to;
    const leaf = leaves[end.past]!;
    throw new Error(`A search of keys by their leading parts ends where the last of them changes, and East writes no value after `
        + `${printFor(leaf.type)(values[end.past] as never)} of '${leaf.path.join(".") || "the key"}' (${leaf.type.type}) that it reads back: `
        + `search a range of them instead (from..to)`);
}

/**
 * The String after every String a prefix starts, in East's order, which is by
 * code point: the prefix with its last character's code point one higher, the
 * surrogates passed over, and a last character at the last code point dropped,
 * the one before it raised.
 *
 * @returns The String; `undefined` for a prefix every String past it starts —
 *   an empty one, or one of last code points alone
 */
function prefixEnd(prefix: string): string | undefined {
    const points = [...prefix].map((c) => c.codePointAt(0)!);
    while (points.length > 0) {
        let next = points.pop()! + 1;
        if (next >= 0xD800 && next <= 0xDFFF) next = 0xE000;
        if (next <= 0x10FFFF) return String.fromCodePoint(...points, next);
    }
    return undefined;
}

/** The value after another in East's order: it, none after it (`"last"`), or one no literal of the type can write. */
type ValueAfter = { readonly value: unknown } | "last" | "unwritable";

/** A Variant type's cases, in the order East compares them: by name. */
function casesInOrder(type: EastTypeValue): { name: string; type: EastTypeValue }[] {
    return [...(type.value as { name: string; type: EastTypeValue }[])].sort((a, b) => compareString(a.name, b.name));
}

/**
 * The value just after another in East's order ({@link compareFor}).
 *
 * @remarks
 * Exact for every type East orders by its parts: Null, Boolean, Integer,
 * Float (one step in its bits; -0 before 0, NaN after +Infinity), String (a
 * NUL after it), DateTime (one millisecond), Blob (a zero byte after it), an
 * Array (its element type's least value after it), a Struct (its last part
 * that has one raised, the parts after it at their least) and a Variant (its
 * value's next, else its next case at that case's least). A Set, a Dict and
 * the types no key holds have none written here.
 */
function valueAfter(type: EastTypeValue, value: unknown): ValueAfter {
    switch (type.type) {
        case "Null": return "last";
        case "Boolean": return value ? "last" : { value: true };
        case "Integer": return (value as bigint) >= MAX_INTEGER ? "last" : { value: (value as bigint) + 1n };
        case "Float": return floatAfter(value as number);
        case "String": return { value: `${value as string}\u0000` };
        case "DateTime": {
            const at = (value as Date).getTime() + 1;
            return at > LAST_INSTANT ? "last" : { value: new Date(at) };
        }
        case "Blob": {
            const bytes = value as Uint8Array;
            const next = new Uint8Array(bytes.length + 1);
            next.set(bytes);
            return { value: next };
        }
        case "Array": {
            const least = leastValue(type.value as EastTypeValue);
            return least === undefined ? "unwritable" : { value: [...(value as unknown[]), least.value] };
        }
        case "Struct": {
            const fields = type.value as { name: string; type: EastTypeValue }[];
            const struct = value as Record<string, unknown>;
            for (let i = fields.length - 1; i >= 0; i--) {
                const after = valueAfter(fields[i]!.type, struct[fields[i]!.name]);
                if (after === "last") continue;
                if (after === "unwritable") return after;
                const next: Record<string, unknown> = {};
                for (const [j, field] of fields.entries()) {
                    if (j < i) next[field.name] = struct[field.name];
                    else if (j === i) next[field.name] = after.value;
                    else {
                        const least = leastValue(field.type);
                        if (least === undefined) return "unwritable";
                        next[field.name] = least.value;
                    }
                }
                return { value: next };
            }
            return "last";
        }
        case "Variant": {
            const cases = casesInOrder(type);
            const held = value as variant<string, unknown>;
            const at = cases.findIndex((c) => c.name === held.type);
            const after = valueAfter(cases[at]!.type, held.value);
            if (after === "unwritable") return after;
            if (after !== "last") return { value: variant(held.type, after.value) };
            const next = cases[at + 1];
            if (next === undefined) return "last";
            const least = leastValue(next.type);
            return least === undefined ? "unwritable" : { value: variant(next.name, least.value) };
        }
        default: return "unwritable";
    }
}

/** The Float after another in East's order: one step in its bits, -0 before 0, NaN after +Infinity and last. */
function floatAfter(x: number): ValueAfter {
    if (Number.isNaN(x)) return "last";
    if (x === Infinity) return { value: NaN };
    if (Object.is(x, -0)) return { value: 0 };
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, x);
    const bits = view.getBigUint64(0);
    // A positive number's next is a step up; a negative one's a step toward zero, which ends at -0.
    view.setBigUint64(0, x > 0 || Object.is(x, 0) ? bits + 1n : bits - 1n);
    return { value: view.getFloat64(0) };
}

/**
 * The least value of a type in East's order, where a literal writes one; a
 * DateTime's, the first instant a Date holds, is before what East writes.
 */
function leastValue(type: EastTypeValue): { readonly value: unknown } | undefined {
    switch (type.type) {
        case "Null": return { value: null };
        case "Boolean": return { value: false };
        case "Integer": return { value: MIN_INTEGER };
        case "Float": return { value: -Infinity };
        case "String": return { value: "" };
        case "Blob": return { value: new Uint8Array(0) };
        case "Array": return { value: [] };
        case "Struct": {
            const least: Record<string, unknown> = {};
            for (const field of type.value as { name: string; type: EastTypeValue }[]) {
                const value = leastValue(field.type);
                if (value === undefined) return undefined;
                least[field.name] = value.value;
            }
            return { value: least };
        }
        case "Variant": {
            const first = casesInOrder(type)[0];
            if (first === undefined) return undefined;
            const value = leastValue(first.type);
            return value === undefined ? undefined : { value: variant(first.name, value.value) };
        }
        default: return undefined;
    }
}
