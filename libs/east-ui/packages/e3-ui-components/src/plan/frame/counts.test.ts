/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * What the Plan's footer counts of its event kinds (#1193, PB23): every kind's
 * events in the window the canvas shows and how long they run (#1197), the
 * backlog of the kinds that keep one — its events the Backlog tab's cards
 * (#1344) — and the newest commit to any kind's record; the last counts while
 * a read is in flight, saying so, or has failed. The same read finds the overlaps among
 * the window's events of the kinds that warn of them (#1198). A kind read by
 * its cells (#1039) counts its window's events exactly from its source, as the
 * rail counts them, and its hours over the rows drawn — once its cells have
 * landed. Every kind is counted before it is read, and read over the window
 * only once its count over the range the canvas reads is within the cap; past
 * it, given no cells, its events are counted, not read, and its hours not
 * counted — and a kind counted through its day index, whose count is the days
 * its events run on, is not counted at all. A kind the viewer hides in the
 * Series tab is in no figure of the window, and never read over it; its
 * backlog is counted still.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { BlobType, OptionType, SortedMap, StringType, compareFor, equalFor, none, some, variant, type option } from "@elaraai/east";
import { UIStore } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import type { ScheduleCellsRead } from "../../shared/schedule/cells.js";
import { scheduleOverlaps } from "../../shared/schedule/overlaps.js";
import { utcAt } from "../plan.test-utils.js";
import { planScale, type PlanScale } from "../scale.js";
import type { PlanEventPart } from "../root/sources.js";
import { usePlanEventCounts, type PlanEventItemValue, type PlanEventKindValue } from "./counts.js";

beforeEach(() => { initializeStore(new UIStore()); });

/** Four weeks by the day, from Monday 5 October. */
const scale = planScale({ kind: "time", window: { min: utcAt("2026-10-05T00:00:00"), max: utcAt("2026-11-02T00:00:00") }, resolution: "day" }) as PlanScale;

/** An event in the window, an hour long. */
const item = () => ({ minutes: 60n });

/** No overlaps: what a window with none in a pair reads. */
const NO_OVERLAPS = scheduleOverlaps([]);

/** A kind's answer: its items, or none while its read is in flight. */
type Answer = () => ReturnType<PlanEventKindValue["planItems"]>;

/**
 * An event kind, as the payload carries it: the seams the footer reads, each
 * answering what it is given — its overlaps allowed unless it warns of them,
 * so its items need no times. Every kind is counted before it is read
 * (`planCount`): by `count`, or as holding none, each range it is counted over
 * kept in `counts`; `exact` false for a kind counted through its day index.
 */
function kind(k: {
    items: Answer; backlog?: Answer; commits?: readonly Date[]; asked?: [Date, Date][]; warns?: boolean; key?: string; name?: string; reads?: unknown[];
    count?: () => option<bigint>; counts?: [Date, Date][]; exact?: boolean;
}): PlanEventKindValue {
    const count = k.count ?? (() => some(0n));
    return {
        key: k.key ?? "job",
        name: k.name ?? "Print job",
        planItems: (from: Date, to: Date, _drafts: unknown, read: unknown) => {
            k.asked?.push([from, to]);
            k.reads?.push(read);
            return k.items();
        },
        backlog: k.backlog !== undefined,
        planUnscheduled: () => k.backlog!(),
        history: () => some((k.commits ?? []).map((at) => ({ at }))),
        overlaps: variant(k.warns === true ? "warn" : "allow", null),
        planCount: (from: Date, to: Date) => {
            k.counts?.push([from, to]);
            return count();
        },
        planCountExact: k.exact ?? true,
    } as unknown as PlanEventKindValue;
}

/**
 * The cells' reader's read, given the cells it gives each kind and the kinds past the cap: each kind's rows held, as
 * a read that has landed holds them — or, `landed` false, as the reader's opening holds none before its first read.
 */
function cellsOf(reads: [string, Uint8Array][], capped: readonly string[] = [], landed = true): ScheduleCellsRead {
    return {
        reads: new SortedMap(reads, compareFor(StringType)),
        shading: new SortedMap([], compareFor(StringType)),
        drafts: new SortedMap([], compareFor(StringType)),
        held: new Map(landed ? reads.map(([key]) => [key, new Map()] as const) : []), notices: [], capped: new Set(capped), reading: false, drawn: undefined,
    } as ScheduleCellsRead;
}

/** The ids a viewer hides in the Series tab: the jobs. */
const JOBS_HIDDEN = ["events.job"];

/** An event of a kind on a press, from one time to another on Tuesday 20 October, as a kind's `planItems` reads it. */
function event(kind: string, key: string, from: string, to: string, press: string): PlanEventItemValue {
    return {
        kind, key, title: `${key} title`,
        start: some(utcAt(`2026-10-20T${from}:00`)), end: some(utcAt(`2026-10-20T${to}:00`)),
        resource: some({ kind: "presses", key: press }), status: none, minutes: 60n, due: none,
        state: variant("confirmed", null), quantity: none, lane: none,
    };
}

describe("the footer's counts of the event kinds (#1193, PB23)", () => {
    test("every kind's events in the window and how long they run, the backlog of the kinds that keep one, and the newest commit of any", () => {
        const asked: [Date, Date][] = [];
        const kinds = [
            kind({
                items: () => some([item(), item(), item()]) as never,
                backlog: () => some([item(), item()]) as never,
                commits: [utcAt("2026-10-09T10:00:00"), utcAt("2026-10-01T10:00:00")], asked,
            }),
            kind({ items: () => some([item(), item()]) as never, commits: [utcAt("2026-10-12T08:30:00")] }),
        ];
        const { result } = renderHook(() => usePlanEventCounts(kinds, scale));
        // The backlog's events are the Backlog tab's cards, each with its kind, in the kinds' order (#1344).
        expect(result.current.counts).toEqual({
            events: 5, uncounted: [], hoursNotCounted: [], minutes: 300, drawn: false, backlog: 2, saved: utcAt("2026-10-12T08:30:00"), overlaps: NO_OVERLAPS,
            unscheduled: [{ kind: kinds[0], item: item() }, { kind: kinds[0], item: item() }],
        });
        expect(result.current.counts!.unscheduled[0]!.kind).toBe(kinds[0]);
        // Read over the window the canvas shows.
        expect(asked[0]).toEqual([utcAt("2026-10-05T00:00:00"), utcAt("2026-11-02T00:00:00")]);
    });

    test("no kind keeps a backlog: none is counted; no commit, no last save; no kinds, no counts", () => {
        const plain = renderHook(() => usePlanEventCounts([kind({ items: () => some([item()]) as never })], scale));
        expect(plain.result.current.counts).toEqual({ events: 1, uncounted: [], hoursNotCounted: [], minutes: 60, drawn: false, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] });
        const bare = renderHook(() => usePlanEventCounts([], scale));
        expect(bare.result.current.counts).toBeUndefined();
    });

    test("a read in flight keeps the last counts, and says it is in flight; one that fails keeps them and says why; a Plan without event kinds counts nothing", () => {
        let answer: Answer = () => some([item()]) as never;
        // A new list each time, so the counts are read again.
        const kindsNow = () => [kind({ items: () => answer() })];
        const { result, rerender } = renderHook(({ kinds }) => usePlanEventCounts(kinds, scale), { initialProps: { kinds: kindsNow() } });
        const first = result.current.counts;
        expect(first).toEqual({ events: 1, uncounted: [], hoursNotCounted: [], minutes: 60, drawn: false, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] });
        expect(result.current.reading).toBe(false);
        // In flight: the last counts stand in for it.
        answer = () => none;
        rerender({ kinds: kindsNow() });
        expect(result.current.counts).toBe(first);
        expect(result.current.reading).toBe(true);
        // Failed: they stand still, nothing is in flight, and the console says why.
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            answer = () => { throw new Error("the record could not be read"); };
            rerender({ kinds: kindsNow() });
            expect(result.current.counts).toBe(first);
            expect(result.current.reading).toBe(false);
            expect(errors).toHaveBeenCalled();
        } finally {
            errors.mockRestore();
        }
        // An answer moves them.
        answer = () => some([item(), item()]) as never;
        rerender({ kinds: kindsNow() });
        expect(result.current).toEqual({
            counts: { events: 2, uncounted: [], hoursNotCounted: [], minutes: 120, drawn: false, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] },
            reading: false,
        });
        // No event kinds: nothing to count, and nothing held.
        rerender({ kinds: [] });
        expect(result.current).toEqual({ counts: undefined, reading: false });
    });

    test("a kind read by its cells counts its window's events exactly, from its source as the rail does — its hours over the rows drawn, read from its cells (#1039)", () => {
        const reads: unknown[] = [];
        const jobs = kind({ key: "job", items: () => some([item(), item()]) as never, reads });
        const cellsOfJobs = new Uint8Array([7, 1]);
        const cells = cellsOf([["job", cellsOfJobs]]);
        // Its source counts 42 events in the window: the cells around the rows in view hold two of them.
        let counted: ReturnType<PlanEventPart["part"]["count"]> = some(42n);
        // A new list each time, so the counts are read again.
        const partsNow = () => [{ kind: jobs, part: { count: () => counted } }] as unknown as PlanEventPart[];
        const { result, rerender } = renderHook(({ parts }) => usePlanEventCounts([jobs], scale, undefined, cells, parts), { initialProps: { parts: partsNow() } });
        expect(result.current.counts).toEqual({ events: 42, uncounted: [], hoursNotCounted: [], minutes: 120, drawn: true, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] });
        expect(reads.length).toBeGreaterThan(0);
        expect(reads.every((read) => equalFor(OptionType(BlobType))(read as never, some(cellsOfJobs)))).toBe(true);
        // Its count in flight: the last counts stand; counted again, they move.
        const first = result.current.counts;
        counted = none;
        rerender({ parts: partsNow() });
        expect(result.current.counts).toBe(first);
        counted = some(43n);
        rerender({ parts: partsNow() });
        expect(result.current.counts!.events).toBe(43);
    });

    test("a kind counted before it is read is read over the window only once its count over the range the canvas reads is within the cap (#1039)", () => {
        const asked: [Date, Date][] = [];
        const counts: [Date, Date][] = [];
        let count: option<bigint> = none;
        // A new list each time, so the counts are read again.
        const kindsNow = () => [kind({ items: () => some([item(), item()]) as never, asked, count: () => count, counts })];
        const { result, rerender } = renderHook(({ kinds }) => usePlanEventCounts(kinds, scale), { initialProps: { kinds: kindsNow() } });
        // Its count in flight: nothing of it is read, and there are no counts yet.
        expect(result.current.counts).toBeUndefined();
        expect(asked).toEqual([]);
        // Counted over the range the canvas reads — the window and the two days it lays out beyond each edge.
        expect(counts[0]).toEqual([utcAt("2026-10-03T00:00:00"), utcAt("2026-11-04T00:00:00")]);
        // Past the cap: still nothing read — the reader gives it no cells, and it is counted then.
        count = some(10_001n);
        rerender({ kinds: kindsNow() });
        expect(result.current.counts).toBeUndefined();
        expect(asked).toEqual([]);
        // Within it: read over the window the canvas shows.
        count = some(10_000n);
        rerender({ kinds: kindsNow() });
        expect(result.current.counts).toEqual({ events: 2, uncounted: [], hoursNotCounted: [], minutes: 120, drawn: false, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] });
        expect(asked).toEqual([[utcAt("2026-10-05T00:00:00"), utcAt("2026-11-02T00:00:00")]]);
    });

    test("a kind counted past the cap, given no cells, is counted over the window, never read — its record read whole, in memory — and its hours are not counted: none where no kind's are (#1039)", () => {
        const reads: unknown[] = [];
        const counts: [Date, Date][] = [];
        const empty = new Uint8Array([0]);
        const jobs = kind({ key: "job", items: () => some([]) as never, reads, count: () => some(25_000n), counts });
        // The reader gives it no cells: none of its events is read or drawn.
        const cells = cellsOf([["job", empty]], ["job"]);
        const { result } = renderHook(() => usePlanEventCounts([jobs], scale, undefined, cells));
        expect(result.current.counts).toEqual({
            events: 25_000, uncounted: [], hoursNotCounted: [jobs], minutes: undefined, drawn: false, backlog: undefined, saved: undefined,
            overlaps: NO_OVERLAPS, unscheduled: [],
        });
        // Read from the cells it was given, never over the window; counted over the window itself, each time it is read.
        expect(reads.every((read) => equalFor(OptionType(BlobType))(read as never, some(empty)))).toBe(true);
        expect(counts.length).toBeGreaterThan(0);
        for (const range of counts) expect(range).toEqual([utcAt("2026-10-05T00:00:00"), utcAt("2026-11-02T00:00:00")]);
    });

    test("a kind counted through its day index past the cap, given no cells, is not counted — the days its events run on are no number of them — and the other kinds are; with none other, no count (#1039)", () => {
        const empty = new Uint8Array([0]);
        const dayCounts: [Date, Date][] = [];
        // Its day index files 25,000 entries under the days of the range: past the cap, and no number of its events.
        const days = kind({ key: "run", name: "Print run", items: () => some([]) as never, count: () => some(25_000n), counts: dayCounts, exact: false });
        const jobs = kind({ key: "job", items: () => some([item(), item()]) as never });
        const cells = cellsOf([["run", empty]], ["run"]);
        const both = renderHook(() => usePlanEventCounts([days, jobs], scale, undefined, cells));
        expect(both.result.current.counts).toEqual({
            events: 2, uncounted: [days], hoursNotCounted: [], minutes: 120, drawn: false, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS,
            unscheduled: [],
        });
        // Its count is never asked over the window: the days there would be no number of its events either.
        expect(dayCounts).toEqual([]);
        // Alone, no kind's events are counted, nor its hours: no count, never 0.
        const alone = renderHook(() => usePlanEventCounts([days], scale, undefined, cells));
        expect(alone.result.current.counts!.events).toBeUndefined();
        expect(alone.result.current.counts!.minutes).toBeUndefined();
        expect(alone.result.current.counts!.uncounted).toEqual([days]);
    });

    test("past the cap a kind's events are counted but not its hours — named among the kinds whose hours are not — beside the hours of the kinds read (#1039)", () => {
        const empty = new Uint8Array([0]);
        const jobs = kind({ key: "job", items: () => some([]) as never, count: () => some(25_000n) });
        const checks = kind({ key: "check", name: "Press check", items: () => some([item(), item()]) as never });
        const cells = cellsOf([["job", empty]], ["job"]);
        const { result } = renderHook(() => usePlanEventCounts([jobs, checks], scale, undefined, cells));
        expect(result.current.counts).toEqual({
            events: 25_002, uncounted: [], hoursNotCounted: [jobs], minutes: 120, drawn: false, backlog: undefined, saved: undefined,
            overlaps: NO_OVERLAPS, unscheduled: [],
        });
    });

    test("a kind read by its cells counts nothing before its cells have landed once — its hours are not known yet, never 0 — then counts them (#1398)", () => {
        // Its cells answer no event until a read of them lands: the reader's opening holds none.
        let landed = false;
        const jobs = kind({ key: "job", items: () => some(landed ? [item()] : []) as never });
        const parts = [{ kind: jobs, part: { count: () => some(13n) } }] as unknown as PlanEventPart[];
        const cellsOfJobs = new Uint8Array([7, 1]);
        // The reader's opening: the kind's cells, holding nothing yet — no read of them has landed.
        const { result, rerender } = renderHook(({ cells }) => usePlanEventCounts([jobs], scale, undefined, cells, parts),
            { initialProps: { cells: cellsOf([["job", new Uint8Array([0])]], [], false) } });
        expect(result.current.counts).toBeUndefined();
        // Landed: its events from its source, its hours over the rows drawn.
        landed = true;
        rerender({ cells: cellsOf([["job", cellsOfJobs]]) });
        expect(result.current.counts).toEqual({
            events: 13, uncounted: [], hoursNotCounted: [], minutes: 60, drawn: true, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS,
            unscheduled: [],
        });
    });

    test("a kind hidden in the Series tab is in no figure of the window — never read over it, nor counted first, through its source or its cells — and its backlog is counted still; every kind hidden, no figure (#1039)", () => {
        const asked: [Date, Date][] = [];
        const counts: [Date, Date][] = [];
        const jobs = kind({ key: "job", items: () => some([item(), item(), item()]) as never, backlog: () => some([item()]) as never, asked, counts });
        const crews = kind({ key: "crew", name: "Crew shift", items: () => some([item(), item()]) as never });
        const { result } = renderHook(() => usePlanEventCounts([jobs, crews], scale, undefined, undefined, undefined, JOBS_HIDDEN));
        expect(result.current.counts).toEqual({
            events: 2, uncounted: [], hoursNotCounted: [], minutes: 120, drawn: false, backlog: 1, saved: undefined, overlaps: NO_OVERLAPS,
            unscheduled: [{ kind: jobs, item: item() }],
        });
        // Never read over the window, nor counted first: nothing of it is a figure.
        expect(asked).toEqual([]);
        expect(counts).toEqual([]);
        // Given cells, it is counted through none of them, nor through its source.
        let partCounts = 0;
        const parts = [{ kind: jobs, part: { count: () => { partCounts += 1; return some(13n); } } }] as unknown as PlanEventPart[];
        const byCells = renderHook(() => usePlanEventCounts([jobs, crews], scale, undefined, cellsOf([["job", new Uint8Array([7, 1])]]), parts, JOBS_HIDDEN));
        expect(byCells.result.current.counts!.events).toBe(2);
        expect(partCounts).toBe(0);
        // Every kind hidden: no figure at all — no events, no hours, nothing said not counted — and the backlog still.
        const alone = renderHook(() => usePlanEventCounts([jobs], scale, undefined, undefined, undefined, JOBS_HIDDEN));
        expect(alone.result.current.counts).toEqual({
            events: undefined, uncounted: [], hoursNotCounted: [], minutes: undefined, drawn: false, backlog: 1, saved: undefined, overlaps: NO_OVERLAPS,
            unscheduled: [{ kind: jobs, item: item() }],
        });
    });
});

describe("the overlaps among the window's events (#1198, PB51)", () => {
    test("two events of a kind that warns, on one press at once, are a pair; a kind that allows them pairs none, and two kinds' events never pair", () => {
        const morning = event("job", "J-1", "06:00", "12:00", "b2");
        const noon = event("job", "J-2", "10:00", "13:00", "b2");
        const elsewhere = event("job", "J-3", "10:00", "13:00", "b1");
        const kinds = [
            kind({ items: () => some([morning, noon, elsewhere]), warns: true }),
            // Its events overlap each other, and the jobs: it allows them.
            kind({ items: () => some([event("crew", "C-1", "06:00", "14:00", "b2"), event("crew", "C-2", "08:00", "16:00", "b2")]) }),
        ];
        const { result } = renderHook(() => usePlanEventCounts(kinds, scale));
        const overlaps = result.current.counts!.overlaps;
        expect(overlaps.pairs).toEqual([{ first: morning, second: noon, from: utcAt("2026-10-20T10:00:00"), to: utcAt("2026-10-20T12:00:00") }]);
        expect([...overlaps.peers.keys()]).toHaveLength(2);
        // Counted as events all the same.
        expect(result.current.counts!.events).toBe(5);
    });
});
