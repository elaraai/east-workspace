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
import type { PlanPagedSourceValue } from "./use-paged-rows.js";
import { readWindows, mergeWindows, pruneCache, type WindowCache } from "./window-reader.js";

const PAGE = 200;

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

        const first = readWindows(source, [0, 1], cache, PAGE);
        expect(first.resident.map((r) => r.w)).toEqual([0, 1]);
        expect(reads).toEqual([0, 1]);

        // Every later evaluation reads NOTHING — the windows are immutable.
        readWindows(source, [0, 1], cache, PAGE);
        readWindows(source, [0, 1], cache, PAGE);
        expect(reads).toEqual([0, 1]);
    });

    test("a window still in flight is re-read until it lands, then never again", () => {
        const data = new Map([[3, [row("x")]]]);
        const landed = new Set<number>();
        const { source, reads } = fakeSource(data, landed);
        const cache: WindowCache = new Map();

        const pending = readWindows(source, [3], cache, PAGE);
        expect(pending.loading).toBe(true);
        expect(pending.resident).toEqual([]);

        readWindows(source, [3], cache, PAGE);
        expect(reads).toEqual([3, 3]);      // asked again while in flight

        landed.add(3);
        const arrived = readWindows(source, [3], cache, PAGE);
        expect(arrived.loading).toBe(false);
        expect(arrived.resident.map((r) => r.w)).toEqual([3]);

        readWindows(source, [3], cache, PAGE);
        expect(reads).toEqual([3, 3, 3]);   // and never again
    });

    test("a HOLE does not stop the read — residency is a set, not a prefix", () => {
        // The dense-prefix loader stopped at the first window in flight, which
        // is right for a prefix and wrong for a run: a landed window is
        // renderable whether or not its neighbour has arrived.
        const data = new Map([[5, [row("m")]], [7, [row("q")]]]);
        const { source } = fakeSource(data, new Set([5, 7]));
        const cache: WindowCache = new Map();

        const result = readWindows(source, [5, 6, 7], cache, PAGE);
        expect(result.resident.map((r) => r.w)).toEqual([5, 7]);
        expect(result.loading).toBe(true);      // 6 is still coming
    });

    test("a throwing window is reported, and the others still read", () => {
        const source = {
            id: "test",
            page: (offset: bigint) => {
                if (Number(offset) / PAGE === 1) throw new Error("no paging service");
                return some(new Map([["k", row("k")]]));
            },
            total: () => some(2000n),
            seek: none,
        } as unknown as PlanPagedSourceValue;
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const result = readWindows(source, [0, 1, 2], new Map(), PAGE);
            expect(result.error).toMatch(/no paging service/);
            expect(result.resident.map((r) => r.w)).toEqual([0, 2]);
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

describe("window reader — pruning", () => {
    test("dropping evicted windows is what actually frees the memory", () => {
        const cache: WindowCache = new Map([
            [0, new Map()], [1, new Map()], [2, new Map()], [9, new Map()],
        ]);
        const dropped = pruneCache(cache, new Set([1, 2]));
        expect(dropped).toBe(2);
        expect([...cache.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    });
});
