/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Paged-preview page retention: loaded pages hold fully materialized
 * ValueTree rows (measured ~10-20MB of heap per 500-row window on
 * GB-scale wide-row datasets), so retention must stay bounded around the
 * current window — unbounded accumulation OOMs the extension webview, and
 * re-flattening every retained page on each arrival is what made
 * scrolling degrade over time.
 */

import { describe, test, expect } from "vitest";
import { pruneRetainedPages } from "./PagedDatasetPreview.js";

function pagesOf(...keys: number[]): ReadonlyMap<number, string> {
    return new Map(keys.map((k) => [k, `page-${k}`]));
}

describe("pruneRetainedPages", () => {
    test("returns the same reference while under the cap (no re-render churn)", () => {
        const pages = pagesOf(0, 1, 2);
        expect(pruneRetainedPages(pages, 1, 2, 8)).toBe(pages);
    });

    test("keeps the current window and the nearest pages, dropping the farthest", () => {
        const pages = pagesOf(0, 1, 2, 3, 10, 11, 12, 40, 41, 42);
        const kept = pruneRetainedPages(pages, 10, 12, 6);
        // Window pages (distance 0) always survive; then nearest by distance
        // — pages 1..3 (distance 7..9) beat pages 40..42 (distance 28..30).
        expect([...kept.keys()]).toEqual([1, 2, 3, 10, 11, 12]);
        expect(kept.get(10)).toBe("page-10");
    });

    test("a far jump retains the destination window and evicts the origin", () => {
        const pages = pagesOf(0, 1, 2, 3, 4, 5, 6, 7);
        const kept = pruneRetainedPages(pages, 1000, 1001, 4);
        // No loaded page is in the window yet (the jump just landed) — the
        // nearest-to-window pages are kept until the destination loads.
        expect(kept.size).toBe(4);
        expect([...kept.keys()]).toEqual([4, 5, 6, 7]);
    });
});
