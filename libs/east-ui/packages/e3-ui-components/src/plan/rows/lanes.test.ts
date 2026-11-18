/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, expect, test } from "vitest";
import { laneBand, laneIndexAt } from "./lanes.js";

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
