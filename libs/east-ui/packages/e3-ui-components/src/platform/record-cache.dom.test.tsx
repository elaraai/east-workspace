/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A record Slice's bounded caches on e3 itself (#1375): the work orders, grown to thousands through their patch door,
 * bound with their dispatch queue (`Data.bindPaged(workOrders, { indexes: ["by_status"] })`) and narrowed by status —
 * the record Slice, the paging runtime and the editing session reading, paging and saving through e3, a page at a time.
 * What a test counts it reads from the request log.
 */

import { expect, test } from "vitest";
import { render, renderHook, waitFor } from "@testing-library/react";
import {
    East, Expr, FunctionType, IntegerType, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor,
    none, printFor, some, toEastTypeValue, variant,
    type EastType, type option, type StructType, type ValueTypeOf, type VariantType,
} from "@elaraai/east";
import { Editing, RecordSliceBindType, RecordSliceReadType, RecordSliceWhereType, bindRecord, recordSliceReadPlatform } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations, useEditSession, useTrackedEvaluation, type EditingValue } from "@elaraai/east-ui-components";
import { RecordSliceImpl } from "@elaraai/east-ui-components/platform";
import { createTrackedRead, prepareRecordSliceSave, RecordSliceSaveNotice, type EditSource } from "@elaraai/east-ui-components/internal";
import { Data, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, e3Harness } from "../e3-web-mount.test-utils.js";
import { useKeyVisibility, type KeyVisibilityInput } from "../shared/schedule/visibility.js";

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

const Row = ex.WorkOrderRow;
const Orders = ex.workOrders.type;
type Order = ValueTypeOf<typeof Row>;
type Where = ValueTypeOf<RecordSliceWhereType>;
type Read = ValueTypeOf<RecordSliceReadType>;
/** A read of a narrowing alone (#1432): no read by area's clause beside it. */
const readOf = (where: Where): Read => ({ where, area: none });
const compareString = compareFor(StringType);
const printString = printFor(StringType);
const orderEqual = equalFor(Row);
const decodeOrders = decodeBeast2For(Orders);
const encodeOrders = encodeBeast2For(Orders);

/** The work orders bound with their dispatch queue and narrowed by status, as a record Slice binds them; and the Apply that commits a batch of them through their patch door. */
const program = East.function([], undefined, ($) => {
    const orders = $.let(Data.bindPaged(ex.workOrders, { indexes: ["by_status"] }));
    const record = $.let(Record.bind(ex.workOrders, ["patch"]));
    return {
        slice: bindRecord("record-cache.orders", orders, { fields: { status: { label: "Status", hints: ["late", "open", "planned"] } } }),
        apply: Record.onApply(record, { keyed: true }),
    };
});

/** What one narrowed window of the orders holds: the record Slice's entries, by the program's own type. */
const Entries = (((((Expr.type(program) as FunctionType).output as StructType).fields["slice"] as StructType).fields["pageWhere"] as FunctionType).output as VariantType).cases["some"] as EastType;

/** A batch of the orders' drafts, keyed by their ids, as the session hands it. */
const Batch = Editing.Types.ChangeSet(Row, StringType);
const decodeBatch = decodeBeast2For(Batch);

/** The record Slice's handle, the Apply, and the narrowed source: what the program gives. */
type Bound = {
    slice: ValueTypeOf<RecordSliceBindType> & {
        data: { revision: () => option<string>; refresh: (target: option<string>) => null };
        pageWhere: (read: Read, offset: bigint, limit: bigint) => option<{ key: string }[]>;
    };
    apply: (batch: ValueTypeOf<typeof Batch>) => Promise<ValueTypeOf<typeof Editing.Types.ApplyResult>>;
};

