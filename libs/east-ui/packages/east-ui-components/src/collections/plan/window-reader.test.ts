/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Reading a paged source's windows (#577) — once each, each window the
 * canvas's blocks, keyed block by block (#823).
 *
 * "Once" is the property under test, and it is not an optimisation: re-reading
 * the loaded prefix on every evaluation is what made a long prefix evict its own
 * head through the runtime's decoded-window cache (#581).
 */

import { describe, test, expect, vi } from "vitest";
import { some, none } from "@elaraai/east";
import type { PlanWireBlock, PlanWireRow } from "./model.js";
import type { PlanPagedSourceValue } from "./use-plan-paging.js";
import { readWindow, readWindows, pruneCache, type WindowCache, type WindowFailures, type WindowRead } from "./window-reader.js";
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

/** One wire block — a data series' rows unless `fixed`, under `parent` (#823). */
function block(rows: PlanWireRow[], opts?: { fixed?: boolean; parent?: string }): PlanWireBlock {
    return {
        fixed: opts?.fixed === true,
        parent: opts?.parent !== undefined ? some(rowId(opts.parent)) : none,
        rows,
    } as unknown as PlanWireBlock;
}
const keys = (rows: readonly { key: string }[]) => rows.map((r) => testKeyOf(r.key));
/** A read's first block's rows. */
const rowsOf = (read: WindowRead) => read.blocks[0]!;

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
            return some([block(byWindow.get(w) ?? [])]);
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
        expect(keys(rowsOf(first.resident[0]!.read))).toEqual(["a", "b"]);
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
        const rows = rowsOf(readWindows(source, [0], new Map(), PAGE, noFailures()).resident[0]!.read);
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
                return some([block([wire(`k${w}`)])]);
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

describe("window reader — a window is the canvas's blocks (#823)", () => {
    test("each block is kept apart and keyed on its own, and names its shape", () => {
        const read = readWindow([
            block([wire("hdr")], { fixed: true }),
            block([wire("a", "hdr"), wire("b", "hdr")], { parent: "hdr" }),
            block([wire("a"), wire("c")]),
        ]);
        expect(read.blocks.map(keys)).toEqual([["hdr"], ["a", "b"], ["a", "c"]]);
        // Each row names the block it came from.
        expect(read.blocks.map((rows) => rows.map((r) => r.block))).toEqual([[0], [1, 1], [2, 2]]);
        // A repeat ACROSS blocks is the driver's to key (`keyAcrossBlocks`);
        // within a block, the window keys it as ever.
        expect(read.blocks[2]![0]!.key).toBe(rowKey("a"));
        expect(read.shape).toEqual([
            { fixed: true, parent: undefined },
            { fixed: false, parent: rowKey("hdr") },
            { fixed: false, parent: undefined },
        ]);
    });
});

describe("window reader — pruning", () => {
    test("dropping evicted windows is what actually frees the memory", () => {
        const empty: WindowRead = { blocks: [], shape: [] };
        const cache: WindowCache = new Map([[0, empty], [1, empty], [2, empty], [9, empty]]);
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
