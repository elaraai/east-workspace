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
 * CL3), pure: of the windows in flight, the stretch of adjacent ones nearest
 * the viewport's window, first and last element, the last ending at the
 * source's count. The Sheet's DOM tests carry it into the footer.
 */

import { describe, expect, test } from "vitest";
import { SHEET_PAGE_SIZE, readingStretch } from "./paging.js";

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
