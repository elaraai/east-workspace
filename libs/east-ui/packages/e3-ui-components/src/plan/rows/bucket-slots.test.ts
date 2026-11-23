/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a bucket cell's tiles stand (#1735): the day's pitch cut into whole, halves or quarters by how many tiles it
 * holds — each slot's width rounded to a whole pixel before its offsets — a tile 2px inside every rule and five apart
 * from the next; from five, three tiles and a `+n` in the last quarter. Narrow days keep the floor (ruled 23 Nov
 * 2026): slots under it give way to fewer, the `+n` taking the rest; and a day with no room for one tile draws its
 * lone tile as a mark across it, or its chip alone.
 */

import { describe, expect, test } from "vitest";
import { bucketSlots, dayRoom } from "./bucket-slots.js";

/** A tile's floor and the least it draws at all, as the Plan's geometry has them. */
const FLOOR = 20;
const LEAST = 3;
/** The tiles' places, as `[index, left, width]`. */
const places = (pitch: number, count: number, kept?: number) => {
    const slots = bucketSlots(pitch, count, kept, FLOOR, LEAST);
    if (slots.kind !== "slots") return slots;
    return { tiles: slots.tiles.map((t) => [t.index, t.left, t.width]), more: slots.more === undefined ? undefined : [slots.more.left, slots.more.width, slots.more.count] };
};

describe("a bucket cell's slots (#1735)", () => {
    test("at B 132, one tile takes the day — 2px in from the rule before it, 127 wide, 2px short of its own", () => {
        expect(places(132, 1)).toEqual({ tiles: [[0, 2, 127]], more: undefined });
    });

    test("two take halves, 61 wide and 5 apart, as across a rule", () => {
        expect(places(132, 2)).toEqual({ tiles: [[0, 2, 61], [1, 68, 61]], more: undefined });
    });

    test("three or four take quarters, 28 wide: three leave the last quarter empty", () => {
        expect(places(132, 3)).toEqual({ tiles: [[0, 2, 28], [1, 35, 28], [2, 68, 28]], more: undefined });
        expect(places(132, 4)).toEqual({ tiles: [[0, 2, 28], [1, 35, 28], [2, 68, 28], [3, 101, 28]], more: undefined });
    });

    test("five or more: three tiles and a +n in the last quarter, counting the rest", () => {
        expect(places(132, 5)).toEqual({ tiles: [[0, 2, 28], [1, 35, 28], [2, 68, 28]], more: [101, 28, 2] });
        expect(places(132, 9)).toEqual({ tiles: [[0, 2, 28], [1, 35, 28], [2, 68, 28]], more: [101, 28, 6] });
    });

    test("a day's B/k rounds to a whole pixel before the offsets are added: at B 142.857, halves of 71 and quarters of 36", () => {
        expect(places(142.857, 2)).toEqual({ tiles: [[0, 2, 66], [1, 73, 66]], more: undefined });
        expect(places(142.857, 4)).toEqual({ tiles: [[0, 2, 31], [1, 38, 31], [2, 74, 31], [3, 110, 31]], more: undefined });
    });

    test("the tile the cell keeps takes its slot first, the run from the first filling the rest in order", () => {
        expect(places(132, 7, 5)).toEqual({ tiles: [[0, 2, 28], [1, 35, 28], [5, 68, 28]], more: [101, 28, 4] });
        // Kept among the first three, it changes nothing.
        expect(places(132, 7, 1)).toEqual(places(132, 7));
    });

    test("narrow days keep the floor: quarters under 20 give way to halves, halves to the whole day, the +n taking the rest", () => {
        // At B 90 a quarter is 23 less 5, under the floor: halves of 45, one tile and a +2.
        expect(places(90, 3)).toEqual({ tiles: [[0, 2, 40]], more: [47, 40, 2] });
        expect(places(90, 2)).toEqual({ tiles: [[0, 2, 40], [1, 47, 40]], more: undefined });
        // At B 40 a half is 15: the whole day, the +2 alone — or the kept tile alone, its chip waiting.
        expect(places(40, 2)).toEqual({ tiles: [], more: [2, 35, 2] });
        expect(places(40, 2, 1)).toEqual({ tiles: [[1, 2, 35]], more: undefined });
        // At the floor exactly, quarters stand: B 100's quarter is 25, a tile 20.
        expect(places(100, 4)).toEqual({ tiles: [[0, 2, 20], [1, 27, 20], [2, 52, 20], [3, 77, 20]], more: undefined });
    });

    test("a lone tile shrinks to its day, down to the least it draws; with no room for that, a mark across the day — several, their chip alone across it", () => {
        expect(places(12, 1)).toEqual({ tiles: [[0, 2, 7]], more: undefined });
        expect(places(8, 1)).toEqual({ tiles: [[0, 2, 3]], more: undefined });
        expect(bucketSlots(7, 1, undefined, FLOOR, LEAST)).toEqual({ kind: "mark" });
        expect(bucketSlots(7, 3, undefined, FLOOR, LEAST)).toEqual({ kind: "count", count: 3 });
        expect(bucketSlots(7, 3, 2, FLOOR, LEAST)).toEqual({ kind: "count", count: 3 });
    });

    test("a cell with no tiles has no slots", () => {
        expect(places(132, 0)).toEqual({ tiles: [], more: undefined });
    });
});

describe("a day's room across the plot (#1735)", () => {
    test("from its start's whole pixel to the pixel before its rule, every edge rounded on its own: five days of 132 are 131 each", () => {
        expect([0, 1, 2, 3, 4].map((d) => dayRoom(d / 5, (d + 1) / 5, 660))).toEqual([
            { left: 0, width: 131 }, { left: 132, width: 131 }, { left: 264, width: 131 }, { left: 396, width: 131 }, { left: 528, width: 131 },
        ]);
    });

    test("a pitch that is no whole pixel gives each day its rounded edges: twelve weeks over 1000 are 83 or 84 apart", () => {
        const rooms = Array.from({ length: 12 }, (_, w) => dayRoom(w / 12, (w + 1) / 12, 1000));
        expect(rooms.slice(0, 3)).toEqual([{ left: 0, width: 82 }, { left: 83, width: 83 }, { left: 167, width: 82 }]);
        // Each room ends on the pixel before the next starts: that pixel is its rule.
        rooms.slice(0, -1).forEach((room, w) => expect(room.left + room.width + 1).toBe(rooms[w + 1]!.left));
    });

    test("a day narrower than its rule has no room", () => {
        expect(dayRoom(0, 0.0004, 1000)).toEqual({ left: 0, width: 0 });
    });
});
