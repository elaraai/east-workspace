/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Reading a paged source's windows (#577) — once each, merged into one stream
 * in window order (#822).
 *
 * "Once" is the property under test, and it is not an optimisation: re-reading
 * the loaded prefix on every evaluation is what made a long prefix evict its own
 * head through the runtime's decoded-window cache (#581).
 */

import { describe, test, expect, vi } from "vitest";
import { some, none } from "@elaraai/east";
import { toCanvasRows, type PlanWireRow } from "./model.js";
import type { PlanPagedSourceValue } from "./use-plan-paging.js";
import { readWindows, mergeWindows, originOf, pruneCache, type WindowCache, type WindowFailures } from "./window-reader.js";
import { rowId, rowKey, testKeyOf } from "./plan.test-utils.js";

const PAGE = 200;

/** A fresh failure record — every read below owns one, as the driver does. */
const noFailures = (): WindowFailures => new Map();

/** A wire row carrying only what these tests read — its id, and its parent's. */
function wire(key: string, parent?: string): PlanWireRow {
    return {
        id: rowId(key),
        parent: parent !== undefined ? some(rowId(parent)) : none,
    } as unknown as PlanWireRow;
}

/** One window's rows as the reader keeps them — keyed for the canvas. */
const win = (w: number, rows: PlanWireRow[]) => ({ w, rows: toCanvasRows(rows) });
const keys = (rows: readonly { key: string }[]) => rows.map((r) => testKeyOf(r.key));

/**
 * A source whose windows land on demand. `landed` decides which windows answer;
 * everything else reports in flight, exactly as a real one does.
 */
function fakeSource(byWindow: ReadonlyMap<number, PlanWireRow[]>, landed: Set<number>) {
    const reads: number[] = [];
    const source = {
        id: "test",
        page: (offset: bigint) => {
            const w = Number(offset) / PAGE;
            reads.push(w);
            if (!landed.has(w)) return none;
            return some(byWindow.get(w) ?? []);
        },
        total: () => some(BigInt(10 * PAGE)),
        seek: none,
    } as unknown as PlanPagedSourceValue;
    return { source, reads };
}

describe("window reader — once each", () => {
    test("a landed window is read once and served from the cache thereafter", () => {
        const data = new Map([[0, [wire("a"), wire("b")]], [1, [wire("c")]]]);
        const { source, reads } = fakeSource(data, new Set([0, 1]));
        const cache: WindowCache = new Map();
        const failures = noFailures();

        const first = readWindows(source, [0, 1], cache, PAGE, failures);
        expect(first.resident.map((r) => r.w)).toEqual([0, 1]);
        expect(keys(first.resident[0]!.rows)).toEqual(["a", "b"]);
        expect(reads).toEqual([0, 1]);

        // Every later evaluation reads NOTHING — the windows are immutable.
        readWindows(source, [0, 1], cache, PAGE, failures);
        readWindows(source, [0, 1], cache, PAGE, failures);
        expect(reads).toEqual([0, 1]);
    });

    test("a window still in flight is re-read until it lands, then never again", () => {
        const data = new Map([[3, [wire("x")]]]);
        const landed = new Set<number>();
        const { source, reads } = fakeSource(data, landed);
        const cache: WindowCache = new Map();
        const failures = noFailures();

        const pending = readWindows(source, [3], cache, PAGE, failures);
        expect(pending.loading).toBe(true);
        expect(pending.resident).toEqual([]);

        readWindows(source, [3], cache, PAGE, failures);
        expect(reads).toEqual([3, 3]);      // asked again while in flight

        landed.add(3);
        const arrived = readWindows(source, [3], cache, PAGE, failures);
        expect(arrived.loading).toBe(false);
        expect(arrived.resident.map((r) => r.w)).toEqual([3]);

        readWindows(source, [3], cache, PAGE, failures);
        expect(reads).toEqual([3, 3, 3]);   // and never again
    });

    test("a HOLE does not stop the read — residency is a set, not a prefix", () => {
        // The dense-prefix loader stopped at the first window in flight, which
        // is right for a prefix and wrong for a run: a landed window is
        // renderable whether or not its neighbour has arrived.
        const data = new Map([[5, [wire("m")]], [7, [wire("q")]]]);
        const { source } = fakeSource(data, new Set([5, 7]));
        const cache: WindowCache = new Map();

        const result = readWindows(source, [5, 6, 7], cache, PAGE, noFailures());
        expect(result.resident.map((r) => r.w)).toEqual([5, 7]);
        expect(result.loading).toBe(true);      // 6 is still coming
    });

    test("a window is keyed for the canvas once, when read — its own repeated ids kept apart (#822)", () => {
        const data = new Map([[0, [wire("a"), wire("b", "a"), wire("a")]]]);
        const { source } = fakeSource(data, new Set([0]));
        const rows = readWindows(source, [0], new Map(), PAGE, noFailures()).resident[0]!.rows;
        expect(rows.map((r) => r.key)).toEqual([rowKey("a"), rowKey("b"), `${rowKey("a")}#1`]);
        expect(rows[1]!.parent).toEqual(some(rowKey("a")));
        expect(rows[2]!.duplicateOf).toBe(rowKey("a"));
    });
});

describe("window reader — a failure belongs to its window (#811)", () => {
    /** Window 1 throws while `failing` holds; every other window lands. */
    function flakySource() {
        const reads: number[] = [];
        const state = { failing: true };
        const source = {
            id: "flaky",
            page: (offset: bigint) => {
                const w = Number(offset) / PAGE;
                reads.push(w);
                if (w === 1 && state.failing) throw new Error("fetch failed: 503");
                return some([wire(`k${w}`)]);
            },
            total: () => some(2000n),
            seek: none,
        } as unknown as PlanPagedSourceValue;
        return { source, reads, state };
    }

    test("a throwing window is reported against ITS index, and the others still read", () => {
        const { source } = flakySource();
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const failures = noFailures();
            const result = readWindows(source, [0, 1, 2], new Map(), PAGE, failures);
            expect(result.failed).toEqual([{ w: 1, error: "fetch failed: 503" }]);
            expect(result.resident.map((r) => r.w)).toEqual([0, 2]);
            expect(result.loading).toBe(false);
            expect([...failures]).toEqual([[1, "fetch failed: 503"]]);
        } finally {
            spy.mockRestore();
        }
    });

    test("a failed window is NOT asked again each evaluation — only once its record is dropped (Retry)", () => {
        const { source, reads, state } = flakySource();
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const cache: WindowCache = new Map();
            const failures = noFailures();
            readWindows(source, [0, 1], cache, PAGE, failures);
            // Every later evaluation reports the failure from the record —
            // a failing source is not hammered once per frame.
            const again = readWindows(source, [0, 1], cache, PAGE, failures);
            readWindows(source, [0, 1], cache, PAGE, failures);
            expect(reads).toEqual([0, 1]);
            expect(again.failed).toEqual([{ w: 1, error: "fetch failed: 503" }]);

            // The source recovers and the record is dropped — what Retry does.
            state.failing = false;
            failures.delete(1);
            const retried = readWindows(source, [0, 1], cache, PAGE, failures);
            expect(reads).toEqual([0, 1, 1]);
            expect(retried.failed).toEqual([]);
            expect(retried.resident.map((r) => r.w)).toEqual([0, 1]);
        } finally {
            spy.mockRestore();
        }
    });
});

