/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Where a place of the row space stands once a gesture has put rows under
 * other keys (`key`, east-workspace#1709): what the ring, a range and an open
 * editor follow. A row follows to the key it stands under now; a group that
 * moved takes its lines and its blank line with it, each named after its
 * group; and a padding row's place is the gesture's own to set. And whether a
 * row space holds the rows it held in another order, which each place then
 * follows its row through.
 */

import { describe, expect, test } from "vitest";
import { blankLineId, lineId } from "./model.js";
import { followRows, rekeyedSlots, rowsReordered, type RowSlot } from "./items.js";

/** Where each place of `before` stands in `after`, in order. */
const places = (before: readonly (RowSlot | undefined)[], after: readonly (RowSlot | undefined)[]): (number | null | undefined)[] => {
    const follow = followRows(before, after);
    return before.map((_slot, r) => follow(r));
};

describe("a place of the row space follows its row under another key (east-workspace#1709)", () => {
    test("ruling 6 — a row moved under another key is followed to where it stands now, a row that kept its key to its own, and a padding row's place is left to the gesture", () => {
        // B-2 moves under A-1: the rows stand in key order, so it comes first.
        const before: RowSlot[] = [{ id: "B-1" }, { id: "B-2" }, { blank: 0 }];
        const after: RowSlot[] = [{ id: "A-1" }, { id: "B-1" }, { blank: 0 }];
        expect(places(rekeyedSlots(before, new Map([["B-2", "A-1"]])), after)).toEqual([1, 0, undefined]);
    });

    test("ruling 6 — a group moved under another key takes its lines and its blank line with it: a place on one of its lines follows the line, never dropped as a row that left", () => {
        // The order R-1, its two lines and its blank line, then R-5: R-1 moves under R-9, past R-5.
        const before: RowSlot[] = [
            { id: "R-1" }, { id: lineId("R-1", "L1") }, { id: lineId("R-1", "L2") }, { id: blankLineId("R-1") },
            { id: "R-5" }, { id: lineId("R-5", "L1") }, { id: blankLineId("R-5") },
        ];
        const after: RowSlot[] = [
            { id: "R-5" }, { id: lineId("R-5", "L1") }, { id: blankLineId("R-5") },
            { id: "R-9" }, { id: lineId("R-9", "L1") }, { id: lineId("R-9", "L2") }, { id: blankLineId("R-9") },
        ];
        expect(places(rekeyedSlots(before, new Map([["R-1", "R-9"]])), after)).toEqual([3, 4, 5, 6, 0, 1, 2]);
    });
});

describe("the same rows in another order (east-workspace#1709)", () => {
    const rows = (...ids: string[]): RowSlot[] => ids.map((id) => ({ id }));

    test("a Save's row standing where it was left, then where its source reads it: the same rows reordered, and each place follows its row", () => {
        // A lane saved under 107 stands in the place it was typed in, then at the rows' end, then in its key's place.
        const typed = rows("101", "107", "103", "201"), landed = rows("101", "103", "201", "107"), read = rows("101", "103", "107", "201");
        expect([rowsReordered(typed, landed), rowsReordered(landed, read)]).toEqual([true, true]);
        expect([places(typed, landed), places(landed, read)]).toEqual([[0, 3, 1, 2], [0, 1, 3, 2]]);
    });

    test("the same rows in the same order, a row added or gone, another in one's place, and a place that is no row's are none of them reordered", () => {
        const held = rows("101", "102", "103");
        expect([
            rowsReordered(held, rows("101", "102", "103")),
            rowsReordered(held, rows("101", "102", "103", "104")),
            rowsReordered(held, rows("101", "103")),
            rowsReordered(held, rows("102", "101", "109")),
            rowsReordered([...held, { blank: 0 }], [{ id: "102" }, { id: "101" }, { id: "103" }, { blank: 0 }]),
            rowsReordered([{ id: "101" }, undefined], [undefined, { id: "101" }]),
        ]).toEqual([false, false, false, false, false, false]);
    });
});