/** The order `n` the work orders hold, open unless given, keyed as the record orders them. */
function orderOf(n: number, status = "open"): Order {
    return { site: "North", title: `Order ${n}`, crew: "Mech A", status, due: new Date(Date.UTC(2026, 8, 1) + n * 60_000) };
}
/** The orders' ids, `WO-00000` on: fixed width, so key order is their order. */
const idsOf = (count: number) => Array.from({ length: count }, (_, i) => `WO-${String(i).padStart(5, "0")}`);

/** Whether a request pages the work orders' own rows: neither their index's, nor a search. */
const ownPage = (request: E3Request) => request.kind === "page" && request.dataset === "records.work_orders" && !request.query.has("index");
/** The pages of the work orders' own rows asked so far, each its window. */
const pagesAsked = () => h.requests().filter(ownPage).map((request) => ({ offset: Number(request.query.get("offset")), limit: Number(request.query.get("limit")) }));

/**
 * Another session grows the work orders to `count`, all open, through their patch door; then the runtimes are
 * installed over the test's workspace as a mounted page's providers install them, and the program bound.
 *
 * @param count - How many orders
 * @returns The orders' ids, the record Slice, its Apply, and what the Save notice asks of its membership
 */
async function fixture(count: number) {
    const ids = idsOf(count);
    await h.patch(ex.workOrders, new SortedMap(ids.map((id, i) => [id, orderOf(i)] as const), compareString));
    await h.install({ fn: program });
    const bound = East.compile(program, getRegisteredPlatformImplementations())() as unknown as Bound;
    // What the Save notice asks of each saved order's membership: by its key, or by a row the Save holds.
    const asked = { byKey: [] as string[], byRow: [] as string[] };
    const slice = {
        ...bound.slice,
        contains: (where: Where, id: string) => { asked.byKey.push(id); return bound.slice.contains(where, id); },
        containsRow: (where: Where, id: string, row: Uint8Array) => { asked.byRow.push(id); return bound.slice.containsRow(where, id, row); },
    } as typeof bound.slice;
    return { ids, slice, apply: bound.apply, asked, choose: (status: string) => slice.choose("status", [printString(status)]) };
}

