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
 * events in the window the canvas shows and how long they run (#1197) — the
 * canvas's own, as it placed them over the range it reads, none read again
 * (#1771) — the backlog of the kinds that keep one — its events the Backlog
 * tab's cards (#1344) — and the newest commit to any kind's record; the last
 * counts while the canvas's read of the events is in flight, saying so, or
 * while a read of the footer's own has failed. The same read finds the
 * overlaps among the window's events of the kinds that warn of them (#1198).
 * A kind read by its cells (#1039) counts its window's events exactly from its
 * source, as the rail counts them, and its hours over the rows drawn — once
 * its cells have landed. Every kind is counted before it is read, and counted
 * in the window only once its count over the range the canvas reads is within
 * the cap; past it, given no cells, its events are counted, none drawn, and
 * its hours not counted — and a kind counted through its day index, whose
 * count is the days its events run on, is not counted at all. A kind the
 * viewer hides in the Series tab is in no figure of the window, and its events
 * are not waited for; its backlog is counted still.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { SortedMap, StringType, compareFor, none, some, variant, type option, type ValueTypeOf } from "@elaraai/east";
import { UIStore } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import type { PlanEventDraftsType } from "@elaraai/e3-ui/internal";
import type { ScheduleCellRead, ScheduleCellsRead } from "../../shared/schedule/cells.js";
import type { ScheduleKindRows } from "../../shared/schedule/editing.js";
import { scheduleOverlaps } from "../../shared/schedule/overlaps.js";
import { utcAt } from "../plan.test-utils.js";
import { planScale, type PlanScale } from "../scale.js";
import type { PlanEventPlacing } from "../root/events.js";
import type { PlanEventPart } from "../root/sources.js";
import { usePlanEventCounts, type PlanEventItemValue, type PlanEventKindValue } from "./counts.js";

beforeEach(() => { initializeStore(new UIStore()); });

/** Four weeks by the day, from Monday 5 October. */
const scale = planScale({ kind: "time", window: { min: utcAt("2026-10-05T00:00:00"), max: utcAt("2026-11-02T00:00:00") }, resolution: "day" }) as PlanScale;

/** The range the canvas reads (#619): the window, and the two days the scale lays out beyond each edge. */
const RANGE = { from: utcAt("2026-10-03T00:00:00"), to: utcAt("2026-11-04T00:00:00") };

/** A backlog's event, an hour long, as a kind's `planUnscheduled` reads it. */
const item = () => ({ minutes: 60n });

/** No overlaps: what a window with none in a pair reads. */
const NO_OVERLAPS = scheduleOverlaps([]);

/** A kind's backlog: its events, or none while its read is in flight. */
type Answer = () => ReturnType<PlanEventKindValue["planUnscheduled"]>;

/**
 * An event kind, as the payload carries it: the seams the footer reads, each answering what it is given — its overlaps
 * allowed unless it warns of them. Every kind is counted before it is read (its `count`): by `count`, or as holding none,
 * each range it is counted over kept in `counts`; `exact` false for a kind counted through its day index. It is read
 * through the source named after it, or the one `source` names (#1769). Each window its own events are asked over is
 * kept in `asked`: the footer asks none, the canvas's being the window's (#1771).
 */
function kind(k: {
    backlog?: Answer; commits?: readonly Date[]; asked?: [Date, Date][]; warns?: boolean; key?: string; name?: string;
    count?: () => option<bigint>; counts?: [Date, Date][]; exact?: boolean; source?: string;
}): PlanEventKindValue {
    const count = k.count ?? (() => some(0n));
    return {
        key: k.key ?? "job",
        source: k.source ?? k.key ?? "job",
        name: k.name ?? "Print job",
        planItems: (from: Date, to: Date) => {
            k.asked?.push([from, to]);
            return some([]);
        },
        backlog: k.backlog !== undefined,
        planUnscheduled: () => k.backlog!(),
        history: () => some((k.commits ?? []).map((at) => ({ at }))),
        overlaps: variant(k.warns === true ? "warn" : "allow", null),
        count: (from: Date, to: Date) => {
            k.counts?.push([from, to]);
            return count();
        },
        countExact: k.exact ?? true,
    } as unknown as PlanEventKindValue;
}

/** No rows held: the footer asks only whether a kind's cells have landed, and reads none of them itself. */
const NO_ROWS: ScheduleKindRows = { has: () => false, get: () => undefined, value: () => undefined, ids: () => [], rows: () => [] };

/** What the reader hands a kind it holds rows of (#1771): the rows, by their handle — which only a kind's seams read. */
const JOB_ROWS: ScheduleCellRead = variant("rows", "cells-1");
/** What it hands a kind it reads none of: past the cap, or hidden. */
const NOTHING: ScheduleCellRead = variant("nothing", null);

/**
 * The cells' reader's read, given what it hands each kind and the kinds past the cap: each kind's rows held, as a read
 * that has landed holds them — or, `landed` false, as the reader's opening holds none before its first read.
 */
function cellsOf(reads: [string, ScheduleCellRead][], capped: readonly string[] = [], landed = true): ScheduleCellsRead {
    return {
        reads: new SortedMap(reads, compareFor(StringType)),
        shading: new SortedMap([], compareFor(StringType)),
        drafts: new SortedMap([], compareFor(StringType)),
        held: new Map(landed ? reads.map(([key]) => [key, NO_ROWS] as const) : []), notices: [], capped: new Set(capped), reading: false, drawn: undefined,
        windowed: new Set(), view: landed ? "current" : "cold", error: undefined,
    } as ScheduleCellsRead;
}

/** The ids a viewer hides in the Series tab: the jobs. */
const JOBS_HIDDEN = ["events.job"];

/** Every kind's drafts — none — the one object the canvas read its events with and the footer is given (#1771). */
const DRAFTS: ValueTypeOf<typeof PlanEventDraftsType> = new SortedMap([], compareFor(StringType));

/** An event of a kind from one time to another, on a press or on none, as a kind's `planItems` reads it. */
function eventAt(kind: string, key: string, start: Date, end: Date, press?: string): PlanEventItemValue {
    return {
        kind, key, title: `${key} title`, start: some(start), end: some(end),
        resource: press === undefined ? none : some({ kind: "presses", key: press }), status: none, minutes: 60n, due: none,
        state: variant("confirmed", null), quantity: none, lane: none, locked: false, child: none,
    };
}

/** An event of a kind on a press, from one time to another on Tuesday 20 October. */
const event = (kind: string, key: string, from: string, to: string, press: string): PlanEventItemValue =>
    eventAt(kind, key, utcAt(`2026-10-20T${from}:00`), utcAt(`2026-10-20T${to}:00`), press);

/** `n` events of a kind in the window, an hour each, on Press A1. */
const inWindow = (kind: string, n: number): PlanEventItemValue[] =>
    Array.from({ length: n }, (_x, i) => event(kind, `${kind}-${i + 1}`, "06:00", "07:00", "a1"));

/**
 * The events the canvas placed (#1771), as its seam files them — an event on a press under the presses' bars, by the
 * press's key, and one on no resource under its kind's own — over the range it reads, with the drafts it was given, no
 * cells and nothing hidden, unless told otherwise.
 */
function placingOf(events: readonly PlanEventItemValue[], over: Partial<Omit<PlanEventPlacing, "placed">> = {}): PlanEventPlacing {
    const compareString = compareFor(StringType);
    const on = new SortedMap<string, SortedMap<string, SortedMap<string, unknown[]>>>([], compareString);
    const lost = new SortedMap<string, unknown[]>([], compareString);
    for (const one of events) {
        if (one.start.type !== "some" || one.end.type !== "some") throw new Error(`${one.key}: an event the canvas places has its times`);
        const placed = { item: one, start: one.start.value, end: one.end.value, icon: { prefix: "fas", name: "file-lines", label: none, style: none } };
        if (one.resource.type === "none") {
            lost.set(one.kind, [...(lost.get(one.kind) ?? []), placed]);
            continue;
        }
        const { kind: series, key } = one.resource.value;
        const byDraw = on.get(series) ?? new SortedMap<string, SortedMap<string, unknown[]>>([], compareString);
        on.set(series, byDraw);
        const byKey = byDraw.get("span") ?? new SortedMap<string, unknown[]>([], compareString);
        byDraw.set("span", byKey);
        byKey.set(key, [...(byKey.get(key) ?? []), placed]);
    }
    return { placed: { on, lost } as unknown as PlanEventPlacing["placed"], from: RANGE.from, to: RANGE.to, drafts: DRAFTS, cells: undefined, hidden: [], ...over };
}

describe("the footer's counts of the event kinds (#1193, PB23)", () => {
    test("every kind's events in the window — the canvas's, as it placed them, none read again (#1771) — and how long they run, the backlog of the kinds that keep one, and the newest commit of any", () => {
        const asked: [Date, Date][] = [];
        const kinds = [
            kind({
                key: "job", backlog: () => some([item(), item()]) as never,
                commits: [utcAt("2026-10-09T10:00:00"), utcAt("2026-10-01T10:00:00")], asked,
            }),
            kind({ key: "crew", name: "Crew shift", commits: [utcAt("2026-10-12T08:30:00")], asked }),
        ];
        // The range the canvas read holds a job in the days it lays out before the window too: none of the window's.
        const early = eventAt("job", "J-early", utcAt("2026-10-03T06:00:00"), utcAt("2026-10-03T07:00:00"), "a1");
        const placing = placingOf([...inWindow("job", 3), ...inWindow("crew", 2), early]);
        const { result } = renderHook(() => usePlanEventCounts(kinds, scale, DRAFTS, undefined, undefined, undefined, placing));
        // The backlog's events are the Backlog tab's cards, each with its kind, in the kinds' order (#1344).
        expect(result.current.counts).toEqual({
            events: 5, uncounted: [], hoursNotCounted: [], minutes: 300, drawn: false, backlog: 2, saved: utcAt("2026-10-12T08:30:00"), overlaps: NO_OVERLAPS,
            unscheduled: [{ kind: kinds[0], item: item() }, { kind: kinds[0], item: item() }],
        });
        expect(result.current.counts!.unscheduled[0]!.kind).toBe(kinds[0]);
        // No kind's own events are read for the footer: the window's are the canvas's.
        expect(asked).toEqual([]);
    });

    test("no kind keeps a backlog: none is counted; no commit, no last save; no kinds, no counts", () => {
        const plain = renderHook(() => usePlanEventCounts([kind({})], scale, DRAFTS, undefined, undefined, undefined, placingOf(inWindow("job", 1))));
        expect(plain.result.current.counts).toEqual({ events: 1, uncounted: [], hoursNotCounted: [], minutes: 60, drawn: false, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] });
        const bare = renderHook(() => usePlanEventCounts([], scale));
        expect(bare.result.current.counts).toBeUndefined();
    });

    test("while the canvas's read of the window's events is in flight the last counts stand, saying so — none landed yet, or the last placed over another range, or with other drafts, cells or ids hidden (#1771); a read of the footer's own that fails keeps them and says why; a Plan without event kinds counts nothing", () => {
        const jobs = [kind({})];
        const { result, rerender } = renderHook(({ kinds, placing }) => usePlanEventCounts(kinds, scale, DRAFTS, undefined, undefined, undefined, placing),
            { initialProps: { kinds: jobs, placing: placingOf(inWindow("job", 1)) as PlanEventPlacing | undefined } });
        const first = result.current.counts;
        expect(first).toEqual({ events: 1, uncounted: [], hoursNotCounted: [], minutes: 60, drawn: false, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] });
        expect(result.current.reading).toBe(false);
        // None of these is the window's: its read is in flight, and the last counts stand in for it.
        const two = inWindow("job", 2);
        const notTheWindows = [
            undefined,
            // Read over a range the window has since moved out of, at its start.
            placingOf(two, { from: utcAt("2026-10-10T00:00:00") }),
            placingOf(two, { drafts: new SortedMap([], compareFor(StringType)) }),
            placingOf(two, { cells: cellsOf([]) }),
            placingOf(two, { hidden: ["events.crew"] }),
        ];
        for (const placing of notTheWindows) {
            rerender({ kinds: jobs, placing });
            expect(result.current.counts).toBe(first);
            expect(result.current.reading).toBe(true);
        }
        // A read of the footer's own failed — a backlog's: they stand still, nothing is in flight, and the console says why.
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            rerender({ kinds: [kind({ backlog: () => { throw new Error("the record could not be read"); } })], placing: placingOf(two) });
            expect(result.current.counts).toBe(first);
            expect(result.current.reading).toBe(false);
            expect(errors).toHaveBeenCalled();
        } finally {
            errors.mockRestore();
        }
        // The window's own placing moves them.
        rerender({ kinds: jobs, placing: placingOf(two) });
        expect(result.current).toEqual({
            counts: { events: 2, uncounted: [], hoursNotCounted: [], minutes: 120, drawn: false, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] },
            reading: false,
        });
        // No event kinds: nothing to count, and nothing held.
        rerender({ kinds: [], placing: undefined });
        expect(result.current).toEqual({ counts: undefined, reading: false });
    });

    test("a kind read by its cells counts its window's events exactly, from its source as the rail does — its hours over the rows drawn, the canvas's events from its cells (#1039, #1771)", () => {
        const asked: [Date, Date][] = [];
        const jobs = kind({ key: "job", asked });
        const cells = cellsOf([["job", JOB_ROWS]]);
        // Its source counts 42 events in the window: the canvas placed the two the cells around the rows in view hold.
        const placing = placingOf(inWindow("job", 2), { cells });
        let counted: ReturnType<PlanEventPart["part"]["count"]> = some(42n);
        // A new list each time, so the counts are read again.
        const partsNow = () => [{ kind: jobs, part: { count: () => counted } }] as unknown as PlanEventPart[];
        const { result, rerender } = renderHook(({ parts }) => usePlanEventCounts([jobs], scale, DRAFTS, cells, parts, undefined, placing),
            { initialProps: { parts: partsNow() } });
        expect(result.current.counts).toEqual({ events: 42, uncounted: [], hoursNotCounted: [], minutes: 120, drawn: true, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] });
        // None of its events is read for the footer: the canvas's, from the rows the reader handed it, unpacked once (#1771).
        expect(asked).toEqual([]);
        // Its count in flight: the last counts stand; counted again, they move.
        const first = result.current.counts;
        counted = none;
        rerender({ parts: partsNow() });
        expect(result.current.counts).toBe(first);
        counted = some(43n);
        rerender({ parts: partsNow() });
        expect(result.current.counts!.events).toBe(43);
    });

    test("the kinds of one record's cases read by their cells through one source count it once — its count is all their events — and their hours each its own (#1769)", () => {
        const runs = kind({ key: "run", name: "Print run", source: "step" });
        const setups = kind({ key: "setup", name: "Setup", source: "step" });
        // The one set of rows the reader holds of their record, by one handle (#1771).
        const stepRows: ScheduleCellRead = variant("rows", "cells-2");
        const cells = cellsOf([["run", stepRows], ["setup", stepRows]]);
        // The one source counts nine steps in the window, both kinds' and every other case's.
        const steps = { count: () => some(9n) };
        const parts = [{ kind: runs, part: steps }, { kind: setups, part: steps }] as unknown as PlanEventPart[];
        const placing = placingOf([...inWindow("run", 2), ...inWindow("setup", 1)], { cells });
        const { result } = renderHook(() => usePlanEventCounts([runs, setups], scale, DRAFTS, cells, parts, undefined, placing));
        expect(result.current.counts).toEqual({ events: 9, uncounted: [], hoursNotCounted: [], minutes: 180, drawn: true, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] });
    });

    test("a kind given no cells is counted in the window only once its count over the range the canvas reads is within the cap: in flight or past it, there are no counts yet (#1039)", () => {
        const counts: [Date, Date][] = [];
        let count: option<bigint> = none;
        // A new list each time, so the counts are read again.
        const kindsNow = () => [kind({ count: () => count, counts })];
        const placing = placingOf(inWindow("job", 2));
        const { result, rerender } = renderHook(({ kinds }) => usePlanEventCounts(kinds, scale, DRAFTS, undefined, undefined, undefined, placing),
            { initialProps: { kinds: kindsNow() } });
        // Its count in flight: no counts yet, whatever the canvas holds of it.
        expect(result.current.counts).toBeUndefined();
        // Counted over the range the canvas reads — the window and the two days it lays out beyond each edge.
        expect(counts[0]).toEqual([RANGE.from, RANGE.to]);
        // Past the cap: still none — the reader gives it no cells, and it is counted then.
        count = some(10_001n);
        rerender({ kinds: kindsNow() });
        expect(result.current.counts).toBeUndefined();
        // Within it: its events in the window, as the canvas placed them.
        count = some(10_000n);
        rerender({ kinds: kindsNow() });
        expect(result.current.counts).toEqual({ events: 2, uncounted: [], hoursNotCounted: [], minutes: 120, drawn: false, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] });
    });

    test("a kind counted past the cap, given no cells, is counted over the window — its record read whole, in memory — none of its events drawn, and its hours are not counted: none where no kind's are (#1039)", () => {
        const counts: [Date, Date][] = [];
        const jobs = kind({ key: "job", count: () => some(25_000n), counts });
        // The reader hands it nothing: the canvas placed none of its events.
        const cells = cellsOf([["job", NOTHING]], ["job"]);
        const { result } = renderHook(() => usePlanEventCounts([jobs], scale, DRAFTS, cells, undefined, undefined, placingOf([], { cells })));
        expect(result.current.counts).toEqual({
            events: 25_000, uncounted: [], hoursNotCounted: [jobs], minutes: undefined, drawn: false, backlog: undefined, saved: undefined,
            overlaps: NO_OVERLAPS, unscheduled: [],
        });
        // Counted over the window itself, each time it is read.
        expect(counts.length).toBeGreaterThan(0);
        for (const range of counts) expect(range).toEqual([utcAt("2026-10-05T00:00:00"), utcAt("2026-11-02T00:00:00")]);
    });

    test("a kind counted through its day index past the cap, given no cells, is not counted — the days its events run on are no number of them — and the other kinds are; with none other, no count (#1039)", () => {
        const dayCounts: [Date, Date][] = [];
        // Its day index files 25,000 entries under the days of the range: past the cap, and no number of its events.
        const days = kind({ key: "run", name: "Print run", count: () => some(25_000n), counts: dayCounts, exact: false });
        const jobs = kind({ key: "job" });
        const cells = cellsOf([["run", NOTHING]], ["run"]);
        const both = renderHook(() => usePlanEventCounts([days, jobs], scale, DRAFTS, cells, undefined, undefined, placingOf(inWindow("job", 2), { cells })));
        expect(both.result.current.counts).toEqual({
            events: 2, uncounted: [days], hoursNotCounted: [], minutes: 120, drawn: false, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS,
            unscheduled: [],
        });
        // Its count is never asked over the window: the days there would be no number of its events either.
        expect(dayCounts).toEqual([]);
        // Alone, no kind's events are counted, nor its hours: no count, never 0.
        const alone = renderHook(() => usePlanEventCounts([days], scale, DRAFTS, cells, undefined, undefined, placingOf([], { cells })));
        expect(alone.result.current.counts!.events).toBeUndefined();
        expect(alone.result.current.counts!.minutes).toBeUndefined();
        expect(alone.result.current.counts!.uncounted).toEqual([days]);
    });

    test("past the cap a kind's events are counted but not its hours — named among the kinds whose hours are not — beside the hours of the kinds read (#1039)", () => {
        const jobs = kind({ key: "job", count: () => some(25_000n) });
        const checks = kind({ key: "check", name: "Press check" });
        const cells = cellsOf([["job", NOTHING]], ["job"]);
        const { result } = renderHook(() => usePlanEventCounts([jobs, checks], scale, DRAFTS, cells, undefined, undefined, placingOf(inWindow("check", 2), { cells })));
        expect(result.current.counts).toEqual({
            events: 25_002, uncounted: [], hoursNotCounted: [jobs], minutes: 120, drawn: false, backlog: undefined, saved: undefined,
            overlaps: NO_OVERLAPS, unscheduled: [],
        });
    });

    test("a kind read by its cells counts nothing before its cells have landed once — its hours are not known yet, never 0 — then counts them (#1398)", () => {
        const jobs = kind({ key: "job" });
        const parts = [{ kind: jobs, part: { count: () => some(13n) } }] as unknown as PlanEventPart[];
        // The reader's opening: the kind handed nothing yet — no read of its cells has landed — and none of its events placed.
        const opening = cellsOf([["job", NOTHING]], [], false);
        const { result, rerender } = renderHook(({ cells, placing }) => usePlanEventCounts([jobs], scale, DRAFTS, cells, parts, undefined, placing),
            { initialProps: { cells: opening, placing: placingOf([], { cells: opening }) } });
        expect(result.current.counts).toBeUndefined();
        // Landed: its events from its source, its hours over the rows drawn.
        const landed = cellsOf([["job", JOB_ROWS]]);
        rerender({ cells: landed, placing: placingOf(inWindow("job", 1), { cells: landed }) });
        expect(result.current.counts).toEqual({
            events: 13, uncounted: [], hoursNotCounted: [], minutes: 60, drawn: true, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS,
            unscheduled: [],
        });
    });

    test("a kind hidden in the Series tab is in no figure of the window — nor counted first, through its source or its cells, nor waited for — and its backlog is counted still; every kind hidden, no figure (#1039)", () => {
        const counts: [Date, Date][] = [];
        const jobs = kind({ key: "job", backlog: () => some([item()]) as never, counts });
        const crews = kind({ key: "crew", name: "Crew shift" });
        // The canvas reads no kind the viewer hides: it placed the crews' shifts alone.
        const { result } = renderHook(() => usePlanEventCounts([jobs, crews], scale, DRAFTS, undefined, undefined, JOBS_HIDDEN,
            placingOf(inWindow("crew", 2), { hidden: JOBS_HIDDEN })));
        expect(result.current.counts).toEqual({
            events: 2, uncounted: [], hoursNotCounted: [], minutes: 120, drawn: false, backlog: 1, saved: undefined, overlaps: NO_OVERLAPS,
            unscheduled: [{ kind: jobs, item: item() }],
        });
        // Never counted first: nothing of it is a figure.
        expect(counts).toEqual([]);
        // Given cells, it is counted through none of them, nor through its source.
        let partCounts = 0;
        const parts = [{ kind: jobs, part: { count: () => { partCounts += 1; return some(13n); } } }] as unknown as PlanEventPart[];
        const cells = cellsOf([["job", JOB_ROWS]]);
        const byCells = renderHook(() => usePlanEventCounts([jobs, crews], scale, DRAFTS, cells, parts, JOBS_HIDDEN,
            placingOf(inWindow("crew", 2), { cells, hidden: JOBS_HIDDEN })));
        expect(byCells.result.current.counts!.events).toBe(2);
        expect(partCounts).toBe(0);
        // Every kind hidden: no figure at all — no events, no hours, nothing said not counted — none of the canvas's events
        // waited for, and the backlog still.
        const alone = renderHook(() => usePlanEventCounts([jobs], scale, DRAFTS, undefined, undefined, JOBS_HIDDEN, undefined));
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
        const kinds = [kind({ key: "job", warns: true }), kind({ key: "crew", name: "Crew shift" })];
        // The crews' shifts overlap each other, and the jobs: their kind allows it.
        const shifts = [event("crew", "C-1", "06:00", "14:00", "b2"), event("crew", "C-2", "08:00", "16:00", "b2")];
        const placing = placingOf([morning, noon, elsewhere, ...shifts]);
        const { result } = renderHook(() => usePlanEventCounts(kinds, scale, DRAFTS, undefined, undefined, undefined, placing));
        const overlaps = result.current.counts!.overlaps;
        expect(overlaps.pairs).toEqual([{ first: morning, second: noon, from: utcAt("2026-10-20T10:00:00"), to: utcAt("2026-10-20T12:00:00") }]);
        expect([...overlaps.peers.keys()]).toHaveLength(2);
        // Counted as events all the same.
        expect(result.current.counts!.events).toBe(5);
    });
});
