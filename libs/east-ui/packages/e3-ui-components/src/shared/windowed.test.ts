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
    WindowStore, advanceAtRest, anchorAround, bandsAround, carriedOf, elementInBand, failedSpan, firstWindow, pinTarget, retryWindows, runAround, sourceChange,
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
        expect(standing.standing).toEqual([0, 1]);
        expect(standing.resident).toEqual([{ w: 0, read: [0] }, { w: 1, read: [1] }]);
        expect(standing.inFlight).toEqual([0, 1]);
        // Each lands at r2: nothing stands in, and r1's windows go.
        landed.add(0).add(1);
        const read = store.read(reader, [0, 1], PAGE);
        expect([read.stale, read.standing]).toEqual([false, []]);
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
        expect(store.read(reader, [0], PAGE)).toEqual({ resident: [{ w: 0, read: [0] }], inFlight: [0], failed: [], stale: true, standing: [0] });
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

describe("a window read again for a source that reads it another way (#809, #1599)", () => {
    test("every window held stands in, landed or already standing in from a revision before, each until its own lands — its failures start afresh, and its revision stays", () => {
        const landed = new Set([0, 1, 2]);
        const failing = new Set<number>();
        const reads: number[] = [];
        // Each window's rows say how they were read: the reading's name, then the window.
        let reading = "first";
        const reader: WindowReader<readonly string[], readonly string[]> = {
            page: (offset) => {
                const w = Number(offset) / PAGE;
                reads.push(w);
                if (failing.has(w)) throw new Error(`window ${w} failed`);
                return landed.has(w) ? some([`${reading}:${w}`]) : none;
            },
            decode: (rows) => rows,
            label: "[Test]",
        };
        const store = new WindowStore<readonly string[]>();
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            store.at("r1");
            store.read(reader, [0, 1, 2], PAGE);
            // r2: window 0 lands, 1 fails, 2 is on its way — so 2 stands in from r1.
            landed.delete(2);
            failing.add(1);
            store.at("r2");
            const moved = store.read(reader, [0, 1, 2], PAGE);
            expect(moved.standing).toEqual([2]);
            expect(moved.failed.map((failure) => failure.w)).toEqual([1]);
            // The source is read another way while that is so: nothing has landed for it.
            reading = "second";
            landed.clear();
            failing.clear();
            store.restart();
            expect(store.revision).toBe("r2");
            const again = store.read(reader, [0, 1, 2], PAGE);
            // Window 0 stands in as r2 read it the first way, and windows 1 and 2 as r1 did: window 1, which failed at r2,
            // is asked again, its record gone, and what it last held stands in for it meanwhile.
            expect(again.resident).toEqual([{ w: 0, read: ["first:0"] }, { w: 1, read: ["first:1"] }, { w: 2, read: ["first:2"] }]);
            expect(again.standing).toEqual([0, 1, 2]);
            expect(again.inFlight).toEqual([0, 1, 2]);
            expect(again.failed).toEqual([]);
            // Each lands the second way: it is the reading's own, and nothing stands in.
            landed.add(0).add(1).add(2);
            const read = store.read(reader, [0, 1, 2], PAGE);
            expect(read.resident.map((window) => window.read)).toEqual([["second:0"], ["second:1"], ["second:2"]]);
            expect([read.stale, store.stale]).toEqual([false, undefined]);
        } finally {
            spy.mockRestore();
        }
    });

    test("with nothing held there is nothing to stand in: the windows are read as a new store's are", () => {
        const store = new WindowStore<readonly number[]>();
        store.restart();
        expect([store.windows.size, store.stale, store.failures.size]).toEqual([0, undefined, 0]);
    });

    test("the one rule a driver asks of the source it is handed: the one that filled what it holds, the same one read another way, or another", () => {
        const source = (id: string, way: string) => ({ id, way });
        const equivalent = (a: { id: string; way: string }, b: { id: string; way: string }) => a.id === b.id && a.way === b.way;
        expect(sourceChange(undefined, source("jobs", "a"), equivalent)).toBe("other");
        expect(sourceChange(source("jobs", "a"), source("jobs", "a"), equivalent)).toBe("same");
        expect(sourceChange(source("jobs", "a"), source("jobs", "b"), equivalent)).toBe("reread");
        expect(sourceChange(source("jobs", "a"), source("crew", "a"), equivalent)).toBe("other");
        expect(sourceChange(source("jobs", "a"), source("crew", "b"), equivalent)).toBe("other");
    });
});

