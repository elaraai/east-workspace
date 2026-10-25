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
 * a read is in flight or has failed. The same read finds the overlaps among
 * the window's events of the kinds that warn of them (#1198). A kind read by
 * its cells (#1039) counts its window's events exactly from its source, as the
 * rail counts them, and its hours over the rows drawn.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { BlobType, OptionType, SortedMap, StringType, compareFor, equalFor, none, some, variant } from "@elaraai/east";
import { UIStore } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { scheduleOverlaps } from "../../shared/schedule/overlaps.js";
import { utcAt } from "../plan.test-utils.js";
import { planScale, type PlanScale } from "../scale.js";
import type { PlanCellsRead } from "../root/cells.js";
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
 * so its items need no times.
 */
function kind(k: { items: Answer; backlog?: Answer; commits?: readonly Date[]; asked?: [Date, Date][]; warns?: boolean; key?: string; reads?: unknown[] }): PlanEventKindValue {
    return {
        key: k.key ?? "job",
        planItems: (from: Date, to: Date, _drafts: unknown, read: unknown) => {
            k.asked?.push([from, to]);
            k.reads?.push(read);
            return k.items();
        },
        backlog: k.backlog !== undefined,
        planUnscheduled: () => k.backlog!(),
        history: () => some((k.commits ?? []).map((at) => ({ at }))),
        overlaps: variant(k.warns === true ? "warn" : "allow", null),
    } as unknown as PlanEventKindValue;
}

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
        expect(result.current).toEqual({
            events: 5, minutes: 300, drawn: false, backlog: 2, saved: utcAt("2026-10-12T08:30:00"), overlaps: NO_OVERLAPS,
            unscheduled: [{ kind: kinds[0], item: item() }, { kind: kinds[0], item: item() }],
        });
        expect(result.current!.unscheduled[0]!.kind).toBe(kinds[0]);
        // Read over the window the canvas shows.
        expect(asked[0]).toEqual([utcAt("2026-10-05T00:00:00"), utcAt("2026-11-02T00:00:00")]);
    });

    test("no kind keeps a backlog: none is counted; no commit, no last save; no kinds, no counts", () => {
        const plain = renderHook(() => usePlanEventCounts([kind({ items: () => some([item()]) as never })], scale));
        expect(plain.result.current).toEqual({ events: 1, minutes: 60, drawn: false, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] });
        const bare = renderHook(() => usePlanEventCounts([], scale));
        expect(bare.result.current).toBeUndefined();
    });

    test("a read in flight keeps the last counts; one that fails keeps them and says why; a Plan without event kinds counts nothing", () => {
        let answer: Answer = () => some([item()]) as never;
        // A new list each time, so the counts are read again.
        const kindsNow = () => [kind({ items: () => answer() })];
        const { result, rerender } = renderHook(({ kinds }) => usePlanEventCounts(kinds, scale), { initialProps: { kinds: kindsNow() } });
        const first = result.current;
        expect(first).toEqual({ events: 1, minutes: 60, drawn: false, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] });
        // In flight: the last counts stand.
        answer = () => none;
        rerender({ kinds: kindsNow() });
        expect(result.current).toBe(first);
        // Failed: they stand still, and the console says why.
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            answer = () => { throw new Error("the record could not be read"); };
            rerender({ kinds: kindsNow() });
            expect(result.current).toBe(first);
            expect(errors).toHaveBeenCalled();
        } finally {
            errors.mockRestore();
        }
        // An answer moves them.
        answer = () => some([item(), item()]) as never;
        rerender({ kinds: kindsNow() });
        expect(result.current).toEqual({ events: 2, minutes: 120, drawn: false, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] });
        // No event kinds: nothing to count, and nothing held.
        rerender({ kinds: [] });
        expect(result.current).toBeUndefined();
    });

    test("a kind read by its cells counts its window's events exactly, from its source as the rail does — its hours over the rows drawn, read from its cells (#1039)", () => {
        const reads: unknown[] = [];
        const jobs = kind({ key: "job", items: () => some([item(), item()]) as never, reads });
        const cellsOfJobs = new Uint8Array([7, 1]);
        const cells = {
            reads: new SortedMap([["job", cellsOfJobs]], compareFor(StringType)),
            shading: new SortedMap([], compareFor(StringType)),
            drafts: new SortedMap([], compareFor(StringType)),
            held: new Map(), notices: [], reading: false, drawn: undefined,
        } as PlanCellsRead;
        // Its source counts 42 events in the window: the cells around the rows in view hold two of them.
        let counted: ReturnType<PlanEventPart["part"]["count"]> = some(42n);
        // A new list each time, so the counts are read again.
        const partsNow = () => [{ kind: jobs, part: { count: () => counted } }] as unknown as PlanEventPart[];
        const { result, rerender } = renderHook(({ parts }) => usePlanEventCounts([jobs], scale, undefined, cells, parts), { initialProps: { parts: partsNow() } });
        expect(result.current).toEqual({ events: 42, minutes: 120, drawn: true, backlog: undefined, saved: undefined, overlaps: NO_OVERLAPS, unscheduled: [] });
        expect(reads.length).toBeGreaterThan(0);
        expect(reads.every((read) => equalFor(OptionType(BlobType))(read as never, some(cellsOfJobs)))).toBe(true);
        // Its count in flight: the last counts stand; counted again, they move.
        const first = result.current;
        counted = none;
        rerender({ parts: partsNow() });
        expect(result.current).toBe(first);
        counted = some(43n);
        rerender({ parts: partsNow() });
        expect(result.current!.events).toBe(43);
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
        const overlaps = result.current!.overlaps;
        expect(overlaps.pairs).toEqual([{ first: morning, second: noon, from: utcAt("2026-10-20T10:00:00"), to: utcAt("2026-10-20T12:00:00") }]);
        expect([...overlaps.peers.keys()]).toHaveLength(2);
        // Counted as events all the same.
        expect(result.current!.events).toBe(5);
    });
});
