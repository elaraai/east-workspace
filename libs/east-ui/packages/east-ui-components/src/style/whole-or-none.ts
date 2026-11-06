/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Words shown whole or not at all (3 Nov 2026): a label a row may be short of
 * room for, where part of it would say something else — `No changes` cut to
 * `No`. Only CSS, so it measures nothing and moves nothing as fonts land.
 *
 * @remarks
 * The box wraps its items and clips to one line, and its first item is an
 * empty `::before` that holds that line open. An item that does not fit beside
 * it wraps to the next line, whole, where the clip hides it: still in the page,
 * so a screen reader reads it. Several items — a count over two sources — each
 * show or go on their own, the first that does not fit and all after it.
 *
 * ```ts
 * import { wholeOrNone } from "../../style/whole-or-none.js";
 * base: { label: { ...wholeOrNone("24px") } }
 * ```
 *
 * @param height - The one line's height: a CSS length
 * @returns The fragment a slot spreads
 */
export function wholeOrNone(height: string) {
    return {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        alignContent: "flex-start",
        height,
        overflow: "hidden",
        "&::before": { content: '""', flex: "none", width: "0", height },
    } as const;
}