describe("window reader — merge (#822)", () => {
    test("windows concatenate in WINDOW order, whatever order they arrive — each keeps its stream order", () => {
        // The stream is the render order: within a window it is the source's,
        // and never re-sorted by key (`kc` stays ahead of `ka2`).
        const merged = mergeWindows([win(2, [wire("kc"), wire("ka2")]), win(0, [wire("kb"), wire("ka")])]);
        expect(keys(merged)).toEqual(["kb", "ka", "kc", "ka2"]);
    });

    test("a row two windows both serve appears ONCE — where the first window placed it", () => {
        // A section header is re-served by every window its series emit into.
        const merged = mergeWindows([
            win(1, [wire("s"), wire("b", "s")]),
            win(0, [wire("s"), wire("a", "s")]),
        ]);
        expect(keys(merged)).toEqual(["s", "a", "b"]);
    });

    test("every child's parent is present — any union of whole windows is a complete forest", () => {
        const merged = mergeWindows([
            win(9, [wire("s"), wire("z", "s")]),
            win(3, [wire("s"), wire("c", "s")]),
        ]);
        // Deliberately NON-adjacent windows, and no window 0.
        const present = new Set(merged.map((r) => r.key));
        for (const r of merged) {
            if (r.parent.type === "some") expect(present.has(r.parent.value)).toBe(true);
        }
    });
});

describe("window reader — origin", () => {
    test("each row is attributed to the window it came from, the first window winning", () => {
        // The driver turns a mounted ROW range back into a window through this,
        // so it must agree with the merge exactly.
        const w0 = win(0, [wire("s"), wire("a", "s")]);
        const w1 = win(1, [wire("s"), wire("b", "s")]);
        const origin = originOf([w1, w0]);
        expect(origin.get(rowKey("a"))).toBe(0);
        expect(origin.get(rowKey("b"))).toBe(1);
        // `s` is served by both; the merge keeps window 0's copy, so the origin
        // must say 0 too — otherwise the map and the rows disagree.
        expect(origin.get(rowKey("s"))).toBe(0);
    });
});

describe("window reader — pruning", () => {
    test("dropping evicted windows is what actually frees the memory", () => {
        const cache: WindowCache = new Map([[0, []], [1, []], [2, []], [9, []]]);
        const dropped = pruneCache(cache, new Set([1, 2]));
        expect(dropped).toBe(2);
        expect([...cache.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    });

    test("an evicted window's FAILURE goes too — demanded again later, it is asked afresh (#811)", () => {
        const failures: WindowFailures = new Map([[3, "boom"], [8, "boom"]]);
        expect(pruneCache(failures, new Set([3, 4]))).toBe(1);
        expect([...failures.keys()]).toEqual([3]);
    });
});
