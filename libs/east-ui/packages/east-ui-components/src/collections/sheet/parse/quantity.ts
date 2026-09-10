/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The B§3 quantity grammar: digits, an optional decimal, an optional
 * magnitude suffix `k` (×10³) or `m` (×10⁶); commas and spaces ignored; the
 * result a rounded integer. The unit is the column's, never typed — an
 * integer column uses the same grammar.
 *
 * @packageDocumentation
 */

/**
 * Parse typed text to a number.
 *
 * @returns the rounded value; `undefined` for an empty buffer; `null` when unrecognised
 */
export function parseQuantity(text: string): number | null | undefined {
    const t = text.replace(/[,\s]/g, "").toLowerCase();
    if (t === "") return undefined;
    const m = /^(-?\d+(?:\.\d+)?)(k|m)?$/.exec(t);
    if (m === null) return null;
    const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1;
    const n = Math.round(Number(m[1]) * mult);
    return Number.isFinite(n) ? n : null;
}

/** The bare clipboard / edit form of a number — no grouping, no unit. */
export function formatNumberBare(n: number): string {
    return Number.isFinite(n) ? String(n) : "";
}