describe("the entries a window carries beside its rows (#1599)", () => {
    const bytes = (...values: number[]) => new Uint8Array(values);
    /** A source of two rows a window, each row its id, each window carrying its rows' entries: the revision's number, then the row's. */
    function carrying(landed: Set<number>, revision: { n: number }) {
        const reader: WindowReader<{ rows: readonly string[]; entries: { id: string; entry: Uint8Array }[] }, readonly string[]> = {
            page: (offset) => {
                const w = Number(offset) / 2;
                if (!landed.has(w)) return none;
                const rows = [`r${w * 2}`, `r${w * 2 + 1}`];
                return some({ rows, entries: rows.map((id, k) => ({ id, entry: bytes(revision.n, w * 2 + k) })) });
            },
            decode: (window) => window.rows,
            entries: (window) => window.entries,
            label: "[Test]",
        };
        return reader;
    }
    const entry = (store: WindowStore<readonly string[]>, id: string, at: number) => {
        const found = store.entryOf(id, at, 2);
        return found === undefined ? undefined : [...found];
    };

    test("a row's entry is the one its own window read with it: found by its id at its position, and not in another window", () => {
        const store = new WindowStore<readonly string[]>();
        store.at("r1");
        store.read(carrying(new Set([0, 1]), { n: 1 }), [0, 1], 2);
        expect(entry(store, "r0", 0)).toEqual([1, 0]);
        expect(entry(store, "r3", 3)).toEqual([1, 3]);
        // The id of a row another window holds, and a position no window stands at.
        expect(entry(store, "r3", 0)).toBeUndefined();
        expect(entry(store, "r9", 8)).toBeUndefined();
    });

    test("while a window is read again at a new revision its rows stand in, and so do their entries: the revision's they were read at, until the window lands — then the new one's", () => {
        const landed = new Set([0, 1]);
        const revision = { n: 1 };
        const reader = carrying(landed, revision);
        const store = new WindowStore<readonly string[]>();
        store.at("r1");
        store.read(reader, [0, 1], 2);
        // r2: window 0 lands, window 1 is on its way.
        revision.n = 2;
        landed.delete(1);
        store.at("r2");
        const moved = store.read(reader, [0, 1], 2);
        expect(moved.standing).toEqual([1]);
        // Window 0's rows are r2's, and their entries with them; window 1's are r1's still, as drawn.
        expect(entry(store, "r1", 1)).toEqual([2, 1]);
        expect(entry(store, "r2", 2)).toEqual([1, 2]);
        landed.add(1);
        store.read(reader, [0, 1], 2);
        expect(entry(store, "r2", 2)).toEqual([2, 2]);
    });

    test("a window standing in is drawn as its reader draws it now — from the entries it carried, reading nothing — while the window kept is the last read's own", () => {
        const landed = new Set([0]);
        const revision = { n: 1 };
        // What the driver lays over a window's entries as it draws: an unsaved change of r1, made while the window is read again.
        let drafted: string | undefined;
        const reads: number[] = [];
        const base = carrying(landed, revision);
        const reader: WindowReader<{ rows: readonly string[]; entries: { id: string; entry: Uint8Array }[] }, readonly string[]> = {
            ...base,
            page: (offset, limit) => { reads.push(Number(offset)); return base.page(offset, limit); },
            standIn: (previous) => (carriedOf(previous) ?? []).map((carriedEntry) => (carriedEntry.id === drafted ? `${carriedEntry.id}*` : carriedEntry.id)),
        };
        const store = new WindowStore<readonly string[]>();
        store.at("r1");
        const first = store.read(reader, [0], 2);
        // Landed, a window is drawn as it was read: no stand-in is asked for.
        expect(first.resident).toEqual([{ w: 0, read: ["r0", "r1"] }]);
        expect(carriedOf(first.resident[0]!.read)!.map((carriedEntry) => carriedEntry.id)).toEqual(["r0", "r1"]);
        // r2 is on its way, and r1 is changed meanwhile: the window standing in draws the change at once.
        revision.n = 2;
        landed.clear();
        store.at("r2");
        drafted = "r1";
        const standing = store.read(reader, [0], 2);
        expect(standing.standing).toEqual([0]);
        expect(standing.resident).toEqual([{ w: 0, read: ["r0", "r1*"] }]);
        // The window kept is the one r1 read: its entries are r1's still, whatever was drawn over them.
        expect(entry(store, "r1", 1)).toEqual([1, 1]);
        expect(store.stale?.get(0)).toEqual(["r0", "r1"]);
        // Once it lands at r2 it is drawn as read, and its entries are r2's.
        landed.add(0);
        expect(store.read(reader, [0], 2).resident).toEqual([{ w: 0, read: ["r0", "r1"] }]);
        expect(entry(store, "r1", 1)).toEqual([2, 1]);
        expect(reads).toEqual([0, 0, 0]);
    });

    test("a window that leaves the run takes its entries with it, and a source whose windows carry none answers none", () => {
        const store = new WindowStore<readonly string[]>();
        store.read(carrying(new Set([0, 1]), { n: 1 }), [0, 1], 2);
        store.prune(new Set([1]));
        expect([entry(store, "r0", 0), entry(store, "r2", 2)]).toEqual([undefined, [1, 2]]);
        const bare = new WindowStore<readonly string[]>();
        const reader: WindowReader<readonly string[], readonly string[]> = { page: () => some(["r0", "r1"]), decode: (rows) => rows, label: "[Test]" };
        bare.read(reader, [0], 2);
        expect(bare.entryOf("r0", 0, 2)).toBeUndefined();
    });
});
