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

/** No resident rows, so no positions — one array, so a re-render keeps it. */
const NO_POSITIONS: number[] = [];

/** Four resident rows: `a`, `b` at 198–199, then — window 1 (200–399) failed — `c`, `d` at 400–401 (#853). */
const ACROSS_A_FAILURE: SheetRowValue[] = ["a", "b", "c", "d"].map((id) => ({ id, owned: false, cells: new Map(), lines: [], band: none, subRows: [] }));
const ACROSS_A_FAILURE_AT = [198, 199, 400, 401];

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
    const hook = renderHook(({ src }) => useSheetSeek(src, [], NO_POSITIONS, jump, clear), {
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

test("the match list reads resident rows by their source positions, and stops at a failed window's hole (#853)", async () => {
    const hook = renderHook(() => useSheetSeek(source("a", true), ACROSS_A_FAILURE, ACROSS_A_FAILURE_AT, vi.fn(), vi.fn()));
    const search = hook.result.current.search!;
    expect(await search.listRange(198, 5)).toEqual(["a", "b"]);
    expect(await search.listRange(400, 5)).toEqual(["c", "d"]);
    expect(await search.listRange(200, 5)).toEqual([]);
});

test("unmount rejects a pending search instead of leaving the control waiting", async () => {
    const clear = vi.fn();
    const hook = renderHook(() => useSheetSeek(source("a", false), [], NO_POSITIONS, vi.fn(), clear));
    let outcome: Promise<unknown>;
    act(() => { outcome = hook.result.current.search!.find({ prefix: "x" }).catch(e => e); });
    hook.unmount();
    expect(await outcome!).toBeInstanceOf(Error);
    expect(clear).toHaveBeenCalled();
});
