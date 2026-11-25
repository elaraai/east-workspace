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
 * (#1039): the blocks of a paged kind's resources around the rows in view — an
 * end of them its window does not hold read as the other end (#1711), and a
 * block only the margin wants marked so — which of them a read takes in beneath
 * the cap, the rows in view first (#1768), the
 * tiles a summary may shade a host's buckets by, a
 * resource's shading from its summary's totals, whether a counted kind is
 * within the cap, and a window of the paged rows — the resources it draws, in
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
    SCHEDULE_CELL_BLOCK, SCHEDULE_CELL_MARGIN, SCHEDULE_CELL_OPENING, SCHEDULE_WINDOW_FAILED, dividingTiles, draftsNotHeld, landedBefore, sameCellSpan,
    scheduleCellSpanOf, scheduleCellsWithinCap, schedulePagedBlocks, scheduleWindowKeys, scheduleWithinCap, shadesOf, wantedBlocks, type ScheduleCellKey,
    type ScheduleCellPaged, type ScheduleCellSpan,
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

describe("the paged rows' blocks a view wants (#1039, #1541, #1711)", () => {
    /** Presses by their place among the rows, `P-0000` on. */
    const presses = (from: number, n: number): ScheduleCellKey[] =>
        Array.from({ length: n }, (_x, i) => ({ slot: "presses", key: `P-${String(from + i).padStart(4, "0")}` }));
    /** Paged rows of 200 a window: each window's resources, or `undefined` for one in flight. */
    const pagedOf = (windows: readonly (readonly ScheduleCellKey[] | undefined)[], narrowing?: string): ScheduleCellPaged => ({
        kinds: ["presses"], window: 200, hidden: false, unassigned: false,
        keys: (offset) => {
            const keys = windows[Number(offset) / 200];
            return keys === undefined ? none : some(keys);
        },
        total: () => some(BigInt(windows.length * 200)),
        narrowing: () => narrowing,
    });
    const two = pagedOf([presses(0, 200), presses(200, 200)]);
    /** The rows in view, one run of them: each end by its window and its key. */
    const span = (first: readonly [number, string], last: readonly [number, string], narrowing?: string): ScheduleCellSpan =>
        ({ runs: [{ first: { w: first[0], key: first[1] }, last: { w: last[0], key: last[1] } }], narrowing });
    /** The rows in view, several runs of them in the view's order, each its ends as {@link span}'s. */
    const runs = (...ends: (readonly [first: readonly [number, string], last: readonly [number, string]])[]): ScheduleCellSpan =>
        ({ runs: ends.map(([first, last]) => ({ first: { w: first[0], key: first[1] }, last: { w: last[0], key: last[1] } })), narrowing: undefined });
    /** The blocks a view wants, by their names: each its window and its place there. */
    const named = (blocks: readonly { readonly id: string }[] | undefined) => blocks?.map((block) => block.id);

    test("the first block before any row in view is reported, where a view opens; then those meeting the rows in view and the margin either side", () => {
        expect(schedulePagedBlocks(two, undefined)).toEqual([{ slot: "presses", id: "0.0", keys: presses(0, 50).map((press) => press.key) }]);
        expect(named(schedulePagedBlocks(two, span([0, "P-0100"], [0, "P-0120"])))).toEqual(["0.1", "0.2"]);
        // The margin reaches into the next window.
        expect(named(schedulePagedBlocks(two, span([0, "P-0180"], [0, "P-0190"])))).toEqual(["0.3", "1.0"]);
    });

    test("a block only the margin wants, none of its resources in view, is marked so: the cap holds the blocks in view (#1768)", () => {
        /** The blocks a view wants that only its margin wants, by their names. */
        const margins = (blocks: readonly { readonly id: string; readonly margin?: boolean | undefined }[] | undefined) =>
            blocks?.filter((block) => block.margin === true).map((block) => block.id);
        // Where a view opens, its first block is in view.
        expect(margins(schedulePagedBlocks(two, undefined))).toEqual([]);
        // The block before the rows in view; the rows in view in one block.
        expect(margins(schedulePagedBlocks(two, span([0, "P-0100"], [0, "P-0120"])))).toEqual(["0.1"]);
        // The margin's block in the next window.
        expect(margins(schedulePagedBlocks(two, span([0, "P-0180"], [0, "P-0190"])))).toEqual(["1.0"]);
        // Rows in view across two blocks, both in view, and the margin's block before them.
        expect(named(schedulePagedBlocks(two, span([0, "P-0060"], [0, "P-0110"])))).toEqual(["0.0", "0.1", "0.2"]);
        expect(margins(schedulePagedBlocks(two, span([0, "P-0060"], [0, "P-0110"])))).toEqual(["0.0"]);
        // Rows in view across a window's edge: each window's block in view, and the margin's block before them.
        expect(named(schedulePagedBlocks(two, span([0, "P-0160"], [1, "P-0210"])))).toEqual(["0.2", "0.3", "1.0"]);
        expect(margins(schedulePagedBlocks(two, span([0, "P-0160"], [1, "P-0210"])))).toEqual(["0.2"]);
    });

    test("an end whose key its window does not hold — a group's own row, a row the window draws no more — is read as the other end, never as its window's start", () => {
        // The first end: the blocks around the last, and not every block from the window's start.
        expect(named(schedulePagedBlocks(two, span([0, "H-07"], [0, "P-0120"])))).toEqual(["0.1", "0.2"]);
        // The last end: the blocks around the first, and not none.
        expect(named(schedulePagedBlocks(two, span([0, "P-0120"], [0, "H-09"])))).toEqual(["0.1", "0.2"]);
        // In a window before the other end's: nothing of that window.
        expect(named(schedulePagedBlocks(two, span([0, "H-07"], [1, "P-0260"])))).toEqual(["1.0", "1.1"]);
        // Neither held: where the first end's window opens, the margin reaching into the window before it.
        expect(named(schedulePagedBlocks(two, span([1, "H-07"], [1, "H-09"])))).toEqual(["0.3", "1.0"]);
    });

    test("the span of the rows in view: one run while their windows go on, another where a window goes back — the next series of the rows over the same windows (#1710); the same rows are the same span", () => {
        const end = (w: number, key: string) => ({ w, key });
        expect(scheduleCellSpanOf([], undefined)).toBeUndefined();
        expect(scheduleCellSpanOf([end(0, "P-0010"), end(0, "P-0020"), end(1, "P-0210")], "hall: Hall 2")).toEqual(span([0, "P-0010"], [1, "P-0210"], "hall: Hall 2"));
        const two = scheduleCellSpanOf([end(2, "P-0400"), end(3, "P-0700"), end(0, "P-0010"), end(0, "P-0020")], undefined)!;
        expect(two).toEqual(runs([[2, "P-0400"], [3, "P-0700"]], [[0, "P-0010"], [0, "P-0020"]]));
        expect(sameCellSpan(two, runs([[2, "P-0400"], [3, "P-0700"]], [[0, "P-0010"], [0, "P-0020"]]))).toBe(true);
        // Another run's end, another number of runs, or another narrowing: other rows in view.
        expect(sameCellSpan(two, runs([[2, "P-0400"], [3, "P-0700"]], [[0, "P-0010"], [0, "P-0030"]]))).toBe(false);
        expect(sameCellSpan(two, runs([[2, "P-0400"], [3, "P-0700"]]))).toBe(false);
        expect(sameCellSpan(span([0, "P-0010"], [0, "P-0020"]), span([0, "P-0010"], [0, "P-0020"], "hall: Hall 2"))).toBe(false);
    });

    test("rows beside a group at the top: a view running from one series of the rows into another over the same windows is a run each — the blocks of both, never those of the windows between (#1710)", () => {
        const four = pagedOf([presses(0, 200), presses(200, 200), presses(400, 200), presses(600, 200)]);
        // The first series' last rows, in the last window, then the second's first rows, in the first window again.
        expect(named(schedulePagedBlocks(four, runs([[3, "P-0700"], [3, "P-0790"]], [[0, "P-0010"], [0, "P-0020"]])))).toEqual(["0.0", "3.1", "3.2", "3.3"]);
        // Two runs in one window: the blocks around each, never those between them.
        expect(named(schedulePagedBlocks(four, runs([[0, "P-0010"], [0, "P-0010"]], [[0, "P-0150"], [0, "P-0160"]])))).toEqual(["0.0", "0.2", "0.3"]);
    });

    test("none while a window of them is in flight, nor while the rows in view are another narrowing's", () => {
        expect(schedulePagedBlocks(pagedOf([presses(0, 200), undefined]), span([1, "P-0210"], [1, "P-0220"]))).toBeUndefined();
        expect(schedulePagedBlocks(pagedOf([presses(0, 200)], "hall: Hall 2"), span([0, "P-0010"], [0, "P-0020"], "hall: Hall 1"))).toBeUndefined();
    });
    test("a block's resources stand under one row: a place whose resources nest under two is a block each, the first named by the place (#1710)", () => {
        /** Presses under a hall: each names the row it stands under. */
        const under = (hall: string, from: number, n: number): ScheduleCellKey[] => presses(from, n).map((press) => ({ ...press, under: [hall] }));
        // A window of two halls: thirty presses under the first, a hundred and seventy under the second.
        const halls = pagedOf([[...under("H-01", 0, 30), ...under("H-02", 30, 170)]]);
        const keysOf = (from: number, n: number) => presses(from, n).map((press) => press.key);
        expect(schedulePagedBlocks(halls, undefined)).toEqual([
            { slot: "presses", id: "0.0", keys: keysOf(0, 30), under: ["H-01"] },
            { slot: "presses", id: "0.0.1", keys: keysOf(30, 20), under: ["H-02"] },
        ]);
        // A place wholly under one hall is one block, named as a place of no halls is — the one before the rows in view
        // only the margin's (#1768).
        expect(schedulePagedBlocks(halls, span([0, "P-0110"], [0, "P-0120"]))).toEqual([
            { slot: "presses", id: "0.1", keys: keysOf(50, 50), under: ["H-02"], margin: true },
            { slot: "presses", id: "0.2", keys: keysOf(100, 50), under: ["H-02"] },
        ]);
        // Resources under no row beside ones under a row: a block each, and the one under no row names none.
        const mixed = pagedOf([[...presses(0, 10), ...under("H-01", 10, 10), ...presses(20, 5)]]);
        expect(schedulePagedBlocks(mixed, undefined)).toEqual([
            { slot: "presses", id: "0.0", keys: [...keysOf(0, 10), ...keysOf(20, 5)] },
            { slot: "presses", id: "0.0.1", keys: keysOf(10, 10), under: ["H-01"] },
        ]);
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

describe("the blocks a read takes in beneath the cap: those in view, then the margin's while they fit (#1768)", () => {
    /** A block meeting the rows in view, its cells holding `count` entries. */
    const inView = (count: number) => ({ margin: false, count });
    /** A block only the margin wants. */
    const margin = (count: number) => ({ margin: true, count });

    test("every block in view, and each of the margin's in their order while what is read stays within the cap", () => {
        // A third block would pass the cap: the one after the rows in view is left unread.
        expect(scheduleCellsWithinCap([margin(3_000), inView(3_500), inView(3_500), margin(3_000)])).toEqual([true, true, true, false]);
        expect(scheduleCellsWithinCap([margin(1_500), inView(3_500), inView(3_500), margin(1_500)])).toEqual([true, true, true, true]);
        // A margin's block past the cap is left unread, and a smaller one after it still read.
        expect(scheduleCellsWithinCap([margin(5_000), inView(6_000), margin(4_000)])).toEqual([false, true, true]);
        expect(scheduleCellsWithinCap([])).toEqual([]);
    });

    test("the blocks in view at the cap are read with no margin beside them; past it, none is read — the kind shades, or gives its notice", () => {
        expect(SCHEDULE_EVENT_CAP).toBe(10_000);
        expect(scheduleCellsWithinCap([inView(10_000), margin(1)])).toEqual([true, false]);
        expect(scheduleCellsWithinCap([inView(6_000), inView(4_001)])).toBeUndefined();
        expect(scheduleCellsWithinCap([margin(0), inView(10_001)])).toBeUndefined();
    });
});

describe("a window of the paged rows, as the reader reads it (#1039, #1541)", () => {
    /** Paged rows whose windows of 200 answer as `read` says, each window it is asked for kept in `asked`. */
    const pagedOf = (read: () => option<readonly ScheduleCellKey[]>, asked: [bigint, bigint][] = []): ScheduleCellPaged => ({
        kinds: ["presses", "crews"], window: 200, hidden: false, unassigned: false,
        keys: (offset, limit) => { asked.push([offset, limit]); return read(); },
        total: () => some(2_000n),
        narrowing: () => undefined,
    });

    test("the resources it draws once it has landed, each by the slot its row lands on, asked of its offset and size; none while it is in flight", () => {
        const asked: [bigint, bigint][] = [];
        const drawn = [{ slot: "presses", key: "P-1201" }, { slot: "crews", key: "C-1" }, { slot: "presses", key: "P-1202" }];
        expect(scheduleWindowKeys(pagedOf(() => some(drawn), asked), 1)).toEqual(drawn);
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
    /** What Saves landed of the jobs: one event — its draft, its row and its row's value no matter here — their requests drafted at these revisions. */
    const jobs = (...from: string[]): ScheduleLanded => new Map([["jobs", {
        rows: new Map([["J-1041", { draft: new Uint8Array([1]), row: new Uint8Array([2]), value: { title: "October brochures" } }]]), from: new Set(from),
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
