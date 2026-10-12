/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

import { afterEach, expect, test } from "vitest";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import {
    ArrayType, DictType, East, FunctionType, IntegerType, OptionType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, encodeBeast2For, none, parseFor, printFor, some, toEastTypeValue, variant,
    type option, type ValueTypeOf,
} from "@elaraai/east";
import {
    Editing, PinnedSourceType, RecordSliceConfigType, RecordSliceController, RecordSliceStateType, RecordSliceWhereType,
    applyEditing, recordSliceReadPlatform, type RecordSliceBinding, type RecordSliceBindType,
} from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore, registerReactiveTracker, useEditSession, useTrackedEvaluation, type EditingValue } from "@elaraai/east-ui-components";
import { RecordSliceImpl } from "@elaraai/east-ui-components/platform";
import { createTrackedRead, prepareRecordSliceSave, RecordSliceSaveNotice, trackKey, type EditSource } from "@elaraai/east-ui-components/internal";
import { PagedRuntime } from "./paged-runtime.js";
import { useRosterVisibility } from "../roster/visibility.js";

const Row = StructType({ status: StringType, quantity: IntegerType });
const Records = DictType(StringType, Row);
const Entries = ArrayType(StructType({ key: StringType, row: OptionType(Row) }));
const Source = PinnedSourceType(Records);
type RowValue = ValueTypeOf<typeof Row>;
type Where = ValueTypeOf<RecordSliceWhereType>;
const encode = encodeBeast2For(Records);
const compareString = compareFor(StringType);
const printString = printFor(StringType);
const parseString = parseFor(StringType);
const encodeState = encodeBeast2For(RecordSliceStateType);
const decodeState = decodeBeast2For(RecordSliceStateType);
const cleanups: (() => void)[] = [];
afterEach(() => { cleanup(); while (cleanups.length) cleanups.pop()!(); });

/** Real cache and subscription machinery; only the remote page service is a fixture. */
function fixture(count: number, shortPages = false) {
    const store = new UIStore(); StateRuntime.initializeStore(store);
    const ids = Array.from({ length: count }, (_, i) => `job-${i.toString().padStart(5, "0")}`);
    let rows: ValueTypeOf<typeof Records> = new SortedMap<string, RowValue>(ids.map(id => [id, { status: "Ready", quantity: 1n }]), compareString);
    let hash = "a".repeat(64);
    const requests: { offset: number; limit: number; hash: string | undefined }[] = [];
    const runtime = new PagedRuntime();
    runtime.initialize({
        async getRevision() { return hash; },
        watchRevision() { return () => {}; },
        async findKey(_workspace, _path, query) {
            if (!("key" in query)) throw new Error("This fixture seeks exact primary keys");
            const parsed = parseString(query.key);
            if (!parsed.success) throw new Error(parsed.error);
            const offset = ids.indexOf(parsed.value);
            return { found: offset >= 0, row: Math.max(0, offset), count: offset < 0 ? 0 : 1, hash };
        },
        async getPage(_workspace, _path, window) {
            requests.push({ offset: window.offset, limit: window.limit, hash: window.hash });
            if (requests.length > 400) throw new Error("The reader repeatedly refetched evicted pages");
            const keys = ids.slice(window.offset, window.offset + (shortPages ? 1 : window.limit));
            const data = encode(new SortedMap(keys.map(id => [id, rows.get(id)!]), compareString));
            return { data, hash, offset: window.offset, count: keys.length, totalElements: count,
                totalBytes: data.length, totalExact: true, segmentCount: 1 };
        },
    }, "bounded-record-cache");
    const release = registerReactiveTracker({ id: "bounded-record-cache", enableTracking: () => runtime.enableTracking(),
        disableTracking: () => runtime.disableTracking(), getStore: () => runtime });
    cleanups.push(() => { release(); runtime.clear(); });
    const handle = runtime.buildHandle(toEastTypeValue(Records), [variant("field", "records"), variant("field", "jobs")],
        { index: null, join: false }, "pinned") as ValueTypeOf<typeof Source>;
    const binding: RecordSliceBinding = {
        id: "jobs", recordId: "jobs", defaultIndex: "primary", revision: handle.revision, refresh: handle.refresh,
        total: () => some(BigInt(count)),
        seek: (index, query) => {
            if (index === "primary") return handle.seek.type === "some" ? handle.seek.value(query) : none;
            if (query.type !== "key") throw new Error("This fixture has a scalar status index");
            const parsed = parseString(query.value);
            if (!parsed.success) throw new Error(parsed.error);
            const matches = [...rows.values()].filter(row => compareString(row.status, parsed.value) === 0).length;
            const preceding = [...rows.values()].filter(row => compareString(row.status, parsed.value) < 0).length;
            return some({ found: matches > 0, row: BigInt(preceding), count: BigInt(matches) });
        },
        page: (_index, offset, limit) => {
            const page = handle.page(offset, limit);
            return page.type === "none" ? none : some([...page.value].map(([key, row]) => ({ ik: variant("primary", key), key, row: some(row) })));
        },
        entryKeys: (_index, _key, row) => [printString((row as RowValue).status)],
    };
    const config = decodeBeast2For(RecordSliceConfigType)(encodeBeast2For(RecordSliceConfigType)({
        fields: [{ fieldId: "status", label: "Status", kind: "string", optional: false, multiple: true, set: false, values: [], format: none }],
        indexes: [{ name: "by_status", fields: ["status"], sets: new Set(), structured: false, interval: none }], range: none, search: [], presets: [],
    }));
    const stateKey = "record-cache.query";
    const read = () => { trackKey(stateKey); return decodeState(store.read(stateKey)!); };
    const write = (state: ValueTypeOf<RecordSliceStateType>) => { store.write(stateKey, encodeState(state)); return null; };
    write({ where: new Map(), preset: none, resolution: none });
    const controller = new RecordSliceController(binding, config, Row, read, write);
    // The notice consumes just these controller methods; queries and pages run
    // through the same controller and PagedRuntime as the serialized handle.
    const slice = { key: stateKey, sourceId: "jobs", config, read, write,
        contains: (where: Where, id: string) => controller.contains(where, id), retry: () => handle.refresh(none),
    } as ValueTypeOf<RecordSliceBindType>;
    return { ids, handle, requests, controller, slice, rows: () => rows,
        choose: (status: string) => controller.choose("status", variant("values", [printString(status)])),
        commit: (value: typeof rows) => { rows = value; hash = "b".repeat(64); return hash; },
    };
}

