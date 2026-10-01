/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shape of a query at a step (#933): what the checker says a stage gives,
 * and what the steps know besides — the cases rows are narrowed to, a Keep
 * the first bound, and what a row is called.
 *
 * @packageDocumentation
 */

import { NeverType, OptionType, isTypeEqual, type EastType, type JqMultiplicity } from "@elaraai/east";

/**
 * What a stage gives: `rows` — an array (or set) of records, which the
 * steps that keep, reshape and total rows take; `one` — any other value, or a
 * stream; `unknown` — the checker could not tell, after a problem.
 */
export type ShapeKind = "rows" | "one" | "unknown";

/** The shape of a query at a step. */
export interface Shape {
    /** What it gives. */
    readonly kind: ShapeKind;
    /** The stage's type, as the checker gives it; `Never` when unknown. */
    readonly type: EastType;
    /** For rows, the record each row is. */
    readonly row: EastType | undefined;
    /** How many outputs the program has given here, as the checker counts them. */
    readonly multiplicity: JqMultiplicity | null;
    /**
     * For rows, each variant field a Keep rows where step narrowed to one
     * case, with the case: its payload's fields are exact, not missing.
     */
    readonly narrowed: ReadonlyMap<string, string>;
    /** For rows, the most a Keep the first step lets through. */
    readonly limit: number | undefined;
    /** What one row, or the value, is called: "order", "line", "part". */
    readonly noun: string;
}

const NONE_NARROWED: ReadonlyMap<string, string> = new Map();

/** The shape after a problem the checker stopped at. */
export const UNKNOWN: Shape = {
    kind: "unknown",
    type: NeverType,
    row: undefined,
    multiplicity: null,
    narrowed: NONE_NARROWED,
    limit: undefined,
    noun: "row",
};

/**
 * A type read through its recursive wrapper: what a value of it is made of.
 *
 * @param type - a type
 * @returns its node, for a recursive type; itself otherwise
 */
export function unwrapRecursive(type: EastType): EastType {
    let t = type;
    while (t.type === "Recursive") t = t.node as EastType;
    return t;
}

/**
 * The payload of an option type.
 *
 * @param type - a type
 * @returns `T` when the type is `Option<T>`, decided by East's type equality;
 *   `undefined` otherwise
 */
export function optionPayload(type: EastType): EastType | undefined {
    const t = unwrapRecursive(type);
    if (t.type !== "Variant") return undefined;
    const payload = (t.cases as Record<string, EastType>)["some"];
    return payload !== undefined && isTypeEqual(t, OptionType(payload)) ? payload : undefined;
}

/**
 * A type read through its option and recursive wrappers.
 *
 * @param type - a type
 * @returns what a present value of it is made of
 */
export function baseType(type: EastType): EastType {
    const payload = optionPayload(type);
    return unwrapRecursive(payload ?? type);
}

/**
 * The type a read gives where the value can be missing: `Option<T>`, or `T`
 * itself when it is already an option or `Null`.
 *
 * @param type - the value's type
 * @returns the type of a read that can miss it
 */
export function orMissing(type: EastType): EastType {
    const t = unwrapRecursive(type);
    if (t.type === "Null" || optionPayload(t) !== undefined) return type;
    return OptionType(type);
}

/**
 * The record of each row, when a type is rows: an array or a set of structs.
 *
 * @param type - a stage's type
 * @returns the struct, or `undefined` when the type is not rows
 */
export function rowOf(type: EastType): EastType | undefined {
    const t = unwrapRecursive(type);
    const element = t.type === "Array" ? t.value as EastType : t.type === "Set" ? t.key as EastType : undefined;
    if (element === undefined) return undefined;
    const row = unwrapRecursive(element);
    return row.type === "Struct" ? row : undefined;
}

/**
 * The shape of a stage.
 *
 * @param type - the stage's type
 * @param multiplicity - how many outputs the program has given there
 * @param known - what the steps know besides: the narrowed variant fields,
 *   a Keep the first bound, and the noun
 * @returns the shape: rows when one value is an array or set of structs
 */
export function shapeOf(
    type: EastType,
    multiplicity: JqMultiplicity | null,
    known: { narrowed?: ReadonlyMap<string, string>; limit?: number | undefined; noun: string },
): Shape {
    const row = multiplicity === "one" ? rowOf(type) : undefined;
    return {
        kind: row !== undefined ? "rows" : "one",
        type,
        row,
        multiplicity,
        narrowed: row !== undefined ? known.narrowed ?? NONE_NARROWED : NONE_NARROWED,
        limit: row !== undefined ? known.limit : undefined,
        noun: known.noun,
    };
}

/**
 * The singular of a plural name, as English mostly forms it: `orders` →
 * `order`, `categories` → `category`, `statuses` → `status`; a name that is
 * not plural is itself.
 *
 * @param word - the name
 * @returns its singular
 */
export function singular(word: string): string {
    if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
    if (/(ss|us|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
    if (/[^s]s$/.test(word)) return word.slice(0, -1);
    return word;
}
