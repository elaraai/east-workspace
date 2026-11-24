/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, expect, test } from "vitest";
import { pagePlace } from "./page-place.js";

describe("where a page stands among its rows", () => {
    test("the first page starts at the first row and ends at its last", () => {
        expect(pagePlace(0, 25)).toEqual({ first: 1, last: 25 });
    });

    test("a middle page follows the rows before it", () => {
        expect(pagePlace(100, 25)).toEqual({ first: 101, last: 125 });
    });

    test("the last page holds what is left: its last row is the last of them all", () => {
        // 1,482 rows, 25 a page: the sixtieth page holds the seven left.
        expect(pagePlace(1475, 7)).toEqual({ first: 1476, last: 1482 });
    });

    test("a page of one row starts and ends on it", () => {
        expect(pagePlace(1, 1)).toEqual({ first: 2, last: 2 });
    });

    test("a page that holds no rows has no first row, and ends where it would start", () => {
        expect(pagePlace(0, 0)).toEqual({ first: 0, last: 0 });
        expect(pagePlace(75, 0)).toEqual({ first: 0, last: 75 });
    });
});
