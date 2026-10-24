/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the driver's module loads east-ui-components' entry,
 * which needs one as it loads.
 *
 * What the footer's loading line names of a paged sheet's reads (#1398,
 * CL3): of the windows in flight, the stretch of adjacent ones nearest the
 * viewport's window, first and last element, the last ending at the source's
 * count — pure — and the driver handing back one object for it while it
 * holds, so the footer it feeds, which measures itself as it renders, renders
 * again only as it moves. The Sheet's DOM tests carry it into the footer.
 */

import { describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { none, some } from "@elaraai/east";
import { UIStore } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { SHEET_PAGE_SIZE, readingStretch, useSheetPaging } from "./paging.js";
import type { SheetPagedSourceValue } from "./values.js";

describe("readingStretch", () => {
    test("nothing in flight, nothing named", () => {
        expect(readingStretch([], 0, 1_000)).toBeUndefined();
    });

    test("one stretch of adjacent windows: its first and last element, the last ending at the source's count", () => {
        expect(readingStretch([1, 2], 0, 1_000)).toEqual({ from: SHEET_PAGE_SIZE, to: 3 * SHEET_PAGE_SIZE - 1 });
        expect(readingStretch([4], 4, 900)).toEqual({ from: 4 * SHEET_PAGE_SIZE, to: 899 });
        // A count not known yet: the window's own end.
        expect(readingStretch([4], 4, undefined)).toEqual({ from: 4 * SHEET_PAGE_SIZE, to: 5 * SHEET_PAGE_SIZE - 1 });
    });

    test("of several stretches, the one nearest the viewport's window — the one it is in, else the closer", () => {
        expect(readingStretch([1, 2, 7, 8], 7, 2_000)).toEqual({ from: 7 * SHEET_PAGE_SIZE, to: 9 * SHEET_PAGE_SIZE - 1 });
        expect(readingStretch([1, 2, 7, 8], 4, 2_000)).toEqual({ from: SHEET_PAGE_SIZE, to: 3 * SHEET_PAGE_SIZE - 1 });
        expect(readingStretch([1, 2, 7, 8], 5, 2_000)).toEqual({ from: 7 * SHEET_PAGE_SIZE, to: 9 * SHEET_PAGE_SIZE - 1 });
    });
});

describe("useSheetPaging's reading", () => {
    test("is one object while the stretch in flight holds, and a new one once it moves", () => {
        initializeStore(new UIStore());
        // A thousand rows, every window of them still on its way.
        const source: SheetPagedSourceValue = { id: "sheet_reading", page: () => none, total: () => some(1_000n), seek: none };
        const heightOf = () => 36;
        const { result, rerender } = renderHook(() => useSheetPaging(source, heightOf));
        const reading = result.current.reading;
        expect(reading?.from).toBe(0);
        // Rendered again with nothing moved: the same object, so a memo over it holds.
        rerender();
        expect(result.current.reading).toBe(reading);
        // The viewport moves down to element 700: the windows around it are asked, and the stretch is the window the
        // view shows — never the windows read ahead of it, which nothing on screen waits for (#1398, F12).
        act(() => { result.current.reportViewport({ kind: "row", offset: 700 }, false); });
        expect(result.current.pending).toEqual([0, 1, 2, 3, 4]);
        expect(result.current.reading).not.toBe(reading);
        expect(result.current.reading).toEqual({ from: 3 * SHEET_PAGE_SIZE, to: 4 * SHEET_PAGE_SIZE - 1 });
    });
});
