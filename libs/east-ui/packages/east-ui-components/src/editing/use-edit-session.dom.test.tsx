/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The editing session's hook (#879) reads a collection's own rows by the
 * collection's own ids — here bars keyed by `key`, not a sheet's wire rows.
 */

import { afterEach, expect, test } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { ArrayType, DictType, IntegerType, StringType, StructType, encodeBeast2For, equalFor, none, printFor, some, toEastTypeValue, variant } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { initializeStore } from "../platform/state-runtime.js";
import { UIStore } from "../platform/state-store.js";
import { useEditSession, type EditingValue, type EditSource } from "./use-edit-session.js";

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
const RunsByKey = DictType(StringType, Run);
const sameRunsByKey = equalFor(RunsByKey);
const printString = printFor(StringType);
const readEntry: EditingValue["readEntry"] = (id, offset) => {
    const run = RUNS[Number(offset)];
    return run?.id === id ? some(encodeRun(run)) : none;
};
/** An Array source identified by `id`, or a source keyed by String — its snapshot the keyed Dict (#880). */
const editingOf = (keyed: boolean): EditingValue => ({
    sourceId: `bars-${keyed ? "keyed" : "ordered"}`, entryType: toEastTypeValue(Run), draftType: toEastTypeValue(Draft),
    idField: keyed ? none : some("id"), children: none,
    keyType: keyed ? some(toEastTypeValue(StringType)) : none,
    snapshot: some(keyed
        ? encodeBeast2For(RunsByKey)(new Map(RUNS.map((run) => [run.id, run])))
        : encodeBeast2For(ArrayType(Run))(RUNS)),
    readEntry, onPatch: none, onApply: some(variant("sync", () => variant("applied", { revision: none }))), mode: variant("batch", null),
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

test("a keyed source places every entry in key order, and its base is its Dict snapshot", () => {
    initializeStore(new UIStore());
    const hook = renderHook(() => useEditSession<Bar>(editingOf(true), undefined, BARS, POSITIONS, "bars", { idOf }));
    expect(hook.result.current.placeOf("b")).toEqual(some(variant("keyOrder", null)));
    const observed = hook.result.current.observed;
    expect(observed?.base.type).toBe("snapshot");
    // The Dict as East decodes it — compared by East's equality, never a JS Map's.
    expect(sameRunsByKey(observed!.base.value as Map<string, (typeof RUNS)[number]>, new Map(RUNS.map((run) => [run.id, run])))).toBe(true);
    expect(hook.result.current.available).toBe(true);
});

test("a keyed paged source's reconcile seeks each entry by its key's `.east` literal — a String key quoted (#880)", async () => {
    initializeStore(new UIStore());
    const queries: string[] = [];
    const source: EditSource<Bar> = {
        page: (offset, count) => some(BARS.slice(Number(offset), Number(offset + count))),
        revision: () => some("r1"),
        refresh: () => null,
        seek: some((query) => {
            if (query.type === "key") queries.push(query.value);
            const at = query.type === "key" ? RUNS.findIndex((run) => printString(run.id) === query.value) : -1;
            return some({ found: at >= 0, row: BigInt(Math.max(at, 0)), count: at >= 0 ? 1n : 0n });
        }),
    };
    const editing: EditingValue = {
        ...editingOf(true), sourceId: "bars-paged", snapshot: none,
        onApply: some(variant("sync", () => variant("applied", { revision: some("r2") }))),
    };
    const hook = renderHook(() => useEditSession<Bar>(editing, source, BARS, POSITIONS, "bars-paged", { idOf }));
    expect(hook.result.current.available).toBe(true);
    act(() => {
        const { session, original } = hook.result.current;
        const before = original("b");
        session.record([{ id: "b", before, after: { ...before, draft: { id: variant("value", "b"), end: variant("value", 5n) } } }], "typed", "Edit b");
    });
    await act(async () => { await hook.result.current.session.apply(); });
    expect(hook.result.current.session.status).toBe("reconciling");
    // The read after the Apply found "b" by its literal — `"b"`, not the raw id.
    expect(queries).toContain("\"b\"");
    expect(queries).not.toContain("b");
});

test("a keyed paged source's conflicting Save is named by its entries read at the revision it moves to — each sought by its key and read from a one-row page (#1199)", async () => {
    initializeStore(new UIStore());
    // The source as it holds the runs now: another write moves b's end, and the source moves to r2.
    const held = { revision: "r1", runs: RUNS };
    const queries: string[] = [];
    const pages: string[] = [];
    const sourceAt = (): EditSource<Bar> => ({
        page: (offset, count) => {
            pages.push(`${held.revision} ${offset}+${count}`);
            return some(held.runs.slice(Number(offset), Number(offset + count)).map((run) => ({ key: run.id, end: run.end })));
        },
        revision: () => some(held.revision),
        refresh: () => null,
        seek: some((query) => {
            if (query.type === "key") queries.push(query.value);
            const at = query.type === "key" ? held.runs.findIndex((run) => printString(run.id) === query.value) : -1;
            return some({ found: at >= 0, row: BigInt(Math.max(at, 0)), count: at >= 0 ? 1n : 0n });
        }),
    });
    // The source's answer: its own issue, and its words for each entry the Save changed.
    const issue = (entry: string, message: string) => ({ entry, row: none, field: none, message });
    const editing: EditingValue = {
        ...editingOf(true), sourceId: "bars-conflict", snapshot: none,
        readEntry: (id, offset) => {
            const run = held.runs[Number(offset)];
            return run?.id === id ? some(encodeRun(run)) : none;
        },
        onApply: some(variant("sync", () => variant("conflict", [
            issue("", "The record changed since this edit began"), issue("b", "b moved"), issue("c", "c moved"),
        ]))),
    };
    const hook = renderHook(({ source }) => useEditSession<Bar>(editing, source, BARS, POSITIONS, "bars-conflict", { idOf }), { initialProps: { source: sourceAt() } });
    act(() => {
        const { session, original } = hook.result.current;
        const b = original("b");
        const c = original("c");
        session.record([
            { id: "b", before: b, after: { ...b, draft: { id: variant("value", "b"), end: variant("value", 5n) } } },
            { id: "c", before: c, after: { ...c, draft: { id: variant("value", "c"), end: variant("value", 7n) } } },
        ], "typed", "Edit b and c");
    });
    await act(async () => { await hook.result.current.session.apply(); });
    const session = () => hook.result.current.session;
    expect(session().status).toBe("conflict");
    expect(session().issues).toEqual([issue("", "The record changed since this edit began")]);
    // The source moves on: b's end is another write's now; c stands as its edit began.
    held.revision = "r2";
    held.runs = [{ id: "a", end: 1n }, { id: "b", end: 9n }, { id: "c", end: 3n }];
    queries.length = 0;
    pages.length = 0;
    hook.rerender({ source: sourceAt() });
    await act(async () => { await Promise.resolve(); });
    // Each entry the Save changed was sought by its literal and read from a one-row page at r2.
    expect(queries).toEqual(expect.arrayContaining(["\"b\"", "\"c\""]));
    expect(pages).toEqual(expect.arrayContaining(["r2 1+1", "r2 2+1"]));
    expect(session().issues).toEqual([issue("b", "b moved")]);
    expect(session().stale).toBe(true);
});
