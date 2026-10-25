/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { none, some } from "@elaraai/east";
import { useSheetSeek } from "./use-seek.js";
import type { SheetPagedSourceValue, SheetRowValue } from "./values.js";

afterEach(cleanup);

/** A listed row the narrowing hides, as the box lists it. */
const hidden = (key: string) => `${key} · hidden`;

/** The rows `r0`, `r1`, … at their places: a window of them, read through the source by position. */
function rowsAt(offset: bigint, limit: bigint): SheetRowValue[] {
    return Array.from({ length: Number(limit) }, (_x, i) => ({ id: `r${Number(offset) + i}`, owned: false, cells: new Map(), lines: [], band: none, subRows: [] }));
}

function source(revision: string, found: boolean): SheetPagedSourceValue {
    return {
        id: "shared-source", page: () => some([]), total: () => some(10n),
        revision: () => some(revision), refresh: () => null,
        seek: some(() => found ? some({ found: true, row: 8n, count: 1n }) : none),
    };
}

test("a new revision cancels a pending query and releases its jump pin", async () => {
    const jump = vi.fn();
    const clear = vi.fn();
    const hook = renderHook(({ src }) => useSheetSeek(src, jump, clear, undefined, hidden), {
        initialProps: { src: source("a", false) },
    });
    let outcome: Promise<unknown>;
    act(() => {
        outcome = hook.result.current.search!.find({ prefix: "x" }).catch(e => e);
        hook.result.current.search!.jump(8);
    });
    const oldKey = hook.result.current.search!.resetKey;
    expect(hook.result.current.target).toBe(8);
    hook.rerender({ src: source("b", true) });
    expect(await outcome!).toBeInstanceOf(Error);
    expect(hook.result.current.search!.resetKey).not.toBe(oldKey);
    expect(hook.result.current.target).toBeUndefined();
    expect(clear).toHaveBeenCalled();
});

test("the match list reads the run's rows through the source by their places — a far one as well as one in view — and marks those a narrowing hides (#1398, CL10)", async () => {
    const asked: [bigint, bigint][] = [];
    const src: SheetPagedSourceValue = { ...source("a", true), page: (offset, limit) => { asked.push([offset, limit]); return some(rowsAt(offset, limit)); } };
    // The narrowing holds every third row.
    const held = (from: number, count: number) => some(Array.from({ length: count }, (_x, i) => (from + i) % 3 === 0));
    const hook = renderHook(() => useSheetSeek(src, vi.fn(), vi.fn(), held, hidden));
    const search = hook.result.current.search!;
    // Far from any row the sheet has drawn: read by its place, its key the box shows once picked.
    expect(await search.listRange(9_000, 3)).toEqual([
        { row: 9_000, label: "r9000", text: "r9000" },
        { row: 9_001, label: "r9001 · hidden", text: "r9001" },
        { row: 9_002, label: "r9002 · hidden", text: "r9002" },
    ]);
    expect(asked).toEqual([[9_000n, 3n]]);
    // Nothing narrowing the rows: none is marked.
    const plain = renderHook(() => useSheetSeek(src, vi.fn(), vi.fn(), undefined, hidden));
    expect(await plain.result.current.search!.listRange(4, 2)).toEqual([{ row: 4, label: "r4", text: "r4" }, { row: 5, label: "r5", text: "r5" }]);
});

test("unmount rejects a pending search instead of leaving the control waiting", async () => {
    const clear = vi.fn();
    const hook = renderHook(() => useSheetSeek(source("a", false), vi.fn(), clear, undefined, hidden));
    let outcome: Promise<unknown>;
    act(() => { outcome = hook.result.current.search!.find({ prefix: "x" }).catch(e => e); });
    hook.unmount();
    expect(await outcome!).toBeInstanceOf(Error);
    expect(clear).toHaveBeenCalled();
});
