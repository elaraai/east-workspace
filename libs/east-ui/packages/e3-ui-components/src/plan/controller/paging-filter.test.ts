/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { expect, test, vi } from "vitest";
import { none, some } from "@elaraai/east";
import type { PlanWireBlock, WindowSkeleton } from "../model.js";
import { rowId } from "../plan.test-utils.js";
import type { PlanPagedSourceValue } from "../use-plan-paging.js";
import { createPagingDriver } from "./paging.js";

function query(id: string, total: number, pending = false) {
    const state = { pending, failure: false };
    const reads: bigint[] = [];
    const value: PlanPagedSourceValue = {
        id, revision: () => some("same-record-revision"), refresh: () => null, seek: none,
        total: () => {
            if (state.failure) throw new Error("Query unavailable");
            return state.pending ? none : some(BigInt(total));
        },
        page: offset => {
            reads.push(offset);
            return state.pending ? none : some([{ fixed: false, parent: none,
                rows: offset >= total ? [] : [{ id: rowId(`${id}:${offset}`), parent: none }],
            } as unknown as PlanWireBlock]);
        },
    };
    return { state, reads, value };
}

function driver() {
    return createPagingDriver({
        skeletonOf: rows => ({ keys: rows.map(row => row.key), parents: rows.map(() => -1),
            top: rows.map(() => true), pinned: rows.map(() => false), declared: rows.map(() => false), facts: [],
        } satisfies WindowSkeleton),
        heightOf: skeleton => skeleton.keys.length * 32,
        restHeightOf: skeleton => skeleton.keys.length * 32,
        onChange: () => {},
    });
}

test("changing record filters retains bounded rows and resets demand, even across rapid replacements", () => {
    const d = driver();
    const original = query("all", 200_000);
    d.setSource(original.value);
    d.jumpToElement(40_000);
    d.committed(d.getSnapshot());
    const before = d.getSnapshot();
    const second = query("held", 20, true);
    d.setSource(second.value, true);
    expect(d.getSnapshot().rows).toBe(before.rows);
    expect(d.getSnapshot().loading).toBe(true);
    expect(second.reads).toEqual([0n]);
    d.reportViewport({ kind: "window", block: 0, w: 200 }, false);
    expect(second.reads, "old scroll positions never fetch far pages in a new query").toEqual([0n]);
    const third = query("late", 2, true);
    d.setSource(third.value, true);
    expect(d.getSnapshot().rows).toBe(before.rows);
    second.state.pending = false;
    d.refresh();
    expect(d.getSnapshot().rows).toBe(before.rows);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
        third.state.pending = false;
        d.refresh();
        expect(d.getSnapshot().rows).not.toBe(before.rows);
        expect(d.getSnapshot().rows).toHaveLength(1);
        expect(d.getSnapshot().total).toBe(2);
        expect(d.getSnapshot().loading).toBe(false);
        expect(third.reads.every(offset => offset === 0n)).toBe(true);
        expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); d.disconnect(); }
});

test("a confirmed empty query or failed query replaces the retained view", () => {
    const d = driver();
    d.setSource(query("all", 2).value);
    const empty = query("empty", 0, true);
    d.setSource(empty.value, true);
    expect(d.getSnapshot().rows).toHaveLength(1);
    empty.state.pending = false;
    d.refresh();
    expect(d.getSnapshot().rows).toHaveLength(0);
    expect(d.getSnapshot().total).toBe(0);
    d.setSource(query("all-again", 2).value, true);
    const failed = query("failed", 2, true);
    d.setSource(failed.value, true);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        failed.state.failure = true;
        d.refresh();
        expect(d.getSnapshot().sourceError).toBe("Query unavailable");
        expect(d.getSnapshot().rows).toHaveLength(0);
        failed.state.failure = false;
        failed.state.pending = false;
        d.refresh();
        expect(d.getSnapshot().sourceError).toBeUndefined();
        expect(d.getSnapshot().rows).toHaveLength(1);
    } finally { error.mockRestore(); d.disconnect(); }
});
