/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A section's head held through a change to it (#1684): while the view is inside a section, past its start, a toggle of
 * its head holds what sticks — what stuck sticks still, what went by stays by, and a row new to the head sticks — while
 * the held head fits in the view; anywhere else, and past that, the head sticks afresh (#1568, A6.2).
 */
import { describe, expect, test } from "vitest";
import { stuckRows, type StickySection } from "./virtual-rows.js";

const ROW_H = 36;
const size = () => ROW_H;
const place = (i: number) => i * ROW_H;
/** A band and its eyebrow, lane A and its two skill rows, lane B and its skill row, then lane C: the skill rows give way. */
const SKILLS = [3, 4, 6];
const SECTION: StickySection = { start: 0, end: 20, head: 8, yields: (i) => SKILLS.includes(i) };
const END = 20 * ROW_H;
/** Half the view: the eight rows, 288px, are past it. */
const HALF = 200;
const stuck = (head: ReturnType<typeof stuckRows>) => [...head.rows.keys()];

describe("stuckRows — a head held through a change to it (#1684)", () => {
    test("afresh past half the view, the skill rows give way, and the band, the eyebrow and the lanes stick", () => {
        expect(stuck(stuckRows(SECTION, size, place, END, HALF))).toEqual([0, 1, 2, 5, 7]);
    });

    test("held, the rows the hold names stick past half the view, each under the ones above it, and the next section pushes them out whole", () => {
        // Lane A's skill rows opened under the stuck head, new to it; lane B's went by as the view came in.
        const held = stuckRows(SECTION, size, place, END, HALF, { sticks: (i) => i !== 6, room: 400 });
        expect(stuck(held)).toEqual([0, 1, 2, 3, 4, 5, 7]);
        expect([held.rows.get(3)?.top, held.rows.get(5)?.top, held.rows.get(7)?.top]).toEqual([3 * ROW_H, 5 * ROW_H, 6 * ROW_H]);
        expect(held.height).toBe(7 * ROW_H);
        // The band's rail ends where the held head, whole, meets the section's end.
        expect(held.rows.get(0)?.rail).toBe(END - 6 * ROW_H);
    });

    test("held, a head in half the view sticks only what the hold names: skill rows that went by stay by", () => {
        // Lane B closed under the stuck head: band, eyebrow, lane A and its two skill rows, which went by as the view came in.
        const small: StickySection = { start: 0, end: 20, head: 5, yields: (i) => i === 3 || i === 4 };
        expect(stuck(stuckRows(small, size, place, END, HALF))).toEqual([0, 1, 2, 3, 4]);
        expect(stuck(stuckRows(small, size, place, END, HALF, { sticks: (i) => i < 3, room: 400 }))).toEqual([0, 1, 2]);
    });

    test("a held head taller than the view sticks afresh", () => {
        expect(stuck(stuckRows(SECTION, size, place, END, HALF, { sticks: () => true, room: 7 * ROW_H }))).toEqual([0, 1, 2, 5, 7]);
    });
});