/** Resolve from dependency notifications, with no polling or timing assumptions. */
function settled<T>(read: () => option<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        let queued = false; let done = false;
        const enqueue = () => { if (!queued && !done) { queued = true; queueMicrotask(run); } };
        const tracked = createTrackedRead(enqueue);
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

// The scan reads a read (#1432): a narrowing, and a read by area's clause beside it — none here.
const scan = East.compile(East.function([
    StringType, FunctionType([], OptionType(StringType)), FunctionType([RecordSliceReadType], OptionType(IntegerType)),
    FunctionType([RecordSliceReadType, IntegerType, IntegerType], OptionType(Entries)), RecordSliceReadType,
], OptionType(Entries), (_$, id, revision, total, page, read) => recordSliceReadPlatform([Entries], id, revision, total, page, read)), RecordSliceImpl) as
    (id: string, revision: () => option<string>, total: (read: Read) => option<bigint>, page: (read: Read, offset: bigint, limit: bigint) => option<unknown>, read: Read) => option<{ key: string }[]>;

test("an indexed scan exceeds both page-cache caps, finishes linearly and still evicts old pages", async () => {
    const f = await fixture(12_800);
    const where: Where = new Map();
    const read = () => scan("all", f.slice.data.revision, (r) => f.slice.countWhere(r), (r, offset, limit) => f.slice.pageWhere(r, offset, limit), readOf(where));
    const hook = renderHook(() => useTrackedEvaluation(read));
    await waitFor(() => expect(hook.result.current.result.ok && hook.result.current.result.value.type).toBe("some"), { timeout: 60_000 });
    const result = hook.result.current.result;
    if (!result.ok || result.value.type !== "some") throw new Error("The scan did not complete");
    expect(result.value.value.map((entry) => entry.key)).toEqual(f.ids);
    // A pointer/keyboard gesture reads outside tracking and must reuse the
    // active view, including an event whose original page has been evicted.
    expect(read().type).toBe("some");
    // Fifty pages of 256 in a row, and the one-row page that learned the record's count first.
    const pages = pagesAsked();
    expect(pages.filter((page) => page.limit === 256)).toHaveLength(50);
    expect(pages.filter((page) => page.limit === 1)).toHaveLength(1);
    expect(pages.every((page) => page.limit <= 256)).toBe(true);
    // Completion must not pin decoded pages indefinitely. The oldest raw and
    // narrowed window were both evicted while the active result was assembled.
    const before = pages.length;
    await settled(() => f.slice.pageWhere(readOf(where), 0n, 256n));
    expect(pagesAsked()).toHaveLength(before + 1);
}, 120_000);

test("a source's visibility reads more than 32 pages and replaces its keys when the query changes", async () => {
    const f = await fixture(12_800);
    const visible = (start: number, count: number): KeyVisibilityInput => ({
        rows: [], visible: none, recordSlice: none,
        visibleSource: some(variant("pinned", {
            id: `orders:${start}:${count}`, revision: f.slice.data.revision, refresh: f.slice.data.refresh, seek: none,
            total: () => some(BigInt(count)),
            page: (offset: bigint, limit: bigint) => {
                const rows = f.slice.pageWhere(readOf(new Map()), BigInt(start) + offset, limit);
                return rows.type === "none" ? none : some(rows.value.map((row) => row.key));
            },
        })),
    });
    const words = { changed: "Results changed; retry the narrowing.", failed: "Could not load results" };
    const hook = renderHook(({ value }) => useKeyVisibility(value, words), { initialProps: { value: visible(0, 12_800) } });
    await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 60_000 });
    expect(hook.result.current.keys.type === "some" && [...hook.result.current.keys.value]).toEqual(f.ids);
    // Fifty pages of 256, and the one-row page that learned the record's count.
    expect(pagesAsked().filter((page) => page.limit === 256)).toHaveLength(50);
    hook.rerender({ value: visible(12_000, 64) });
    await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 60_000 });
    expect(hook.result.current.keys.type === "some" && [...hook.result.current.keys.value]).toEqual(f.ids.slice(12_000, 12_064));
}, 120_000);

test("one bounded window resumes across more short provider pages than the raw cache can hold", async () => {
    const f = await fixture(40);
    // e3 cuts a page to its byte budget; these orders' pages arrive cut to one row each, as a server holding a tighter
    // budget cuts them: e3's answer, its first row alone.
    h.e3.fail(ownPage, { alter: (body) => encodeOrders(new SortedMap([...decodeOrders(body)].slice(0, 1), compareString)) as Uint8Array<ArrayBuffer> });
    const result = await settled(() => f.slice.pageWhere(readOf(new Map()), 0n, 40n));
    expect(result.map((entry) => entry.key)).toEqual(f.ids);
    // One page a row, after the one-row page that learned the count: the window went on from each, never again from 0.
    expect(pagesAsked()).toHaveLength(41);
    expect(pagesAsked().slice(1).map((page) => page.offset)).toEqual(f.ids.map((_, i) => i));
    // The first page, long since evicted, is asked again.
    await settled(() => f.slice.pageWhere(readOf(new Map()), 0n, 1n));
    expect(pagesAsked()).toHaveLength(42);
}, 120_000);

