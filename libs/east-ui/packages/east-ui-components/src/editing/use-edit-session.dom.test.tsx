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
import { autosaveChoiceKey, autosaveChoiceOf } from "./autosave-choice.js";
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
    readEntry, onPatch: none, onApply: some(variant("sync", () => variant("applied", { revision: none }))),
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

test("a session's builder keeps its choice of an automatic Save by its view — but a collection whose every Save is a person's keeps none, so no Save of it goes by itself", () => {
    initializeStore(new UIStore());
    const kept = renderHook(() => useEditSession<Bar>(editingOf(false), undefined, BARS, POSITIONS, "bars", { idOf }));
    expect(autosaveChoiceOf(kept.result.current.session)?.key).toBe(autosaveChoiceKey("", "bars"));
    // One whose Save asks the person something first — a query never saved asks its name.
    const manual = renderHook(() => useEditSession<Bar>(editingOf(false), undefined, BARS, POSITIONS, "bars-by-hand", { idOf, manualSave: true }));
    expect(autosaveChoiceOf(manual.result.current.session)).toBeUndefined();
});

test("a session's builder's choice begins where its author says — off, said nothing — from the session's first render, and moves as the author's word does", () => {
    initializeStore(new UIStore());
    const silent = renderHook(() => useEditSession<Bar>(editingOf(false), undefined, BARS, POSITIONS, "bars-silent", { idOf }));
    expect(autosaveChoiceOf(silent.result.current.session)?.begins()).toBe(false);
    const begins: boolean[] = [];
    const hook = renderHook(({ autosave }: { autosave: boolean }) => {
        const edit = useEditSession<Bar>(editingOf(false), undefined, BARS, POSITIONS, "bars-begun", { idOf, autosave });
        // As the session's bar reads it, in the render that makes the session.
        begins.push(autosaveChoiceOf(edit.session)!.begins());
        return edit;
    }, { initialProps: { autosave: true } });
    expect(begins[0]).toBe(true);
    const choice = autosaveChoiceOf(hook.result.current.session)!;
    let heard = 0;
    const stop = choice.subscribe(() => { heard++; });
    hook.rerender({ autosave: false });
    expect([choice.begins(), heard]).toEqual([false, 1]);
    // Said again as it stands, nobody is told.
    hook.rerender({ autosave: false });
    expect([choice.begins(), heard]).toEqual([false, 1]);
    stop();
    // A collection whose every Save is a person's has no choice to begin.
    const manual = renderHook(() => useEditSession<Bar>(editingOf(false), undefined, BARS, POSITIONS, "bars-by-hand-begun", { idOf, manualSave: true, autosave: true }));
    expect(autosaveChoiceOf(manual.result.current.session)).toBeUndefined();
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
    let revision = "r1";
    const source: EditSource<Bar> = {
        page: (offset, count) => some(BARS.slice(Number(offset), Number(offset + count))),
        revision: () => some(revision),
        refresh: () => { revision = "r2"; return null; },
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

test("a keyed paged source's conflicting Save carries its drafts over to the revision it moves to — each entry sought by its key and read from a one-row page, a part another write changed differently a conflict (#1199)", async () => {
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
    // Carried over to r2: c's change stands; b's end, another write's too, is a conflict, and Save waits for it.
    expect([session().stale, session().status, session().unsettled, session().canApply]).toEqual([false, "idle", 1, false]);
    expect([...session().conflicts.keys()]).toEqual(["b"]);
});

test("a positional source's entries are read back from the windows its rows are read in, at most eight still to land at a time: an entry of a window the pass has read is judged from it, and a window it has not read waits for a later pass (#1596)", async () => {
    initializeStore(new UIStore());
    // Twenty runs in windows of two. A Save changes two runs of the first window and one of each other; read back, the
    // first window lands at once and the others only once the test says so.
    const stored = Array.from({ length: 20 }, (_, i) => ({ id: `r${String(i).padStart(2, "0")}`, end: BigInt(i) }));
    const edited = ["r00", "r02", "r04", "r06", "r08", "r10", "r12", "r14", "r16", "r01", "r18"];
    const held = { revision: "r1", runs: stored, landed: (start: number): boolean => start === 0 };
    const asked: number[] = [];
    const sourceAt = (): EditSource<Bar> => ({
        pageSize: 2,
        page: (offset, count) => {
            const start = Number(offset);
            asked.push(start);
            return held.landed(start) ? some(held.runs.slice(start, start + Number(count)).map((run) => ({ key: run.id, end: run.end }))) : none;
        },
        revision: () => some(held.revision),
        refresh: () => null,
        seek: none,
    });
    const editing: EditingValue = {
        ...editingOf(false), sourceId: "bars-windows", snapshot: none,
        readEntry: (id, offset) => {
            const run = held.runs[Number(offset)];
            return run?.id === id ? some(encodeRun(run)) : none;
        },
        onApply: some(variant("sync", () => {
            held.runs = stored.map((run) => (edited.includes(run.id) ? { id: run.id, end: run.end + 100n } : run));
            held.revision = "r2";
            return variant("applied", { revision: some("r2") });
        })),
    };
    const bars = stored.map((run) => ({ key: run.id, end: run.end }));
    const positions = stored.map((_, i) => i);
    const hook = renderHook(({ source }) => useEditSession<Bar>(editing, source, bars, positions, "bars-windows", { idOf }), { initialProps: { source: sourceAt() } });
    act(() => {
        const { session, original } = hook.result.current;
        session.record(edited.map((id) => {
            const before = original(id);
            const run = stored.find((one) => one.id === id)!;
            return { id, before, after: { ...before, draft: { id: variant("value", id), end: variant("value", run.end + 100n) } } };
        }), "typed", "Edit runs");
    });
    asked.length = 0;
    await act(async () => { await hook.result.current.session.apply(); });
    hook.rerender({ source: sourceAt() });
    await act(async () => { await Promise.resolve(); });
    const session = () => hook.result.current.session;
    expect(session().status).toBe("reconciling");
    // The first window landed: both its entries are judged from it, the second after eight other windows were asked for.
    expect(session().unresolvedIdsAt("r2")).toEqual(["r02", "r04", "r06", "r08", "r10", "r12", "r14", "r16", "r18"]);
    // Eight windows are in flight, and the tenth, which no pass has read, waits for one of them.
    expect([...new Set(asked)].sort((a, b) => a - b)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16]);
    // They land: the tenth is read, and every entry is confirmed.
    held.landed = () => true;
    hook.rerender({ source: sourceAt() });
    await act(async () => { await Promise.resolve(); });
    hook.rerender({ source: sourceAt() });
    await act(async () => { await Promise.resolve(); });
    expect(asked).toContain(18);
    expect([session().status, session().pending]).toEqual(["idle", 0]);
});

test("hidden and paged-out drafts retain history and Save confirms them by primary identity", async () => {
    initializeStore(new UIStore());
    const held = { revision: "r1", pending: true };
    const confirmed: string[] = [];
    const sourceAt = (): EditSource<Bar> => ({
        revision: () => some(held.revision), refresh: () => null,
        page: () => { throw new Error("The narrowed view no longer contains b"); },
        seek: some(() => { throw new Error("Confirmation must use primary identity"); }),
        readCurrent: (id) => {
            confirmed.push(id);
            return held.pending ? none : some(some(encodeRun({ id: "b", end: 5n })));
        },
    });
    const editing: EditingValue = {
        ...editingOf(true), sourceId: "filtered-bars", snapshot: none,
        onApply: some(variant("sync", () => variant("applied", { revision: some("r2") }))),
    };
    const hook = renderHook(({ source, rows }) => useEditSession<Bar>(editing, source, rows, POSITIONS, "filtered-bars", { idOf }), {
        initialProps: { source: sourceAt(), rows: BARS },
    });
    act(() => {
        const { session, original } = hook.result.current;
        const before = original("b");
        session.record([{ id: "b", before, after: { ...before, draft: { id: variant("value", "b"), end: variant("value", 5n) } } }], "typed", "Edit b");
    });
    const session = hook.result.current.session;
    // Evict the edited row from the resident window, as scrolling or filtering does.
    // The page cache is not the draft store; even Undo/Redo works while hidden.
    const hidden = BARS.filter(bar => bar.key !== "b");
    hook.rerender({ source: sourceAt(), rows: hidden });
    expect(hook.result.current.session).toBe(session);
    expect(session.pending).toBe(1);
    expect([...hook.result.current.drafts.keys()]).toEqual(["b"]);
    act(() => session.undo());
    expect(session.pending).toBe(0);
    act(() => session.redo());
    expect(session.pending).toBe(1);
    hook.rerender({ source: sourceAt(), rows: BARS });
    expect(hook.result.current.original("b").draft).toEqual({ id: variant("value", "b"), end: variant("value", 5n) });
    hook.rerender({ source: sourceAt(), rows: hidden });
    expect(confirmed, "gestures and paging use retained drafts without extra primary reads").toEqual([]);
    await act(async () => { await session.apply(); });
    held.revision = "r2";
    hook.rerender({ source: sourceAt(), rows: BARS.filter(bar => bar.key !== "b") });
    expect(hook.result.current.session.status).toBe("reconciling");
    expect(hook.result.current.session.entries.size).toBe(1);
    held.pending = false;
    hook.rerender({ source: sourceAt(), rows: BARS.filter(bar => bar.key !== "b") });
    expect(confirmed).toContain("b");
    expect(hook.result.current.session.pending).toBe(0);
    expect(hook.result.current.session.status).toBe("idle");
    expect(hook.result.current.available).toBe(true);
    expect(hook.result.current.session.issues).toEqual([]);
});
