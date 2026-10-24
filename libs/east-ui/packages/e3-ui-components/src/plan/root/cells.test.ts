/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * What the reader of the Plan's cells wants, worked out with no read (#1039):
 * the blocks of a paged kind's resources around the rows in view, the tiles a
 * range wants, the tiles a summary may shade a resolution's buckets by, the
 * buckets a range is cut into, a resource's shading from its summary's totals,
 * and where the canvas reports its rows in view.
 */

import { describe, test, expect, vi } from "vitest";
import { some } from "@elaraai/east";
import { utcAt } from "../plan.test-utils.js";
import { planScale, type PlanScale } from "../scale.js";
import {
    PLAN_CELL_BLOCK, PLAN_CELL_MARGIN, PLAN_CELL_OPENING, bucketsOver, cellSpanOf, createCellSpanStore, dividingTiles, shadesOf, wantedBlocks,
    wantedTiles,
} from "./cells.js";

const day = (text: string) => new Date(`${text}T00:00:00Z`);
const HOUR = 3_600_000;

describe("the blocks a reader wants (#1039)", () => {
    test("those meeting the resources in view and the margin either side, by fifty", () => {
        expect([PLAN_CELL_BLOCK, PLAN_CELL_MARGIN]).toEqual([50, 25]);
        // A canvas opening reads its first block alone.
        expect(wantedBlocks(PLAN_CELL_OPENING, undefined)).toEqual([0]);
        expect(wantedBlocks({ first: 0, last: 20 }, 2_000)).toEqual([0]);
        // Within the margin of the next block, it is wanted too.
        expect(wantedBlocks({ first: 0, last: 30 }, 2_000)).toEqual([0, 1]);
        expect(wantedBlocks({ first: 140, last: 157 }, 2_000)).toEqual([2, 3]);
        expect(wantedBlocks({ first: 76, last: 90 }, 2_000)).toEqual([1, 2]);
    });

    test("never past the kind's last resource, nor before its first; a kind of none wants none", () => {
        expect(wantedBlocks({ first: 1_990, last: 1_999 }, 2_000)).toEqual([39]);
        expect(wantedBlocks({ first: 10, last: 12 }, 30)).toEqual([0]);
        expect(wantedBlocks({ first: 0, last: 0 }, 0)).toEqual([]);
    });
});

