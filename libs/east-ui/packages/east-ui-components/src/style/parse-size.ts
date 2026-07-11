/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The one place every component parses a definable size (`width` / `height` /
 * `minWidth` / `maxWidth` / `minHeight` / `maxHeight`, …) into a CSS length
 * (#320). Size props stay plain `OptionType(StringType)` in the IR; the string
 * is normalised here at render time so `"fill"`, a bare number, a percentage,
 * `calc(...)`, and explicit `px` all behave identically everywhere.
 *
 * Rules (first match wins):
 * - `undefined` / empty → `undefined` (unset).
 * - `"fill"` → `"100%"` (fill the parent box — the parent must have a definite
 *   / used size).
 * - a bare number, e.g. `"320"` or `"12.5"` → `"320px"` (CSS-length intent).
 * - anything else — an explicit CSS length (`"320px"`, `"50%"`, `"100vh"`,
 *   `"calc(100% - 40px)"`) or a design-system size token (`"full"`, `"sm"`) —
 *   passes through unchanged.
 *
 * @param raw - the decoded size string (or `undefined`)
 * @returns a CSS length string, or `undefined` when unset
 */
export function parseCssSize(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    const s = String(raw).trim();
    if (s === "") return undefined;
    if (s === "fill") return "100%";
    // A bare number (integer or decimal) is a CSS-length intent → px.
    if (/^-?\d*\.?\d+$/.test(s)) return `${s}px`;
    return s;
}
