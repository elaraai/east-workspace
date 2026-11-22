/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The one of several values that changed last (`useLatestOf`): what a builder
 * follows once where a carry-over, a gesture and an Undo may each say which
 * entries went on under another key. And what a source says that is news
 * (`newsOf`): what it says after it is first heard.
 */

import { expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { newsOf, useLatestOf } from "./use-latest.js";

type Moves = ReadonlyMap<string, string>;
const NONE: Moves = new Map();

test("what stood as the component mounted is no news; then the value that changed last is the one, the same through a render that changes none, and the first of several that change in one render", () => {
    // A carry-over's and an Undo's, each as its session last said it: said before the builder mounted.
    const carried: Moves = new Map([["J-3", "J-4"]]);
    const stepped: Moves = new Map([["B", "A"]]);
    const { result, rerender } = renderHook(({ values }: { values: readonly Moves[] }) => useLatestOf(values, NONE), { initialProps: { values: [carried, stepped] } });
    expect(result.current).toBe(NONE);
    rerender({ values: [carried, stepped] });
    expect(result.current).toBe(NONE);
    // An Undo since: its own.
    const undone: Moves = new Map([["D", "C"]]);
    rerender({ values: [carried, undone] });
    expect(result.current).toBe(undone);
    // Then a carry-over: the last to change, and so through a render that changes neither.
    const again: Moves = new Map([["J-5", "J-6"]]);
    rerender({ values: [again, undone] });
    rerender({ values: [again, undone] });
    expect(result.current).toBe(again);
    // Both in one render: the first of them.
    const both: Moves = new Map([["J-7", "J-8"]]);
    const other: Moves = new Map([["F", "E"]]);
    rerender({ values: [both, other] });
    expect(result.current).toBe(both);
});

test("what a source had said before it is first heard is no news; what it says after is, once; and each source is heard apart", () => {
    const heard = new WeakMap<object, Moves>();
    const [session, other] = [{}, {}];
    // A session kept from before its builder mounted: its last Undo's moves, said then.
    const stale: Moves = new Map([["B", "A"]]);
    expect(newsOf(heard, session, stale)).toBeUndefined();
    expect(newsOf(heard, session, stale)).toBeUndefined();
    const undone: Moves = new Map([["D", "C"]]);
    expect(newsOf(heard, session, undone)).toBe(undone);
    expect(newsOf(heard, session, undone)).toBeUndefined();
    // Another session, first heard saying the same: no news of its own.
    expect(newsOf(heard, other, undone)).toBeUndefined();
});
