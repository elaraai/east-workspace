/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the reader loads east-ui-components' entry, which
 * needs one as it loads.
 *
 * What a schedule's cells' reader wants and decides, worked out with no read
 * (#1039): the blocks of a paged kind's resources around the rows in view, the
 * tiles a range wants, the tiles a summary may shade a host's buckets by, a
 * resource's shading from its summary's totals, and whether a counted kind is
 * within the cap. The Plan's DOM tests carry the reader through e3
 * (`plan/plan-series.dom.test.tsx`, `plan/plan-cap.dom.test.tsx`).
 */

import { describe, test, expect } from "vitest";
import { none, some, type option } from "@elaraai/east";
import { SCHEDULE_EVENT_CAP } from "@elaraai/e3-ui/internal";
import {
    SCHEDULE_CELL_BLOCK, SCHEDULE_CELL_MARGIN, SCHEDULE_CELL_OPENING, dividingTiles, scheduleWithinCap, shadesOf, wantedBlocks, wantedTiles,
} from "./cells.js";

const day = (text: string) => new Date(`${text}T00:00:00Z`);
const HOUR = 3_600_000;

describe("the blocks a reader wants (#1039)", () => {
    test("those meeting the resources in view and the margin either side, by fifty", () => {
        expect([SCHEDULE_CELL_BLOCK, SCHEDULE_CELL_MARGIN]).toEqual([50, 25]);
        // A view opening reads its first block alone.
        expect(wantedBlocks(SCHEDULE_CELL_OPENING, undefined)).toEqual([0]);
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

describe("a counted kind within the cap (#1039)", () => {
    const from = day("2026-10-01");
    const to = day("2026-11-01");
    /** A kind's count that answers `n` over the range it is asked of, and says what it was asked. */
    const counting = (n: option<bigint>, asked: [Date, Date][]) => (a: Date, b: Date): option<bigint> => {
        asked.push([a, b]);
        return n;
    };

    test("ten thousand events in the range are within it, one more past it — counted over the range it is asked of", () => {
        expect(SCHEDULE_EVENT_CAP).toBe(10_000);
        const asked: [Date, Date][] = [];
        expect(scheduleWithinCap(counting(some(10_000n), asked), from, to)).toEqual(some(true));
        expect(scheduleWithinCap(counting(some(10_001n), asked), from, to)).toEqual(some(false));
        expect(scheduleWithinCap(counting(some(0n), asked), from, to)).toEqual(some(true));
        expect(asked).toEqual([[from, to], [from, to], [from, to]]);
    });

    test("while its count is in flight it is neither, and a kind with no count — read through a day index — is within it", () => {
        expect(scheduleWithinCap(counting(none, []), from, to)).toEqual(none);
        expect(scheduleWithinCap(undefined, from, to)).toEqual(some(true));
    });
});
