/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Reading a paged source's windows (#577) — once each, merged by key.
 *
 * "Once" is the property under test, and it is not an optimisation: re-reading
 * the loaded prefix on every evaluation is what made a long prefix evict its own
 * head through the runtime's decoded-window cache (#581).
 */

import { describe, test, expect, vi } from "vitest";
import { variant, some, none } from "@elaraai/east";
import type { PlanRowValue } from "./model.js";
import type { PlanPagedSourceValue } from "./use-plan-paging.js";
import { readWindows, mergeWindows, originOf, pruneCache, type WindowCache, type WindowFailures } from "./window-reader.js";

const PAGE = 200;

/** A fresh failure record — every read below owns one, as the driver does. */
const noFailures = (): WindowFailures => new Map();

/** A row carrying only what these tests read. */
function row(key: string): PlanRowValue {
    return { key, parent: none } as unknown as PlanRowValue;
}
function child(key: string, parent: string): PlanRowValue {
    return { key, parent: some(parent) } as unknown as PlanRowValue;
}

/**
 * A source whose windows land on demand. `landed` decides which windows answer;
 * everything else reports in flight, exactly as a real one does.
 */
function fakeSource(byWindow: ReadonlyMap<number, PlanRowValue[]>, landed: Set<number>) {
    const reads: number[] = [];
    const source = {
        id: "test",
        page: (offset: bigint) => {
            const w = Number(offset) / PAGE;
            reads.push(w);
            if (!landed.has(w)) return none;
            const rows = byWindow.get(w) ?? [];
            return some(new Map(rows.map((r) => [r.key, r])));
        },
        total: () => some(BigInt(10 * PAGE)),
        seek: none,
    } as unknown as PlanPagedSourceValue;
    return { source, reads };
}

describe("window reader — once each", () => {
    test("a landed window is read once and served from the cache thereafter", () => {
        const data = new Map([[0, [row("a"), row("b")]], [1, [row("c")]]]);
        const { source, reads } = fakeSource(data, new Set([0, 1]));
        const cache: WindowCache = new Map();
        const failures = noFailures();

        const first = readWindows(source, [0, 1], cache, PAGE, failures);
        expect(first.resident.map((r) => r.w)).toEqual([0, 1]);
        expect(reads).toEqual([0, 1]);

        // Every later evaluation reads NOTHING — the windows are immutable.
        readWindows(source, [0, 1], cache, PAGE, failures);
        readWindows(source, [0, 1], cache, PAGE, failures);
        expect(reads).toEqual([0, 1]);
    });

    test("a window still in flight is re-read until it lands, then never again", () => {
        const data = new Map([[3, [row("x")]]]);
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
        const data = new Map([[5, [row("m")]], [7, [row("q")]]]);
        const { source } = fakeSource(data, new Set([5, 7]));
        const cache: WindowCache = new Map();

        const result = readWindows(source, [5, 6, 7], cache, PAGE, noFailures());
        expect(result.resident.map((r) => r.w)).toEqual([5, 7]);
        expect(result.loading).toBe(true);      // 6 is still coming
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
                return some(new Map([[`k${w}`, row(`k${w}`)]]));
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

describe("window reader — merge", () => {
    test("windows merge by key, in canonical key order, whatever order they arrive", () => {
        const w2 = { w: 2, rows: new Map([["kc", row("kc")], ["ka2", row("ka2")]]) };
        const w0 = { w: 0, rows: new Map([["ka", row("ka")], ["kb", row("kb")]]) };
        const merged = mergeWindows([w2, w0]);
        expect(merged.map((r) => r.key)).toEqual(["ka", "ka2", "kb", "kc"]);
    });

    test("a row two windows both emit appears ONCE — the later window wins", () => {
        // Every window carries its own synthesized group parents, so this is the
        // normal case, not an edge one (#568).
        const w0 = { w: 0, rows: new Map([["g", row("g")], ["a", child("a", "g")]]) };
        const w1 = { w: 1, rows: new Map([["g", row("g")], ["b", child("b", "g")]]) };
        const merged = mergeWindows([w0, w1]);
        expect(merged.map((r) => r.key)).toEqual(["a", "b", "g"]);
        expect(merged.filter((r) => r.key === "g")).toHaveLength(1);
    });

    test("every child's parent is present — any union of whole windows is a complete forest", () => {
        const w3 = { w: 3, rows: new Map([["g", row("g")], ["c", child("c", "g")]]) };
        const w9 = { w: 9, rows: new Map([["g", row("g")], ["z", child("z", "g")]]) };
        // Deliberately NON-adjacent windows, and no window 0.
        const merged = mergeWindows([w9, w3]);
        const keys = new Set(merged.map((r) => r.key));
        for (const r of merged) {
            if (r.parent.type === "some") expect(keys.has(r.parent.value)).toBe(true);
        }
    });
});

describe("window reader — origin", () => {
    test("each row is attributed to the window it came from, later window winning", () => {
        // The driver turns a mounted ROW range back into a window through this,
        // so it must agree with the merge exactly.
        const w0 = { w: 0, rows: new Map([["g", row("g")], ["a", child("a", "g")]]) };
        const w1 = { w: 1, rows: new Map([["g", row("g")], ["b", child("b", "g")]]) };
        const origin = originOf([w1, w0]);
        expect(origin.get("a")).toBe(0);
        expect(origin.get("b")).toBe(1);
        // `g` is emitted by both; the merge keeps window 1's copy, so the origin
        // must say 1 too — otherwise the map and the rows disagree.
        expect(origin.get("g")).toBe(1);
    });
});

describe("window reader — pruning", () => {
    test("dropping evicted windows is what actually frees the memory", () => {
        const cache: WindowCache = new Map([
            [0, new Map()], [1, new Map()], [2, new Map()], [9, new Map()],
        ]);
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
