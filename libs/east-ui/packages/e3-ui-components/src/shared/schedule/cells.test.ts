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
 * tiles a summary may shade a host's buckets by, a
 * resource's shading from its summary's totals, whether a counted kind is
 * within the cap, and a window of the paged kind's resources — its keys, in
 * flight, or a read that failed, which only the paging runtime's
 * `PagedReadError` is. The runs a range wants are east-ui's (`levelRuns`,
 * `summaryRun`, #1433). And which kinds' cells stand from before what Saves
 * landed of them: those read at another revision than the one their record
 * reads at now. And which drafts a kind that draws a draft only of an event
 * its window holds, or of a new one, leaves out — never one it last drew,
 * while its session has yet to judge it where its record reads now (#1599).
 * The Plan's DOM tests carry the reader through e3
 * (`plan/plan-series.dom.test.tsx`, `plan/plan-cap.dom.test.tsx`,
 * `plan/frame/plan-remote-rows.dom.test.tsx`).
 */

import { describe, test, expect } from "vitest";
import { none, some, type option } from "@elaraai/east";
import { SCHEDULE_EVENT_CAP } from "@elaraai/e3-ui/internal";
import { PagedReadError, isPagedReadError } from "../../platform/paged-read-error.js";
import {
    SCHEDULE_CELL_BLOCK, SCHEDULE_CELL_MARGIN, SCHEDULE_CELL_OPENING, SCHEDULE_WINDOW_FAILED, dividingTiles, draftsNotHeld, landedBefore, scheduleWindowKeys,
    scheduleWithinCap, shadesOf, wantedBlocks, type ScheduleCellPaged,
} from "./cells.js";
import { DraftedStanding } from "./drafted-rows.js";
import type { ScheduleLanded } from "./editing.js";

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

    test("while its count is in flight it is neither", () => {
        expect(scheduleWithinCap(counting(none, []), from, to)).toEqual(none);
    });
});

describe("a window of a paged kind's resources, as the reader reads it (#1039)", () => {
    /** A paged kind whose windows of 200 answer as `read` says, each window it is asked for kept in `asked`. */
    const pagedOf = (read: () => option<readonly string[]>, asked: [bigint, bigint][] = []): ScheduleCellPaged => ({
        kind: "presses", window: 200, hidden: false,
        keys: (offset, limit) => { asked.push([offset, limit]); return read(); },
        total: () => some(2_000n),
        narrowing: () => undefined,
    });

    test("its keys once it has landed, asked of its offset and size; none while it is in flight", () => {
        const asked: [bigint, bigint][] = [];
        expect(scheduleWindowKeys(pagedOf(() => some(["P-1201", "P-1202"]), asked), 1)).toEqual(["P-1201", "P-1202"]);
        expect(asked).toEqual([[200n, 200n]]);
        expect(scheduleWindowKeys(pagedOf(() => none), 0)).toBeUndefined();
    });

    test("a window whose read failed — the paging runtime's PagedReadError — gives no block; anything else thrown is thrown on", () => {
        const failed = pagedOf(() => { throw new PagedReadError("Data.bindPaged: plan_window_presses: internal_error"); });
        expect(scheduleWindowKeys(failed, 0)).toBe(SCHEDULE_WINDOW_FAILED);
        // No read that failed: a fault of the reader's, or of the seam's own East, is no window to retry.
        const broken = pagedOf(() => { throw new TypeError("keys is not a function"); });
        expect(() => scheduleWindowKeys(broken, 0)).toThrow(TypeError);
        const authored = pagedOf(() => { throw new Error("Data.bindPaged: source path \"plan_window_presses\" not declared in manifest"); });
        expect(() => scheduleWindowKeys(authored, 0)).toThrow(/not declared in manifest/);
    });

    test("a PagedReadError is known by its mark, whichever copy of its module made it", () => {
        expect(isPagedReadError(new PagedReadError("failed"))).toBe(true);
        // A copy of the module marks its errors with the same registry symbol.
        const copied = Object.assign(new Error("failed"), { [Symbol.for("@elaraai/e3-ui-components:PagedReadError")]: true });
        expect(isPagedReadError(copied)).toBe(true);
        expect(isPagedReadError(new Error("failed"))).toBe(false);
        expect(isPagedReadError("failed")).toBe(false);
        expect(isPagedReadError(undefined)).toBe(false);
    });
});

