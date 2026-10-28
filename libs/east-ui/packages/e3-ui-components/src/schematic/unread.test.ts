/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The area the Schematic's reads in flight have not drawn yet (#1398, CL2),
 * which the canvas washes (`area.ts`' `unreadArea`): each kind's window being
 * read, less the reach its drawing holds — what of one box another leaves
 * (`boxMinus`) — as boxes disjoint from one another, so where two kinds'
 * unread areas meet the wash is laid once.
 */

import { describe, expect, test } from "vitest";
import { boxMinus, unreadArea } from "./area.js";
import type { WorldBox } from "./canvas/model.js";

/** The area of some boxes. */
const areaOf = (boxes: readonly WorldBox[]) => boxes.reduce((sum, b) => sum + (b.maxX - b.minX) * (b.maxY - b.minY), 0);

/** Whether two boxes overlap, with an area. */
const overlapping = (a: WorldBox, b: WorldBox) => Math.max(a.minX, b.minX) < Math.min(a.maxX, b.maxX) && Math.max(a.minY, b.minY) < Math.min(a.maxY, b.maxY);

/** The window the floor's reach stands at: 10 × 10 m from the origin. */
const HELD: WorldBox = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

describe("boxMinus", () => {
    test("a box the other does not meet is left whole, and one it only touches", () => {
        expect(boxMinus({ minX: 20, minY: 0, maxX: 30, maxY: 10 }, HELD)).toEqual([{ minX: 20, minY: 0, maxX: 30, maxY: 10 }]);
        expect(boxMinus({ minX: 10, minY: 0, maxX: 20, maxY: 10 }, HELD)).toEqual([{ minX: 10, minY: 0, maxX: 20, maxY: 10 }]);
        // Nothing held yet: the box is left whole.
        expect(boxMinus(HELD, undefined)).toEqual([HELD]);
    });

    test("a box the other covers leaves nothing", () => {
        expect(boxMinus({ minX: 2, minY: 2, maxX: 8, maxY: 8 }, HELD)).toEqual([]);
        expect(boxMinus(HELD, HELD)).toEqual([]);
    });

    test("a pan to the right leaves the strip past the held box's right edge", () => {
        expect(boxMinus({ minX: 4, minY: 0, maxX: 14, maxY: 10 }, HELD)).toEqual([{ minX: 10, minY: 0, maxX: 14, maxY: 10 }]);
    });

    test("a pan down and to the left leaves the strip below the held box, then the one beside it between them", () => {
        expect(boxMinus({ minX: -4, minY: 3, maxX: 6, maxY: 13 }, HELD)).toEqual([
            { minX: -4, minY: 10, maxX: 6, maxY: 13 },
            { minX: -4, minY: 3, maxX: 0, maxY: 10 },
        ]);
    });

    test("a zoom out leaves the ring about the held box: four boxes, disjoint, covering all of it but the held box", () => {
        const wider: WorldBox = { minX: -5, minY: -5, maxX: 15, maxY: 15 };
        const left = boxMinus(wider, HELD);
        expect(left).toHaveLength(4);
        expect(areaOf(left)).toBe(areaOf([wider]) - areaOf([HELD]));
        for (const [i, a] of left.entries()) {
            expect(overlapping(a, HELD)).toBe(false);
            for (const b of left.slice(i + 1)) expect(overlapping(a, b)).toBe(false);
        }
    });
});

describe("unreadArea", () => {
    test("nothing in flight is nothing unread; a window inside the reach its drawing holds, a zoom in, is nothing either", () => {
        expect(unreadArea([])).toEqual([]);
        expect(unreadArea([{ want: { minX: 1, minY: 1, maxX: 4, maxY: 3 }, have: HELD }])).toEqual([]);
    });

    test("a kind's window past the reach its drawing holds is unread there; one never drawn, all of it", () => {
        expect(unreadArea([{ want: { minX: 4, minY: 0, maxX: 14, maxY: 10 }, have: HELD }])).toEqual([{ minX: 10, minY: 0, maxX: 14, maxY: 10 }]);
        expect(unreadArea([{ want: HELD, have: undefined }])).toEqual([HELD]);
    });

    test("two kinds' unread areas that meet are laid once: disjoint boxes, covering both", () => {
        const racks = { want: { minX: 4, minY: 0, maxX: 14, maxY: 10 }, have: HELD };
        // The frames' drawing holds less: their unread area holds the racks' and more.
        const frames = { want: { minX: 4, minY: 0, maxX: 14, maxY: 10 }, have: { minX: 0, minY: 0, maxX: 8, maxY: 10 } };
        const unread = unreadArea([racks, frames]);
        expect(areaOf(unread)).toBe(6 * 10);
        for (const [i, a] of unread.entries()) for (const b of unread.slice(i + 1)) expect(overlapping(a, b)).toBe(false);
        expect(unread).toEqual([{ minX: 10, minY: 0, maxX: 14, maxY: 10 }, { minX: 8, minY: 0, maxX: 10, maxY: 10 }]);
    });
});