describe("the tiles a reader wants (#1039)", () => {
    test("those a range overlaps, as e3 files an event over them, and one either side", () => {
        // Saturday 3 to Wednesday 21 October: the weeks of 28 September to 19 October, and one either side.
        expect(wantedTiles("week", day("2026-10-03"), day("2026-10-21"), 10_000))
            .toEqual(["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"].map(day));
        // A range ending on a tile's start does not touch it.
        expect(wantedTiles("week", day("2026-10-05"), day("2026-10-12"), 10_000)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"].map(day));
        expect(wantedTiles("month", day("2026-10-05"), day("2026-10-19"), 10_000)).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"].map(day));
    });

    test("none past the most it may list: a range of more is a summary's", () => {
        expect(wantedTiles("day", day("2026-01-01"), day("2027-01-01"), 100)).toBeUndefined();
        expect(wantedTiles("day", day("2026-01-01"), day("2026-01-11"), 12)).toHaveLength(12);
    });
});

describe("the tiles a summary shades a resolution's buckets by (#1039)", () => {
    test("those that divide its bucket, the largest first — an ISO week divides no month, and nothing divides an hour", () => {
        expect(dividingTiles("hour")).toEqual([]);
        expect(dividingTiles("day")).toEqual(["day"]);
        expect(dividingTiles("week")).toEqual(["week", "day"]);
        expect(dividingTiles("month")).toEqual(["month", "day"]);
        expect(dividingTiles("quarter")).toEqual(["quarter", "month", "day"]);
        expect(dividingTiles("year")).toEqual(["year", "quarter", "month", "day"]);
        expect(dividingTiles(undefined)).toEqual([]);
    });
});

describe("the buckets a range is cut into (#1039)", () => {
    test("whole periods of the scale's resolution, in order", () => {
        const scale = planScale({ kind: "time", window: { min: utcAt("2026-10-05T00:00:00"), max: utcAt("2026-10-19T00:00:00") }, resolution: "month" }) as PlanScale;
        expect(bucketsOver(scale, day("2026-09-01"), day("2026-12-01"))).toEqual([
            { start: day("2026-09-01").getTime(), end: day("2026-10-01").getTime() },
            { start: day("2026-10-01").getTime(), end: day("2026-11-01").getTime() },
            { start: day("2026-11-01").getTime(), end: day("2026-12-01").getTime() },
        ]);
    });
});

describe("a resource's shading from its summary's totals (#1039)", () => {
    const october = { start: day("2026-10-01").getTime(), end: day("2026-11-01").getTime() };
    const november = { start: day("2026-11-01").getTime(), end: day("2026-12-01").getTime() };

    test("the share of each bucket booked: the tiles inside it added up, at most all of it", () => {
        // The weeks of October: 219 hours booked over two of them; a tile outside every bucket is no bucket's.
        const totals = new Map([
            [day("2026-10-05").getTime(), { count: 120, ms: 120 * HOUR }],
            [day("2026-10-12").getTime(), { count: 99, ms: 99 * HOUR }],
            [day("2026-12-07").getTime(), { count: 4, ms: 4 * HOUR }],
        ]);
        expect(shadesOf(totals, [october, november], true)).toEqual([
            { at: day("2026-10-01"), value: some(219 / 744) },
            { at: day("2026-11-01"), value: some(0) },
        ]);
        const over = new Map([[day("2026-11-01").getTime(), { count: 3, ms: 1_000 * HOUR }]]);
        expect(shadesOf(over, [november], true)).toEqual([{ at: day("2026-11-01"), value: some(1) }]);
    });

    test("how many events touch each bucket, for a kind drawn as tiles or marks; a resource with no totals at nothing", () => {
        const totals = new Map([[day("2026-10-05").getTime(), { count: 7, ms: 9 * HOUR }], [day("2026-10-12").getTime(), { count: 2, ms: 0 }]]);
        expect(shadesOf(totals, [october, november], false)).toEqual([
            { at: day("2026-10-01"), value: some(9) },
            { at: day("2026-11-01"), value: some(0) },
        ]);
        expect(shadesOf(undefined, [october], false)).toEqual([{ at: day("2026-10-01"), value: some(0) }]);
    });
});

describe("where the canvas reports its rows in view (#1039)", () => {
    test("the first and the last row a paged window placed, each by its window and its resource's key", () => {
        const origin = new Map([["r1", { w: 0 }], ["r2", { w: 0 }], ["r3", { w: 1 }]]);
        expect(cellSpanOf([
            { key: "stock", path: ["board"] },
            { key: "r1", path: ["P-1001"] },
            { key: "r2", path: ["P-1002"] },
            { key: "r3", path: ["P-1201"] },
        ], origin)).toEqual({ first: { w: 0, key: "P-1001" }, last: { w: 1, key: "P-1201" } });
        // A row no paged window placed — the Plan's own — is never a paged kind's.
        expect(cellSpanOf([{ key: "stock", path: ["board"] }], origin)).toBeUndefined();
    });

    test("the store holds the span reported last, and tells its listeners only of one that moves", () => {
        const store = createCellSpanStore();
        const heard = vi.fn();
        const stop = store.subscribe(heard);
        expect(store.get()).toBeUndefined();
        store.set({ first: { w: 0, key: "P-1001" }, last: { w: 0, key: "P-1018" } });
        store.set({ first: { w: 0, key: "P-1001" }, last: { w: 0, key: "P-1018" } });
        expect(heard).toHaveBeenCalledTimes(1);
        store.set({ first: { w: 0, key: "P-1002" }, last: { w: 0, key: "P-1019" } });
        expect(heard).toHaveBeenCalledTimes(2);
        expect(store.get()).toEqual({ first: { w: 0, key: "P-1002" }, last: { w: 0, key: "P-1019" } });
        stop();
        store.set(undefined);
        expect(heard).toHaveBeenCalledTimes(2);
        expect(store.get()).toBeUndefined();
    });
});
