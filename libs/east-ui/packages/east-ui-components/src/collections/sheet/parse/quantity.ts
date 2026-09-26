/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The B§3 quantity grammar: digits, an optional decimal, an optional
 * magnitude suffix `k` (×10³) or `m` (×10⁶); the digit-group separator and
 * any space ignored; the result a rounded integer. It reads the separators of
 * the viewer's language (#852) — `1,234.5` in English, `1.234,5` in German,
 * `1 234,5` in French — with ASCII digits. The unit is the column's, never
 * typed — an integer column uses the same grammar.
 *
 * @packageDocumentation
 */

import type { Formatters } from "../../../format/index.js";

/** How a language writes a number: its digit-group and decimal separators. */
export type NumberSeparators = Formatters["separators"];

/**
 * Parse typed text to a number.
 *
 * @param text - The typed or pasted text
 * @param separators - The viewer's language's separators (`Formatters.separators`)
 * @param round - Apply the quantity column's display rounding; integer validation passes false
 * @returns the parsed value; `undefined` for an empty buffer; `null` when unrecognised
 */
export function parseQuantity(text: string, separators: NumberSeparators, round = true): number | null | undefined {
    // Every space goes — `\s` covers the no-break and narrow no-break spaces
    // French groups with — then the group separator; the decimal reads as `.`.
    let t = text.replace(/\s/g, "").split(separators.group).join("").toLowerCase();
    if (separators.decimal !== ".") t = t.replace(separators.decimal, ".");
    if (t === "") return undefined;
    const m = /^(-?\d+(?:\.\d+)?)(k|m)?$/.exec(t);
    if (m === null) return null;
    const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1;
    const parsed = Number(m[1]) * mult;
    const n = round ? Math.round(parsed) : parsed;
    return Number.isFinite(n) ? n : null;
}

/** The bare clipboard / edit form of a number — no grouping, no unit, the
 *  viewer's decimal separator: `1234.5`, `1234,5` in German (#852). */
export function formatNumberBare(n: number, words: Formatters): string {
    return Number.isFinite(n) ? words.bare(n) : "";
}
