/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, expect, test } from "vitest";
import { laneBand, laneIndexAt, laneRooms, laneRulesPath, laneSpan } from "./lanes.js";

describe("a buckets row's lanes in whole pixels (#1735)", () => {
    test("each lane a room of 24 and the rule under it, 25 a lane: the last lane's rule the row's own", () => {
        expect(laneRooms(25, 1)).toEqual([{ top: 0, room: 24 }]);
        expect(laneRooms(50, 2)).toEqual([{ top: 0, room: 24 }, { top: 25, room: 24 }]);
        expect(laneRooms(75, 3)).toEqual([{ top: 0, room: 24 }, { top: 25, room: 24 }, { top: 50, room: 24 }]);
        // A row with no lanes is one.
        expect(laneRooms(25, 0)).toEqual([{ top: 0, room: 24 }]);
    });

    test("a row its gutter makes taller shares its height out in whole pixels, each lane less its rule", () => {
        expect(laneRooms(42, 1)).toEqual([{ top: 0, room: 41 }]);
        expect(laneRooms(61, 2)).toEqual([{ top: 0, room: 30 }, { top: 31, room: 29 }]);
    });

    test("a lane's rule is the pixel row under its room: three lanes of 25, rules at 24 and 49 — the last the row's own", () => {
        expect(laneRulesPath(laneRooms(75, 3), 528)).toBe("M0 24.5H528M0 49.5H528");
        expect(laneRulesPath(laneRooms(25, 1), 528)).toBe("");
    });

    test("several lanes' rooms are one band, from the first's top to the end of the last's room, the rules between them in it", () => {
        const three = laneRooms(75, 3);
        expect(laneSpan(three, 1)).toEqual({ top: 25, height: 24 });
        expect(laneSpan(three, 0, 3)).toEqual({ top: 0, height: 74 });
        expect(laneSpan(three, 1, 2)).toEqual({ top: 25, height: 49 });
        // Past the row's last lane it stops there; a lane the row has not is none.
        expect(laneSpan(three, 2, 4)).toEqual({ top: 50, height: 24 });
        expect(laneSpan(three, 3)).toBeUndefined();
    });
});

describe("a buckets row's lanes: each the same share of the row's height (#1541, U1)", () => {
    test("a lane's band is its share, from the lanes above it; several lanes from one on take theirs together", () => {
        expect(laneBand(0, 2)).toEqual({ top: 0, height: 0.5 });
        expect(laneBand(1, 2)).toEqual({ top: 0.5, height: 0.5 });
        expect(laneBand(1, 4, 2)).toEqual({ top: 0.25, height: 0.5 });
        // A row with no lanes is one band.
        expect(laneBand(0, 0)).toEqual({ top: 0, height: 1 });
    });

    test("a point is in the lane whose band holds it: a lane's top edge is its own, the row's bottom the last lane's", () => {
        expect(laneIndexAt(0, 2)).toBe(0);
        expect(laneIndexAt(0.49, 2)).toBe(0);
        expect(laneIndexAt(0.5, 2)).toBe(1);
        expect(laneIndexAt(1, 2)).toBe(1);
        expect(laneIndexAt(0.7, 3)).toBe(2);
    });

    test("a point above the row is in its first lane, one below it in its last; a row with no lanes has none", () => {
        expect(laneIndexAt(-0.2, 3)).toBe(0);
        expect(laneIndexAt(1.4, 3)).toBe(2);
        expect(laneIndexAt(0.5, 0)).toBeUndefined();
    });

    test("every point of a lane's band is in that lane", () => {
        for (const count of [1, 2, 3, 5]) {
            for (let lane = 0; lane < count; lane++) {
                const band = laneBand(lane, count);
                expect(laneIndexAt(band.top + band.height / 2, count)).toBe(lane);
            }
        }
    });
});