test("40 drafts survive paging, filters and remounts; Save confirms all original keys after eviction", async () => {
    const f = await fixture(80);
    const submitted: string[][] = [];
    const editing: EditingValue = {
        sourceId: f.slice.sourceId, entryType: toEastTypeValue(Row), draftType: toEastTypeValue(Editing.Types.Draft(Row)),
        idField: none, children: none, keyType: some(toEastTypeValue(StringType)), snapshot: none, onPatch: none, mode: variant("batch", null),
        readEntry: (id) => { const current = f.slice.readEntry(id); return current.type === "some" ? current.value : none; },
        // Each Save one commit through the orders' patch door, as `Record.onApply` commits a collection's batch.
        onApply: some(variant("async", async (bytes: Uint8Array) => {
            const batch = decodeBatch(bytes);
            submitted.push(batch.changes.map((change) => change.id));
            return f.apply(batch);
        })),
    };
    type Bar = { id: string };
    const source: EditSource<Bar> = { revision: f.slice.data.revision, refresh: f.slice.data.refresh, seek: none,
        page: () => { throw new Error("Save must confirm hidden drafts by primary identity"); },
        readCurrent: (id) => f.slice.readEntry(id),
    };
    const options = { idOf: (bar: Bar) => bar.id, prepare: prepareRecordSliceSave(f.slice, f.slice.data.revision) };
    await settled(() => f.slice.data.revision());
    const mount = () => renderHook(({ rows, positions }: { rows: Bar[]; positions: number[] }) =>
        useEditSession(editing, source, rows, positions, "retained-drafts", options), { initialProps: { rows: [] as Bar[], positions: [] as number[] } });
    let hook = mount();
    const session = hook.result.current.session;
    for (let i = 0; i < 40; i++) {
        const id = f.ids[i]!;
        await act(async () => { await settled(() => f.slice.readEntry(id)); });
        hook.rerender({ rows: [{ id }], positions: [i] });
        act(() => {
            const before = hook.result.current.original(id);
            const draft = before.draft as ValueTypeOf<ReturnType<typeof Editing.Types.Draft<typeof Row>>>;
            session.record([{ id, before, after: { ...before, draft: { ...draft, status: variant("value", "late") } } }], "typed", "Edit order");
        });
    }
    // The drafts' own status narrows them out: the stored orders are open.
    act(() => { f.choose("late"); });
    hook.rerender({ rows: [], positions: [] });
    for (let i = 40; i < 80; i++) await act(async () => { await settled(() => f.slice.pageWhere(readOf(new Map()), BigInt(i), 1n)); });
    expect(session.pending).toBe(40);
    expect([...hook.result.current.drafts.keys()]).toEqual(f.ids.slice(0, 40));
    act(() => session.undo()); expect(session.pending).toBe(39);
    act(() => session.redo()); expect(session.pending).toBe(40);
    hook.unmount(); hook = mount();
    expect(hook.result.current.session).toBe(session);
    expect(session.pending).toBe(40);
    act(() => { f.choose("open"); });
    const notice = render(<RecordSliceSaveNotice slice={f.slice} />);
    await act(async () => { await session.apply(); });
    await waitFor(() => expect(session.status).toBe("idle"), { timeout: 60_000 });
    await waitFor(() => expect(notice.container.textContent).toBe("40 rows left this view"), { timeout: 60_000 });
    // The notice asked every saved order's membership in both its checks — before the Save by the row its draft
    // began from, after it by the row its confirmation read back (a check asks again what was pending) — and read
    // none of them by its key again.
    expect(f.asked.byKey).toEqual([]);
    expect(new Set(f.asked.byRow)).toEqual(new Set(f.ids.slice(0, 40)));
    expect(f.ids.slice(0, 40).every((id) => f.asked.byRow.filter((asked) => asked === id).length >= 2)).toBe(true);
    expect(submitted).toEqual([f.ids.slice(0, 40)]);
    expect(session.pending).toBe(0);
    // The record holds the drafts as saved, and the rest as they were.
    const stored = await h.read(ex.workOrders);
    for (const [i, id] of f.ids.slice(0, 40).entries()) expect(orderEqual(stored.get(id)!, orderOf(i, "late"))).toBe(true);
    expect(orderEqual(stored.get(f.ids[40]!)!, orderOf(40))).toBe(true);
    // No Save read a window to confirm what it wrote: every page of the orders' own rows is one row.
    expect(pagesAsked().every((page) => page.limit === 1)).toBe(true);
}, 120_000);
