/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A mounted row's height, as a virtualizer places rows by it: its drawn
 * height while that is its layout's — to the last fraction, as a row no
 * transform touches has always measured — and its layout's own, as the
 * virtualizer's resize observer reports it, where an ancestor draws the row
 * under a transform: a popover on its way in, a zoomed canvas.
 */

import { describe, expect, test } from "vitest";
import { rowLayoutHeight } from "./row-height.js";

/** A row the page draws `drawn` px tall. */
function rowDrawn(drawn: number): HTMLElement {
    const row = document.createElement("div");
    row.getBoundingClientRect = () => new DOMRect(0, 0, 320, drawn);
    return row;
}

/** What a resize observer reports of a row laid out `laid` px tall. */
function reported(row: Element, laid: number): ResizeObserverEntry {
    const box = [{ blockSize: laid, inlineSize: 320 }];
    return { target: row, contentRect: new DOMRect(0, 0, 320, laid), borderBoxSize: box, contentBoxSize: box, devicePixelContentBoxSize: box };
}

describe("rowLayoutHeight", () => {
    test("is the drawn height as a row mounts, before its observer reports", () => {
        expect(rowLayoutHeight(rowDrawn(36.796875), undefined)).toBe(36.796875);
    });

    test("is the drawn height where the observer reports the same box: a row no transform touches measures as it always has", () => {
        const row = rowDrawn(36.796875);
        expect(rowLayoutHeight(row, reported(row, 36.796875))).toBe(36.796875);
        // To within the layout's grain: the drawn one is kept, never swapped for a neighbour of it.
        expect(rowLayoutHeight(row, reported(row, 36.8125))).toBe(36.796875);
    });

    test("is the layout's height where an ancestor draws the row scaled: a popover on its way in, at 95%", () => {
        const row = rowDrawn(34.2);
        expect(rowLayoutHeight(row, reported(row, 36))).toBe(36);
        // A canvas zoomed in draws it larger than it is laid out.
        const zoomed = rowDrawn(54);
        expect(rowLayoutHeight(zoomed, reported(zoomed, 36))).toBe(36);
    });

    test("is the drawn height where the observer reports no border box: an older engine, a test's stand-in", () => {
        const row = rowDrawn(34.2);
        const { borderBoxSize: _none, ...bare } = reported(row, 36);
        expect(rowLayoutHeight(row, bare as ResizeObserverEntry)).toBe(34.2);
    });
});