/** Resolve from dependency notifications, with no polling or timing assumptions. */
function settled<T>(read: () => option<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        let queued = false; let done = false;
        const enqueue = () => { if (!queued && !done) { queued = true; queueMicrotask(run); } };
        const tracked = createTrackedRead(enqueue);
        cleanups.push(() => tracked.release());
        const run = () => {
            queued = false;
            if (done) return;
            const result = tracked.run(read);
            if (!result.ok || result.value.type === "some") {
                done = true; tracked.release();
                if (!result.ok) reject(result.error);
                else if (result.value.type === "some") resolve(result.value.value);
            }
        };
        enqueue();
    });
}

const scan = East.compile(East.function([
    StringType, FunctionType([], OptionType(StringType)), FunctionType([RecordSliceWhereType], OptionType(IntegerType)),
    FunctionType([RecordSliceWhereType, IntegerType, IntegerType], OptionType(Entries)), RecordSliceWhereType,
], OptionType(Entries), (_$, id, revision, total, page, where) => recordSliceReadPlatform([Entries], id, revision, total, page, where)), RecordSliceImpl);

test("an indexed scan exceeds both page-cache caps, finishes linearly and still evicts old pages", async () => {
    const f = fixture(12_800);
    const where: Where = new Map();
    const read = () => scan("all", f.handle.revision, w => f.controller.count(w),
        (w, offset, limit) => f.controller.windows.page(f.controller.plan(w), offset, limit) as option<ValueTypeOf<typeof Entries>>, where);
    const hook = renderHook(() => useTrackedEvaluation(read));
    await waitFor(() => expect(hook.result.current.result.ok && hook.result.current.result.value.type).toBe("some"));
    const result = hook.result.current.result;
    if (!result.ok || result.value.type !== "some") throw new Error("The scan did not complete");
    expect(result.value.value.map(entry => entry.key)).toEqual(f.ids);
    // A pointer/keyboard gesture reads outside tracking and must reuse the
    // active view, including an event whose original page has been evicted.
    expect(read().type).toBe("some");
    expect(f.requests).toHaveLength(50);
    expect(f.requests.every(request => request.limit <= 256)).toBe(true);
    // Completion must not pin decoded pages indefinitely. The oldest raw and
    // narrowed window were both evicted while the active result was assembled.
    const before = f.requests.length;
    await settled(() => f.controller.windows.page(f.controller.plan(where), 0n, 256n));
    expect(f.requests).toHaveLength(before + 1);
});

