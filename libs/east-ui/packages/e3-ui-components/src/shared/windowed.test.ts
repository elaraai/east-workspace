/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the windowed logic loads east-ui-components' internal
 * entry, which needs one as it loads.
 *
 * The windowed rows both paged builders draw (#1398): the run around the view,
 * the bands either side and what a band report names, a failed window's band,
 * the demand at rest, the jump's pin, Retry, and the store a driver keeps of
 * its source's windows — each read once, a failure kept to its window, the
 * previous revision standing in. The Sheet's and the Plan's drivers' own tests
 * carry these into each builder.
 */

import { describe, expect, test, vi } from "vitest";
import { none, some, type option } from "@elaraai/east";
import { DEFAULT_RESIDENCY, NO_RESIDENCY, createLedger, observeWindow, type Residency } from "@elaraai/east-ui-components/internal";
import {
    WindowStore, advanceAtRest, anchorAround, bandsAround, elementInBand, failedSpan, firstWindow, pinTarget, retryWindows, runAround,
    type WindowReader,
} from "./windowed.js";

/** Elements per window, small enough to count by hand. */
const PAGE = 10;
/** Windows `lo` to `hi` resident, nothing pinned. */
const resident = (lo: number, hi: number): Residency => ({ ...NO_RESIDENCY, lo, hi });
/** Which windows are in — landed, or failed. */
const inSet = (...ws: number[]) => (w: number) => ws.includes(w);

describe("the run around the view (#876)", () => {
    test("anchored on the view's own window when it is in, and stretching either way across the windows that are in", () => {
        expect(runAround(resident(2, 6), inSet(3, 4, 5), 45, PAGE)).toEqual({ from: 3, to: 5 });
    });

    test("the view's own window still loading, the nearer of the windows in either side anchors it; one in flight ends it", () => {
        // The view over element 52, window 5 in flight: window 3 ends 13 elements away, window 7 starts 18 away.
        expect(anchorAround(resident(2, 8), inSet(3, 7), 52, PAGE)).toBe(3);
        // Over element 66 the window after is the nearer.
        expect(anchorAround(resident(2, 8), inSet(3, 7), 66, PAGE)).toBe(7);
        // Anchored on 3, the run takes 2 below it and stops at 4, still loading.
        expect(runAround(resident(2, 8), inSet(2, 3, 7), 52, PAGE)).toEqual({ from: 2, to: 3 });
    });

    test("nothing in, or nothing resident: an empty run at the residency's first window, where the bands meet", () => {
        expect(runAround(resident(4, 6), inSet(), 50, PAGE)).toEqual({ from: 4, to: 3 });
        expect(runAround(NO_RESIDENCY, inSet(0), 0, PAGE)).toEqual({ from: 0, to: -1 });
        expect(anchorAround(NO_RESIDENCY, inSet(0), 0, PAGE)).toBeUndefined();
    });
});

describe("the bands either side, and what a band report names (#876, #612)", () => {
    /** A hundred elements in ten windows, none measured: 32 px an element. */
    const ledger = () => createLedger(100, PAGE);

    test("every element above the run and every element below it, each as tall as the ledger makes its windows", () => {
        const { head, tail } = bandsAround(ledger(), resident(3, 5), { from: 3, to: 5 }, PAGE, 100);
        expect(head).toEqual({ from: 0, to: 29, px: 3 * PAGE * 32 });
        expect(tail).toEqual({ from: 60, to: 99, px: 4 * PAGE * 32 });
    });

    test("none at an end the run reaches, nor before anything is resident or the ledger knows a window", () => {
        expect(bandsAround(ledger(), resident(0, 9), { from: 0, to: 9 }, PAGE, 100)).toEqual({ head: undefined, tail: undefined });
        expect(bandsAround(ledger(), NO_RESIDENCY, { from: 0, to: -1 }, PAGE, 100)).toEqual({ head: undefined, tail: undefined });
        expect(bandsAround(createLedger(0, PAGE), resident(0, 0), { from: 0, to: -1 }, PAGE, 0)).toEqual({ head: undefined, tail: undefined });
    });

    test("a band report's pixels name the element under the view, from the band's own top; without them, the element just outside the run", () => {
        const run = { from: 3, to: 5 };
        // Halfway down window 1, and halfway down window 8 (the tail starts at window 6).
        expect(elementInBand(ledger(), run, "head", 15 * 32, PAGE)).toBe(15);
        expect(elementInBand(ledger(), run, "tail", 25 * 32, PAGE)).toBe(85);
        expect(elementInBand(ledger(), run, "head", undefined, PAGE)).toBe(29);
        expect(elementInBand(ledger(), run, "tail", undefined, PAGE)).toBe(60);
    });
});

describe("a failed window's band (#811, #853)", () => {
    test("its elements and its ledger slot, floored; its span ends at the source's count once the ledger knows its windows", () => {
        // Ninety-five elements: the short last window measured at 50 px, which seeds 10 px an element.
        const ledger = observeWindow(createLedger(95, PAGE), 9, { px: 50, rows: 5 });
        expect(failedSpan(ledger, 4, 95, PAGE, 22)).toEqual({ from: 40, to: 49, px: 10 * PAGE });
        expect(failedSpan(ledger, 9, 95, PAGE, 22)).toEqual({ from: 90, to: 94, px: 50 });
        expect(failedSpan(ledger, 9, 95, PAGE, 60)).toEqual({ from: 90, to: 94, px: 60 });
    });

    test("before the ledger knows a window — window 0 failing before anything landed — the whole window, at the floor", () => {
        expect(failedSpan(createLedger(0, PAGE), 0, undefined, PAGE, 22)).toEqual({ from: 0, to: 9, px: 22 });
        expect(failedSpan(createLedger(0, PAGE), 0, 0, PAGE, 22)).toEqual({ from: 0, to: 9, px: 22 });
    });
});

describe("the demand at rest (#1398, CL6), and a jump's pin (#812, #854)", () => {
    test("window 0 first, while nothing is resident; the residency as it is once something is", () => {
        expect(firstWindow(NO_RESIDENCY)).toEqual(resident(0, 0));
        const held = resident(3, 4);
        expect(firstWindow(held)).toBe(held);
    });

    test("a step toward the view, reading ahead the way it travels, the travel kept; nothing to move, the same residency", () => {
        const ledger = createLedger(100, PAGE);
        const down = advanceAtRest(resident(3, 3), ledger, 3, DEFAULT_RESIDENCY, { at: 2, way: 1 });
        expect(down.travel).toEqual({ at: 3, way: 1 });
        expect(down.residency).toEqual(resident(3, 4));
        const up = advanceAtRest(resident(3, 3), ledger, 3, DEFAULT_RESIDENCY, { at: 4, way: 1 });
        expect(up.travel).toEqual({ at: 3, way: -1 });
        expect(up.residency).toEqual(resident(2, 3));
        const met = resident(2, 5);
        expect(advanceAtRest(met, ledger, 3, DEFAULT_RESIDENCY, { at: 3, way: 1 }).residency).toBe(met);
    });

    test("one jump at a time: every other pin goes and the target's window is pinned; rebased, the run starts at a target outside it", () => {
        const pinned = pinTarget({ ...resident(2, 4), pins: new Set([9]) }, 3);
        expect([...pinned.pins]).toEqual([3]);
        expect([pinned.lo, pinned.hi]).toEqual([2, 4]);
        expect(pinTarget(resident(2, 4), 8, true)).toEqual({ lo: 8, hi: 8, pins: new Set([8]) });
        expect(pinTarget(resident(2, 4), 3, true)).toEqual({ lo: 2, hi: 4, pins: new Set([3]) });
        // Nothing resident yet: the first window's read starts where the demand says, the target pinned.
        expect(pinTarget(NO_RESIDENCY, 8, true)).toEqual({ lo: 0, hi: -1, pins: new Set([8]) });
    });
});

describe("Retry (#811, #853, #1398)", () => {
    test("a source that refreshes rearms what failed first, and is asked again a microtask on", async () => {
        const said: string[] = [];
        const source = { refresh: (target: option<string>) => { said.push(target.type === "none" ? "refresh" : "refresh to a target"); return null; } };
        retryWindows(source, () => said.push("ask"));
        expect(said).toEqual(["refresh"]);
        await Promise.resolve();
        expect(said).toEqual(["refresh", "ask"]);
    });

    test("one that cannot refresh is asked again at once", () => {
        const said: string[] = [];
        retryWindows({}, () => said.push("ask"));
        retryWindows(undefined, () => said.push("again"));
        expect(said).toEqual(["ask", "again"]);
    });
});

describe("the store a driver keeps of its source's windows (#577, #811, #821)", () => {
    /** A source whose windows answer as the test lands them, each window's rows its own number; `failing` ones throw. */
    function source(landed: Set<number>, failing: Set<number> = new Set()) {
        const reads: number[] = [];
        const reader: WindowReader<readonly number[], readonly number[]> = {
            page: (offset) => {
                const w = Number(offset) / PAGE;
                reads.push(w);
                if (failing.has(w)) throw new Error(`window ${w} failed`);
                return landed.has(w) ? some([w]) : none;
            },
            decode: (rows) => rows,
            label: "[Test]",
        };
        return { reader, reads };
    }

    test("a landed window is read once; one in flight is asked again; a failed one is not, until its record is forgotten", () => {
        const landed = new Set([0]);
        const failing = new Set([2]);
        const { reader, reads } = source(landed, failing);
        const store = new WindowStore<readonly number[]>();
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const first = store.read(reader, [0, 1, 2], PAGE);
            expect(first.resident.map((r) => r.w)).toEqual([0]);
            expect(first.inFlight).toEqual([1]);
            expect(first.failed).toEqual([{ w: 2, error: "window 2 failed" }]);
            store.read(reader, [0, 1, 2], PAGE);
            expect(reads).toEqual([0, 1, 2, 1]);
            // The source recovers and the record is forgotten — what a Retry does.
            failing.delete(2);
            landed.add(2);
            store.forget(2);
            expect(store.read(reader, [0, 1, 2], PAGE).resident.map((r) => r.w)).toEqual([0, 2]);
            expect(reads).toEqual([0, 1, 2, 1, 1, 2]);
        } finally {
            spy.mockRestore();
        }
    });

    test("a new revision is read afresh, the windows held standing in until each lands; once none stands in, they go", () => {
        const landed = new Set([0, 1]);
        const { reader } = source(landed);
        const store = new WindowStore<readonly number[]>();
        store.at("r1");
        store.read(reader, [0, 1], PAGE);
        // At r2 nothing has landed yet: r1's windows stand in, each still in flight.
        landed.clear();
        store.at("r2");
        const standing = store.read(reader, [0, 1], PAGE);
        expect(standing.stale).toBe(true);
        expect(standing.resident).toEqual([{ w: 0, read: [0] }, { w: 1, read: [1] }]);
        expect(standing.inFlight).toEqual([0, 1]);
        // Each lands at r2: nothing stands in, and r1's windows go.
        landed.add(0).add(1);
        expect(store.read(reader, [0, 1], PAGE).stale).toBe(false);
        expect(store.stale).toBeUndefined();
    });

    test("a revision found while nothing is held leaves the last windows that had rows standing in", () => {
        const landed = new Set([0]);
        const { reader } = source(landed);
        const store = new WindowStore<readonly number[]>();
        store.at("r1");
        store.read(reader, [0], PAGE);
        landed.clear();
        // The source finding its revision again, then naming a new one.
        store.at(undefined);
        store.at("r2");
        expect(store.read(reader, [0], PAGE)).toEqual({ resident: [{ w: 0, read: [0] }], inFlight: [0], failed: [], stale: true });
    });

    test("what leaves the run leaves the store with it: its rows, a stand-in and a failure record", () => {
        const store = new WindowStore<readonly number[]>();
        store.windows = new Map([[0, [0]], [1, [1]], [5, [5]]]);
        store.stale = new Map([[1, [1]], [7, [7]]]);
        store.failures = new Map([[2, "boom"], [8, "boom"]]);
        store.prune(new Set([1, 2]));
        expect([...store.windows.keys()]).toEqual([1]);
        expect([...(store.stale ?? new Map()).keys()]).toEqual([1]);
        expect([...store.failures.keys()]).toEqual([2]);
    });
});
