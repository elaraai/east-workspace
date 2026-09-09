/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The B§3 quantity grammar: digits, an optional decimal, a suffix `l` (×1),
 * `k` (×10³) or `m3` / `m³` (×10³); commas and spaces ignored; the result a
 * rounded integer. An integer column uses the same grammar without a unit.
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
    const m = /^(-?\d+(?:\.\d+)?)(m3|m³|k|l)?$/.exec(t);
    if (m === null) return null;
    const mult = m[2] === "m3" || m[2] === "m³" || m[2] === "k" ? 1e3 : 1;
    const n = Math.round(Number(m[1]) * mult);
    return Number.isFinite(n) ? n : null;
}

/** The bare clipboard / edit form of a number — no grouping, no unit. */
export function formatNumberBare(n: number): string {
    return Number.isFinite(n) ? String(n) : "";
}