describe("what Saves landed, over a kind's cells read before them", () => {
    /** What Saves landed of the jobs: one event, their requests drafted at these revisions. */
    const jobs = (...from: string[]): ScheduleLanded => new Map([["jobs", {
        rows: new Map([["J-1041", { draft: new Uint8Array([1]), row: new Uint8Array([2]) }]]), from: new Set(from),
    }]]);
    /** The jobs at a revision: the one their standing cells were read at, or the one their record reads at now. */
    const at = (revision: string): ReadonlyMap<string, string> => new Map([["jobs", revision]]);

    test("cells read at another revision than the one their record reads at now stand from before the Saves, whichever revision each was drafted at: what they landed is laid", () => {
        const landed = jobs("r0");
        expect(landedBefore(landed, at("r0"), at("r1")).get("jobs")).toBe(landed.get("jobs"));
        // Two revisions behind: another session's write, then a Save drafted over it, the cells still as read before both.
        const behind = jobs("r1");
        expect(landedBefore(behind, at("r0"), at("r2")).get("jobs")).toBe(behind.get("jobs"));
    });

    test("cells read at the revision their record reads at now hold the Saves, and nothing is laid — but while the record still reads at a revision one was drafted at, or names none", () => {
        expect(landedBefore(jobs("r0"), at("r1"), at("r1")).size).toBe(0);
        expect(landedBefore(jobs("r0", "r1"), at("r2"), at("r2")).size).toBe(0);
        // Its move to the commit not heard yet.
        expect(landedBefore(jobs("r0"), at("r0"), at("r0")).size).toBe(1);
        expect(landedBefore(jobs("r0"), at("r0"), new Map()).size).toBe(1);
    });

    test("a kind none of whose cells is read is laid nothing, and nothing landed lays nothing", () => {
        expect(landedBefore(jobs("r0"), new Map(), at("r1")).size).toBe(0);
        expect(landedBefore(undefined, at("r0"), at("r1")).size).toBe(0);
        expect(landedBefore(new Map(), at("r0"), at("r1")).size).toBe(0);
    });
});

describe("the drafts a kind leaves out: those of events its window does not hold that are no new ones (#1343, #1599)", () => {
    /** The jobs drafted: each by its key, its draft's bytes no matter here. */
    const drafted = (...ids: string[]): ReadonlyMap<string, Uint8Array> => new Map(ids.map((id) => [id, new Uint8Array([1])]));
    /** A window holding the jobs given. */
    const window = (...ids: string[]) => new Set(ids);
    /** No job a new one, or those given. */
    const fresh = (...ids: string[]) => (id: string): boolean => ids.includes(id);

    test("a draft of a job the window holds, and of a new one, draws; one of a job the narrowing leaves out is left out", () => {
        const standing = new DraftedStanding();
        expect([...draftsNotHeld("job", drafted("J-1", "J-2", "J-3"), window("J-1"), fresh("J-2"), false, standing)]).toEqual(["J-3"]);
    });

    test("a job changed here that the window, read again, holds no more stays drawn while its session has yet to judge it — another session removed it — and is left out once judged a job its record holds", () => {
        const standing = new DraftedStanding();
        // Drawn: its window holds it.
        expect(draftsNotHeld("job", drafted("J-1"), window("J-1"), fresh(), false, standing).size).toBe(0);
        // Its record moved: the window read again without it, its session still to read it by its key.
        expect(draftsNotHeld("job", drafted("J-1"), window(), fresh(), true, standing).size).toBe(0);
        expect(draftsNotHeld("job", drafted("J-1"), window(), fresh(), true, standing).size).toBe(0);
        // Judged, and still a job its record holds: the narrowing leaves it out.
        expect([...draftsNotHeld("job", drafted("J-1"), window(), fresh(), false, standing)]).toEqual(["J-1"]);
        // And left out through the next carry-over: it was not drawn last.
        expect([...draftsNotHeld("job", drafted("J-1"), window(), fresh(), true, standing)]).toEqual(["J-1"]);
    });

    test("judged a job its draft adds — its session found none of it where the record is — it draws as a new one does", () => {
        const standing = new DraftedStanding();
        draftsNotHeld("job", drafted("J-1"), window("J-1"), fresh(), false, standing);
        draftsNotHeld("job", drafted("J-1"), window(), fresh(), true, standing);
        expect(draftsNotHeld("job", drafted("J-1"), window(), fresh("J-1"), false, standing).size).toBe(0);
    });

    test("a draft left out before the carry-over is left out through it, and each kind stands by its own drafts", () => {
        const standing = new DraftedStanding();
        expect([...draftsNotHeld("job", drafted("J-1"), window(), fresh(), false, standing)]).toEqual(["J-1"]);
        expect([...draftsNotHeld("job", drafted("J-1"), window(), fresh(), true, standing)]).toEqual(["J-1"]);
        // Another kind drew a draft under the same key: it says nothing of the jobs'.
        draftsNotHeld("service", drafted("J-1"), window("J-1"), fresh(), false, standing);
        expect([...draftsNotHeld("job", drafted("J-1"), window(), fresh(), true, standing)]).toEqual(["J-1"]);
        // And the jobs with no draft left forget what they drew.
        draftsNotHeld("job", drafted("J-2"), window("J-2"), fresh(), false, standing);
        expect(draftsNotHeld("job", undefined, window(), fresh(), false, standing).size).toBe(0);
        expect([...draftsNotHeld("job", drafted("J-2"), window(), fresh(), true, standing)]).toEqual(["J-2"]);
    });
});
