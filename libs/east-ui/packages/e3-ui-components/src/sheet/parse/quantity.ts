/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The B§3 quantity grammar: digits, an optional decimal, an optional
 * magnitude suffix `k` (×10³) or `m` (×10⁶); the digit-group separator and
 * any space ignored; the result the number as written — `7.5` is 7.5, as a
 * quantity's Float field holds it and its cell prints it. A suffix moves the
 * decimal point in the text, so `1.005k` is 1005 exactly, where multiplying
 * would leave 1004.9999999999999. It reads the separators of the viewer's
 * language (#852) — `1,234.5` in English, `1.234,5` in German, `1 234,5` in
 * French — with ASCII digits. The unit is the column's, never typed — an
 * integer column uses the same grammar, and refuses a fraction. A number
 * field takes, key by key, what the grammar reads ({@link typedQuantity}).
 *
 * @packageDocumentation
 */

import type { Formatters } from "@elaraai/east-ui-components";

/** How a language writes a number: its digit-group and decimal separators. */
export type NumberSeparators = Formatters["separators"];

/** The text as the grammar reads it: every space and group separator gone, the decimal a `.`, the suffix lower case. */
function normalised(text: string, separators: NumberSeparators): string {
    // `\s` covers the no-break and narrow no-break spaces French groups with.
    const t = text.replace(/\s/g, "").split(separators.group).join("").toLowerCase();
    return separators.decimal !== "." ? t.replace(separators.decimal, ".") : t;
}

/**
 * Parse typed text to a number.
 *
 * @param text - The typed or pasted text
 * @param separators - The viewer's language's separators (`Formatters.separators`)
 * @returns the parsed value; `undefined` for an empty buffer; `null` when unrecognised
 */
export function parseQuantity(text: string, separators: NumberSeparators): number | null | undefined {
    const t = normalised(text, separators);
    if (t === "") return undefined;
    const m = /^(-?\d+)(?:\.(\d+))?(k|m)?$/.exec(t);
    if (m === null) return null;
    // The suffix's digits move from the fraction to the whole part, padded with zeros, so the number is read once.
    const shift = m[3] === "k" ? 3 : m[3] === "m" ? 6 : 0;
    const fraction = (m[2] ?? "").padEnd(shift, "0");
    const n = Number(`${m[1]}${fraction.slice(0, shift)}.${fraction.slice(shift)}`);
    return Number.isFinite(n) ? n : null;
}

/** What a number field does with a key, by the text it would hold once the key lands. */
export type QuantityKey =
    /** The text is a number, or on its way to one — a lone minus, a trailing decimal separator: the key lands. */
    | { kind: "take" }
    /** A magnitude suffix completes a number: the field holds the number it reads, so it steps from there (`1.005k` → 1005). */
    | { kind: "read"; n: number }
    /** The grammar never reads it. */
    | { kind: "refuse" };

/**
 * What a number field does with a typed key (B§3) — the grammar decides, not
 * the field's own format, so a `k`, an `m` and a decimal separator are never
 * dropped without a word. A fraction in an integer column is taken: the
 * strip calls it unrecognised and the commit refuses it, where dropping its
 * point turned `2.5` into 25.
 *
 * @param text - The field's text once the key lands at the caret
 * @param separators - The viewer's language's separators (`Formatters.separators`)
 * @returns whether the key lands, completes a number the field then holds, or is refused
 */
export function typedQuantity(text: string, separators: NumberSeparators): QuantityKey {
    const t = normalised(text, separators);
    if (/^-?\d*(?:\.\d*)?$/.test(t)) return { kind: "take" };
    const n = /[km]$/.test(t) ? parseQuantity(text, separators) : null;
    return n === null || n === undefined ? { kind: "refuse" } : { kind: "read", n };
}

/** The bare clipboard / edit form of a number — no grouping, no unit, the
 *  viewer's decimal separator: `1234.5`, `1234,5` in German (#852). */
export function formatNumberBare(n: number, words: Formatters): string {
    return Number.isFinite(n) ? words.bare(n) : "";
}
