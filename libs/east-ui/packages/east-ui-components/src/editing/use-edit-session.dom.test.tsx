/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The editing session's hook (#879) reads a collection's own rows by the
 * collection's own ids — here bars keyed by `key`, not a sheet's wire rows.
 */

import { afterEach, expect, test } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { ArrayType, IntegerType, StringType, StructType, encodeBeast2For, none, some, toEastTypeValue, variant } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { initializeStore } from "../platform/state-runtime.js";
import { UIStore } from "../platform/state-store.js";
import { useEditSession, type EditingValue } from "./use-edit-session.js";

afterEach(cleanup);

const Run = StructType({ id: StringType, end: IntegerType });
const Draft = Editing.Types.Draft(Run);
const RUNS = [{ id: "a", end: 1n }, { id: "b", end: 2n }, { id: "c", end: 3n }];
/** The collection's projection — a bar, keyed by `key`. */
interface Bar { key: string; end: bigint }
const BARS: Bar[] = RUNS.map((run) => ({ key: run.id, end: run.end }));
const POSITIONS = [0, 1, 2];
const idOf = (bar: Bar): string => bar.key;
const encodeRun = encodeBeast2For(Run);
const editingOf = (keyed: boolean): EditingValue => ({
    sourceId: `bars-${keyed ? "keyed" : "ordered"}`, entryType: toEastTypeValue(Run), idField: some("id"), draftType: toEastTypeValue(Draft),
    children: none, keyed, snapshot: some(encodeBeast2For(ArrayType(Run))(RUNS)),
    readEntry: (id, offset) => { const run = RUNS[Number(offset)]; return run?.id === id ? some(encodeRun(run)) : none; },
    onPatch: none, onApply: some(variant("sync", () => variant("applied", { revision: none }))), mode: variant("batch", null),
});

test("an entry's place among the collection's rows, and its original version, are read by the collection's own ids", () => {
    initializeStore(new UIStore());
    const hook = renderHook(() => useEditSession<Bar>(editingOf(false), undefined, BARS, POSITIONS, "bars", { idOf }));
    const { placeOf, original } = hook.result.current;
    expect(placeOf("b")).toEqual(some(variant("ordered", variant("before", "c"))));
    expect(placeOf("c")).toEqual(some(variant("ordered", variant("after", "b"))));
    expect(placeOf("z")).toEqual(none);
    const b = original("b");
    expect(b.wire).toEqual({ key: "b", end: 2n });
    expect(b.draft).toEqual({ id: variant("value", "b"), end: variant("value", 2n) });
    expect(hook.result.current.available).toBe(true);
});

test("a keyed source places every entry in key order", () => {
    initializeStore(new UIStore());
    const hook = renderHook(() => useEditSession<Bar>(editingOf(true), undefined, BARS, POSITIONS, "bars", { idOf }));
    expect(hook.result.current.placeOf("b")).toEqual(some(variant("keyOrder", null)));
});
