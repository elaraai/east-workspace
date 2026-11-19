/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A segment strip's icons, measured for the specs that hold them at their
 * segments' middles on whole pixels, as an icon button's are (the
 * `iconButton` recipe's even glyph in its even square): as many rows above
 * each as below, each a whole number.
 */

import type { Locator } from "playwright/test";

/** An icon's rows above and below it, inside its segment's edge, and the glyph's height. */
export interface Rows {
    readonly label: string;
    readonly glyph: number;
    readonly above: number;
    readonly below: number;
}

/**
 * Each segment's icon, as `selector` finds the segments in `scope`.
 *
 * @param scope - Where the segments lie
 * @param selector - The segments
 * @returns Each one's label, its glyph's height, and the rows above and below it
 */
export function iconRows(scope: Locator, selector: string): Promise<Rows[]> {
    return scope.locator(selector).evaluateAll((segments) => segments.map((segment) => {
        const box = segment.getBoundingClientRect();
        const look = getComputedStyle(segment);
        const top = box.top + parseFloat(look.borderTopWidth);
        const bottom = box.bottom - parseFloat(look.borderBottomWidth);
        const glyph = segment.querySelector("svg")!.getBoundingClientRect();
        const r = (n: number) => Math.round(n * 1000) / 1000;
        return { label: segment.getAttribute("aria-label") ?? segment.textContent ?? "", glyph: r(glyph.height), above: r(glyph.top - top), below: r(bottom - glyph.bottom) };
    }));
}

/**
 * What is off: each icon whose rows differ above and below it, or fall between pixels.
 *
 * @param rows - The icons' rows
 * @returns Those off their middle
 */
export const offCentre = (rows: readonly Rows[]): Rows[] => rows.filter((row) => row.above !== row.below || !Number.isInteger(row.above));