test("Roster visibility reads more than 32 pages and replaces its keys when the query changes", async () => {
    const f = fixture(12_800);
    const visible = (start: number, count: number): Parameters<typeof useRosterVisibility>[0] => ({
        people: [], visiblePeople: none, recordSlice: none,
        visibleSource: some(variant("pinned", {
            id: `jobs:${start}:${count}`, revision: f.handle.revision, refresh: f.handle.refresh, seek: none,
            total: () => some(BigInt(count)),
            page: (offset: bigint, limit: bigint) => {
                const rows = f.controller.windows.page(f.controller.plan(new Map()), BigInt(start) + offset, limit);
                return rows.type === "none" ? none : some(rows.value.map(row => row.key as string));
            },
        })),
    });
    const hook = renderHook(({ value }) => useRosterVisibility(value), { initialProps: { value: visible(0, 12_800) } });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.keys.type === "some" && [...hook.result.current.keys.value]).toEqual(f.ids);
    expect(f.requests).toHaveLength(50);
    hook.rerender({ value: visible(12_000, 64) });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.keys.type === "some" && [...hook.result.current.keys.value]).toEqual(f.ids.slice(12_000, 12_064));
});

test("one bounded window resumes across more short provider pages than the raw cache can hold", async () => {
    const f = fixture(40, true);
    const plan = f.controller.plan(new Map());
    const result = await settled(() => f.controller.windows.page(plan, 0n, 40n));
    expect(result.map(entry => entry.key)).toEqual(f.ids);
    expect(f.requests).toHaveLength(40);
    await settled(() => f.handle.page(0n, 1n));
    expect(f.requests).toHaveLength(41);
});

test("40 drafts survive paging, filters and remounts; Save confirms all original keys after eviction", async () => {
    const f = fixture(80);
    const Batch = Editing.Types.ChangeSet(Row, StringType);
    const decodeBatch = decodeBeast2For(Batch);
    const apply = East.compile(applyEditing(Records), []);
    const submitted: string[][] = [];
    const editing: EditingValue = {
        sourceId: "jobs", entryType: toEastTypeValue(Row), draftType: toEastTypeValue(Editing.Types.Draft(Row)),
        idField: none, children: none, keyType: some(toEastTypeValue(StringType)), snapshot: none, onPatch: none, mode: variant("batch", null),
        readEntry: id => { const current = f.controller.readEntry(id); return current.type === "some" ? current.value : none; },
        onApply: some(variant("sync", bytes => {
            const batch = decodeBatch(bytes); submitted.push(batch.changes.map(change => change.id));
            const result = apply(f.rows(), batch, some("a".repeat(64)));
            if (result.type === "conflict") return variant("conflict", result.value);
            return variant("applied", { revision: some(f.commit(result.value)) });
        })),
    };
    type Bar = { id: string };
    const source: EditSource<Bar> = { revision: f.handle.revision, refresh: f.handle.refresh, seek: f.handle.seek,
        page: () => { throw new Error("Save must confirm hidden drafts by primary identity"); },
        readCurrent: id => f.controller.readEntry(id),
    };
    const options = { idOf: (bar: Bar) => bar.id, prepare: prepareRecordSliceSave(f.slice, f.handle.revision) };
    await settled(() => f.handle.revision());
    const mount = () => renderHook(({ rows, positions }: { rows: Bar[]; positions: number[] }) =>
        useEditSession(editing, source, rows, positions, "retained-drafts", options), { initialProps: { rows: [] as Bar[], positions: [] as number[] } });
    let hook = mount();
    const session = hook.result.current.session;
    for (let i = 0; i < 40; i++) {
        const id = f.ids[i]!;
        await act(async () => { await settled(() => f.controller.readEntry(id)); });
        hook.rerender({ rows: [{ id }], positions: [i] });
        act(() => {
            const before = hook.result.current.original(id);
            session.record([{ id, before, after: { ...before, draft: { status: variant("value", "Done"), quantity: variant("value", 2n) } } }], "typed", "Edit job");
        });
    }
    act(() => { f.choose("Done"); });
    hook.rerender({ rows: [], positions: [] });
    for (let i = 40; i < 80; i++) await act(async () => { await settled(() => f.handle.page(BigInt(i), 1n)); });
    expect(session.pending).toBe(40);
    expect([...hook.result.current.drafts.keys()]).toEqual(f.ids.slice(0, 40));
    act(() => session.undo()); expect(session.pending).toBe(39);
    act(() => session.redo()); expect(session.pending).toBe(40);
    hook.unmount(); hook = mount();
    expect(hook.result.current.session).toBe(session);
    expect(session.pending).toBe(40);
    act(() => { f.choose("Ready"); });
    const notice = render(<RecordSliceSaveNotice slice={f.slice} />);
    await act(async () => { await session.apply(); });
    await waitFor(() => expect(session.status).toBe("idle"));
    await waitFor(() => expect(notice.container.textContent).toBe("40 rows left this view"));
    expect(submitted).toEqual([f.ids.slice(0, 40)]);
    expect(session.pending).toBe(0);
    for (const id of f.ids.slice(0, 40)) expect(f.rows().get(id)).toEqual({ status: "Done", quantity: 2n });
    expect(f.rows().get(f.ids[40]!)).toEqual({ status: "Ready", quantity: 1n });
    expect(f.requests.every(request => request.limit === 1)).toBe(true);
});
