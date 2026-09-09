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
 * server's fence search, for inline values. No DOM, no React: the browser's
 * search box and the terminal's `/find` share it.
 *
 * @packageDocumentation
 */

import { compareFor, parseFor, printFor, StringType, type EastTypeValue } from "@elaraai/east";

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
 * prefix (`prefix`), or — for struct keys — exact leading-field literals
 * (`fields`, declaration order) optionally followed by a `prefix` on the
 * next (String) field. Every form addresses one contiguous row range in
 * the canonical key order.
 */
export type DatasetKeyQuery =
    | { key: string }
    | { prefix: string }
    | { fields: string[]; prefix?: string };

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
 * parse. Struct keys: `(` opens a whole-key `.east` literal; otherwise
 * comma-separated leading field values — exact for all but the last
 * segment (unquoted String segments need no quotes), the last a prefix on
 * a String field or an exact value otherwise, and a trailing comma
 * narrows to the leading exact fields.
 *
 * @param keyType - The collection's Dict key / Set element type
 * @param text - The raw search input
 * @returns The query to send, or the hint to display
 */
export function parseKeyInput(keyType: EastTypeValue, text: string): ParsedKeyInput {
    const fields = structKeyFields(keyType);
    if (fields === null) {
        if (keyType.type === "String") return { kind: "query", query: { prefix: text } };
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

/** Predicates that match no key — a defensively-handled malformed query. */
const MATCH_NOTHING = { lower: () => false, upper: () => false } as const;

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
        const prefix = query.prefix;
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
