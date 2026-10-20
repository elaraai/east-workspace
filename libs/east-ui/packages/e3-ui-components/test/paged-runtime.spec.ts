/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for `PagedRuntime` — the `Data.bindPaged` platform runtime — on e3
 * itself (#1378): its default API pages, searches and looks up the revision
 * of the Data.bind examples' datasets — the rows, the counts, the lines, the
 * jobs a task generates and the work orders' record — and follows them through
 * a dataset cache's status poll, timed by a clock the test drives. What a
 * window holds is what another session wrote first; a move is another
 * session's write, reported by the next poll; a window in flight is one the
 * harness holds on its way to e3, or whose answer it holds on its way back; a
 * refusal is e3's own — a pin to content the dataset no longer holds, a dataset
 * that is no collection, an index the record does not declare, a key that does
 * not parse, an output a reset left with no value — and a failure e3 cannot
 * give is a fault at the harness's fetch. An injected clock drives the retry
 * gate rather than sleeping through it.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    ArrayType,
    DictType,
    IntegerType,
    SortedMap,
    StringType,
    StructType,
    compareFor,
    equalFor,
    none,
    some,
    toEastTypeValue,
    variant,
    type EastTypeValue,
    type ValueTypeOf,
} from "@elaraai/east";
import { PagedSourceType, PinnedSourceType, type SeekQueryType } from "@elaraai/east-ui";
import { datasetGetStatus } from "@elaraai/e3-api-client";
import { indexWindowType, type TreePath } from "@elaraai/e3-types";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import type { E3Request } from "../src/e3-web.test-utils.js";
import {
    PagedRuntime,
    createDefaultPagedApi,
    pagedRevisionKey,
    pagedWindowKey,
    pagedTotalKey,
    pagedSeekKey,
    toFindQuery,
    type PagedApi,
    type PagedSelector,
} from "../src/platform/paged-runtime.js";
import type { FakeClock } from "./fixtures/fake-clock.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "bind/data/data": ex });

const NO_INDEX: PagedSelector = { index: null, join: false };
const keys = compareFor(StringType);

/** The rows: Integers a source pages in stream order. */
const rows = ex.previewRowsInput;
const rowsPath = rows.path;
const RowsType = ArrayType(IntegerType);
const rowsTypeValue = toEastTypeValue(RowsType);
/** The counts: a keyed source, its windows Dicts in key order. */
const counts = ex.previewCountsInput;
const countsPath = counts.path;
const Keyed = DictType(StringType, IntegerType);
const KeyedType = toEastTypeValue(Keyed);
/** The work orders: a record, read through its own keys or its queue index. */
const orders = ex.workOrders;
const ordersPath = orders.path;
const BY_STATUS: PagedSelector = { index: "by_status", join: false };
const QueueWindowType = toEastTypeValue(indexWindowType(StringType, ex.WorkQueueKey, StringType, ex.WorkOrderRow));
/** A fault e3 answers a request with, as its store would fail one. */
const DOWN = { status: 500, type: "internal", message: "the store is down" } as const;

/** Counts keyed `ja`, `ka1`–`ka3`, `kb`: three keys under `ka`, and `kb` one row after them. */
const KEYED_COUNTS = new SortedMap([["ja", 1n], ["ka1", 2n], ["ka2", 3n], ["ka3", 4n], ["kb", 5n]], keys);

/** A runtime whose `now()` is driven by the test. */
class TestPagedRuntime extends PagedRuntime {
    public clockMs = 0;
    protected override now(): number { return this.clockMs; }
}

/** Whether a request pages, or searches, a dataset — its dotted path given. */
const pages = (dataset: string) => (request: E3Request) => request.kind === "page" && request.dataset === dataset;
const finds = (dataset: string) => (request: E3Request) => request.kind === "find" && request.dataset === dataset;
/** Whether a request looks a dataset's revision up. */
const lookups = (dataset: string) => (request: E3Request) => request.kind === "dataset-status" && request.dataset === dataset;

/** The window a page request asked for, as the runtime named it. */
function windowOf(request: E3Request) {
    return {
        offset: Number(request.query.get("offset")), limit: Number(request.query.get("limit")),
        ...(request.query.has("hash") && { hash: request.query.get("hash")! }),
        ...(request.query.has("index") && { index: request.query.get("index")!, join: request.query.get("join") === "true" }),
    };
}
/** The query a find request asked, as the runtime named it. */
function queryOf(request: E3Request) {
    return {
        ...(request.query.has("key") && { key: request.query.get("key")! }),
        ...(request.query.has("prefix") && { prefix: request.query.get("prefix")! }),
        ...(request.query.has("index") && { index: request.query.get("index")! }),
        ...(request.query.has("hash") && { hash: request.query.get("hash")! }),
    };
}
/** The windows of a dataset asked for so far. */
const windows = (dataset = "inputs.preview_rows") => h.requests().filter(pages(dataset)).map(windowOf);
/** The searches of a dataset asked so far. */
const searches = (dataset = "inputs.preview_counts") => h.requests().filter(finds(dataset)).map(queryOf);
/** The lookups of a dataset's revision so far. */
const looked = (dataset = "inputs.preview_rows") => h.requests().filter(lookups(dataset)).length;

/** The content hash e3 holds a dataset under now. */
async function hashOf(dataset: { readonly path: TreePath }): Promise<string> {
    const status = await datasetGetStatus(h.e3.apiUrl, h.e3.repo, h.workspace, dataset.path, h.e3.direct);
    assert.equal(status.hash.type, "some", "the dataset has a value");
    return status.hash.value!;
}

/** The handle's compiled methods — the real call path a UI takes — typed from
 *  the contract East declares for them: a paged source over the rows, and the
 *  `revision` / `refresh` a pinned handle adds. */
type PagedHandle = ValueTypeOf<ReturnType<typeof PagedSourceType<typeof RowsType>>>
    & Partial<Pick<ValueTypeOf<ReturnType<typeof PinnedSourceType<typeof RowsType>>>, "revision" | "refresh">>;
const handleOf = (
    runtime: PagedRuntime, type: EastTypeValue, path: TreePath, shape: "released" | "pinned" = "pinned",
    selector: PagedSelector = NO_INDEX,
): PagedHandle => runtime.buildHandle(type, path, selector, shape) as unknown as PagedHandle;

const callPage = (runtime: PagedRuntime, offset: bigint, limit: bigint) =>
    handleOf(runtime, rowsTypeValue, rowsPath).page(offset, limit);
const callTotal = (runtime: PagedRuntime) => handleOf(runtime, rowsTypeValue, rowsPath).total();
const callRevision = (runtime: PagedRuntime) => handleOf(runtime, rowsTypeValue, rowsPath).revision!();

/** e3's paging API over the harness's fetch, following datasets through a cache's poll timed by the clock it gives. */
function newApi(): { api: PagedApi; clock: FakeClock } {
    const { cache, clock } = h.cache();
    return { api: createDefaultPagedApi(h.e3.apiUrl, h.e3.repo, h.options, cache), clock };
}

/** A runtime over e3's paging API whose rows source has looked its revision up. */
async function known<R extends PagedRuntime>(runtime: R, read: (runtime: R) => unknown = callRevision) {
    const { api, clock } = newApi();
    runtime.initialize(api, h.workspace);
    read(runtime);
    await h.settle();
    return { runtime, api, clock };
}

/** Moves the clock on to the cache's next poll, which reports each followed dataset's hash, and settles. */
async function poll(clock: FakeClock): Promise<void> {
    clock.tickAll();
    await h.settle();
}

describe("PagedRuntime", () => {
    test("a window reads `none` while in flight, then `some` once it lands", async () => {
        await h.write(rows, [10n, 20n, 30n, 40n, 50n]);
        const R1 = await hashOf(rows);
        const { runtime } = await known(new PagedRuntime());

        // First read starts the fetch and reports "not yet".
        const held = h.e3.hold(pages("inputs.preview_rows"));
        assert.equal(callPage(runtime, 0n, 2n).type, "none");
        await held.holding;
        assert.deepEqual(windows(), [{ offset: 0, limit: 2, hash: R1 }], "the window is pinned to the revision");

        // A re-read while in flight must NOT start a second fetch.
        callPage(runtime, 0n, 2n);
        assert.equal(windows().length, 1, "an in-flight window is not refetched");

        held.release();
        await h.settle();
        const landed = callPage(runtime, 0n, 2n);
        assert.ok(landed.type === "some");
        assert.deepEqual(landed.value, [10n, 20n]);
        assert.equal(windows().length, 1, "a landed window is served from the channel");
    });

    test("an EMPTY window is `some([])` — exhausted, not loading", async () => {
        // The contract the canvas readers walk on: `none` means "ask again",
        // `some([])` means "stop". e3 answers a window past the end empty,
        // which must therefore be `some`, never `none`.
        const { runtime } = await known(new PagedRuntime());
        callPage(runtime, 100n, 10n);
        await h.settle();
        const w = callPage(runtime, 100n, 10n);
        assert.ok(w.type === "some");
        assert.equal(w.value.length, 0);
    });

    test("any landed window teaches the source's total, on its own channel", async () => {
        await h.write(rows, Array.from({ length: 37 }, (_, i) => BigInt(i)));
        const { runtime } = await known(new PagedRuntime());
        assert.equal(callTotal(runtime).type, "none");
        callPage(runtime, 0n, 2n);
        await h.settle();
        const total = callTotal(runtime);
        assert.ok(total.type === "some");
        assert.equal(total.value, 37n);
    });

    test("a settling window notifies its own key, and the total's", async () => {
        const R1 = await hashOf(rows);
        const { runtime } = await known(new PagedRuntime());
        let windowHits = 0;
        let totalHits = 0;
        runtime.subscribe(pagedWindowKey(h.workspace, rowsPath, R1, 0, 2), () => { windowHits += 1; });
        runtime.subscribe(pagedTotalKey(h.workspace, rowsPath, R1), () => { totalHits += 1; });

        callPage(runtime, 0n, 2n);
        // The launch itself must stay silent: the read that triggers it runs
        // inside a render pass, and notifying there re-enters the renderer.
        assert.equal(windowHits, 0, "launch must not notify");
        assert.equal(totalHits, 0, "launch must not notify");

        await h.settle();
        assert.equal(windowHits, 1);
        assert.equal(totalHits, 1);
    });

    test("reads register the revision, window and total keys for reactive tracking", async () => {
        const R1 = await hashOf(rows);
        const { runtime } = await known(new PagedRuntime());
        runtime.enableTracking();
        callPage(runtime, 0n, 2n);
        callTotal(runtime);
        const tracked = runtime.disableTracking();
        assert.ok(tracked.includes(pagedRevisionKey(h.workspace, rowsPath)), "revision key tracked, so a move re-fires the read");
        assert.ok(tracked.includes(pagedWindowKey(h.workspace, rowsPath, R1, 0, 2)), "window key tracked");
        assert.ok(tracked.includes(pagedTotalKey(h.workspace, rowsPath, R1)), "total key tracked");
        await h.settle();
    });

    test("a failed window throws its reason, and a read after the gap fetches it again", async () => {
        const { runtime } = await known(new TestPagedRuntime());
        const recover = h.e3.fail(pages("inputs.preview_rows"), DOWN);
        assert.equal(callPage(runtime, 0n, 2n).type, "none");
        await h.settle();

        // A failure is not "in flight": a view must see it, not spin.
        assert.throws(() => callPage(runtime, 0n, 2n), /inputs\.preview_rows: internal: the store is down/);
        runtime.clockMs = 500;
        assert.throws(() => callPage(runtime, 0n, 2n), /internal/, "still failed inside the gap");
        assert.equal(windows().length, 1, "retry suppressed inside the gap");

        // Past the gap: the read fetches again, and is in flight until it lands.
        recover();
        runtime.clockMs = 5000;
        assert.equal(callPage(runtime, 0n, 2n).type, "none");
        assert.equal(windows().length, 2, "retry allowed after the gap");
        await h.settle();
        assert.equal(callPage(runtime, 0n, 2n).type, "some");
    });

    test("a `dataset_not_pageable` failure keeps throwing, never refetched, until the source moves", async () => {
        // The threshold is a Float: e3 pages no such dataset.
        const thresholdPath = ex.thresholdInput.path;
        const type = toEastTypeValue(ArrayType(IntegerType));
        const { runtime, clock } = await known(new TestPagedRuntime(), (r) => handleOf(r, type, thresholdPath).revision!());
        handleOf(runtime, type, thresholdPath).page(0n, 2n);
        await h.settle();

        runtime.clockMs = 60_000;
        assert.throws(() => handleOf(runtime, type, thresholdPath).page(0n, 2n), /dataset_not_pageable/);
        assert.equal(windows("inputs.threshold").length, 1, "no retry can help while the content is the same");

        await h.write(ex.thresholdInput, 75);
        await poll(clock);
        assert.equal(handleOf(runtime, type, thresholdPath).page(0n, 2n).type, "none", "another snapshot is asked afresh");
        assert.equal(windows("inputs.threshold").length, 2);
    });

    test("an `index_not_found` failure keeps throwing, never refetched, until the source moves", async () => {
        const missing: PagedSelector = { index: "no_such_index", join: false };
        const read = (r: PagedRuntime) => handleOf(r, QueueWindowType, ordersPath, "pinned", missing);
        const { runtime, clock } = await known(new TestPagedRuntime(), (r) => read(r).revision!());
        read(runtime).page(0n, 2n);
        await h.settle();

        runtime.clockMs = 60_000;
        assert.throws(() => read(runtime).page(0n, 2n), /index_not_found/);
        assert.equal(windows("records.work_orders").length, 1, "no retry can help while the content is the same");

        const held = await h.read(orders);
        await h.patch(orders, new SortedMap([...held].map(([id, order]) => [id, id === "WO-1001" ? { ...order, crew: "Mech B" } : order] as const), keys));
        await poll(clock);
        assert.equal(read(runtime).page(0n, 2n).type, "none", "another snapshot is asked afresh");
        assert.equal(windows("records.work_orders").length, 2);
    });

    test("a `dataset_not_indexed` failure — a collection an older e3 stored as one blob — keeps throwing, never refetched, until the source moves", async () => {
        // This e3 stores every collection as segments, so its refusal of one blob is a fault at the harness's fetch.
        const { runtime, clock } = await known(new TestPagedRuntime());
        const stop = h.e3.fail(pages("inputs.preview_rows"), { status: 400, type: "dataset_not_indexed", message: "the collection is stored as one blob" });
        callPage(runtime, 0n, 2n);
        await h.settle();

        runtime.clockMs = 60_000;
        assert.throws(() => callPage(runtime, 0n, 2n), /dataset_not_indexed/);
        assert.equal(windows().length, 1, "no retry can help while the content is the same");

        stop();
        await h.write(rows, [7n]);
        await poll(clock);
        assert.equal(callPage(runtime, 0n, 2n).type, "none", "another snapshot is asked afresh");
        assert.equal(windows().length, 2);
    });

    test("a window that does not decode as the source's type keeps throwing", async () => {
        const { runtime } = await known(new TestPagedRuntime());
        // The rows are Integers, bound here as rows of another type.
        const handle = handleOf(runtime, toEastTypeValue(ArrayType(StructType({ n: IntegerType }))), rowsPath);
        handle.page(0n, 2n);
        await h.settle();

        runtime.clockMs = 60_000;
        assert.throws(() => handle.page(0n, 2n), /does not decode as the source's type/);
        assert.equal(windows().length, 1, "never refetched");
    });

    test("windows are per (offset, limit) — different windows are different channels", async () => {
        await h.write(rows, [10n, 20n, 30n, 40n]);
        const R1 = await hashOf(rows);
        const { runtime } = await known(new PagedRuntime());

        callPage(runtime, 0n, 2n);
        callPage(runtime, 2n, 2n);
        assert.equal(windows().length, 2);
        assert.deepEqual(windows()[1], { offset: 2, limit: 2, hash: R1 });
        await h.settle();

        const w0 = callPage(runtime, 0n, 2n);
        const w1 = callPage(runtime, 2n, 2n);
        assert.ok(w0.type === "some" && w1.type === "some");
        assert.deepEqual(w0.value, [10n, 20n]);
        assert.deepEqual(w1.value, [30n, 40n]);
    });

    test("the compiled-handle cache keys on TYPE and shape as well as path", () => {
        // The window decoder is baked from the source type, so a path re-bound
        // at a different type (a redeployed dataset) must not be handed the
        // handle compiled against the old one.
        const runtime = new PagedRuntime();
        runtime.initialize(newApi().api, h.workspace);

        const a = handleOf(runtime, rowsTypeValue, rowsPath);
        assert.equal(a, handleOf(runtime, rowsTypeValue, rowsPath), "same (type, path, shape) is cached");

        const otherType = toEastTypeValue(ArrayType(StructType({ id: StringType, n: IntegerType })));
        assert.notEqual(a, handleOf(runtime, otherType, rowsPath), "a different source type must not reuse the handle");

        const released = handleOf(runtime, rowsTypeValue, rowsPath, "released");
        assert.notEqual(a, released, "the released shape is its own handle");
        assert.equal(released.id, a.id, "both shapes carry the source's identity");
        assert.equal("revision" in released, false, "the released handle has no revision");
        assert.equal("refresh" in released, false, "the released handle has no refresh");
    });

    test("no paging service is a named, ACTIONABLE error — not a silent none", () => {
        // With the offline stand-in deleted (#573) this IS the offline path: a
        // paged bind rendered outside a workspace must say so and say what to
        // do, rather than hand back `none` and spin behind an empty canvas.
        const runtime = new PagedRuntime();
        const call = (): unknown => callPage(runtime, 0n, 2n);
        assert.throws(call, /no paging service/, "names the missing capability");
        assert.throws(call, /live workspace/, "names where it does resolve");
        assert.throws(call, /Data\.bind/, "names the whole-value alternative");
    });

    test("clear() drops the api, the workspace, every window and every watch", async () => {
        const { runtime, clock } = await known(new PagedRuntime());
        callPage(runtime, 0n, 2n);
        await h.settle();
        assert.equal(callPage(runtime, 0n, 2n).type, "some");
        assert.equal(clock.intervals.length, 1, "the dataset is followed: its cache polls");

        runtime.clear();
        assert.equal(clock.intervals.length, 0, "the dataset is no longer followed");
        assert.throws(() => callPage(runtime, 0n, 2n), /no paging service/);
    });

    test("clear(api) leaves an adapter another provider installed in place", async () => {
        const R1 = await hashOf(rows);
        const first = newApi();
        const second = newApi();
        const runtime = new PagedRuntime();
        runtime.initialize(first.api, h.workspace);
        runtime.initialize(second.api, h.workspace);

        runtime.clear(first.api);
        callRevision(runtime);
        await h.settle();
        assert.equal(callRevision(runtime).value, R1, "the second adapter still serves");
        assert.equal(looked(), 1);

        runtime.clear(second.api);
        assert.throws(() => callPage(runtime, 0n, 2n), /no paging service/);
    });
});

/** A keyed source's handle, typed from the contract East declares. */
type KeyedHandle = ValueTypeOf<ReturnType<typeof PagedSourceType<typeof Keyed>>>;

describe("PagedRuntime — a window a landed one covers (#1217)", () => {
    test("is answered from it — the same rows at the same revision, nothing fetched, one identity", async () => {
        await h.write(rows, Array.from({ length: 10 }, (_, i) => BigInt(i * 10)));
        const { runtime } = await known(new PagedRuntime());
        callPage(runtime, 0n, 4n);
        await h.settle();

        // A sheet's read of one entry it is about to draft, beside the window it draws.
        const cut = callPage(runtime, 1n, 2n);
        assert.ok(cut.type === "some");
        assert.equal(equalFor(RowsType)(cut.value, [10n, 20n]), true);
        assert.equal(windows().length, 1, "no fetch of its own");
        const again = callPage(runtime, 1n, 2n);
        assert.ok(again.type === "some");
        assert.equal(again.value, cut.value, "the answer is kept in its own channel");
        assert.deepEqual(callTotal(runtime), some(10n));
    });

    test("over a keyed source, a Dict's entries in key order", async () => {
        await h.write(counts, new SortedMap([["a", 1n], ["b", 2n], ["c", 3n], ["d", 4n]], keys));
        const keyed = (r: PagedRuntime) => r.buildHandle(KeyedType, countsPath, NO_INDEX, "pinned") as unknown as KeyedHandle & { revision: () => unknown };
        const { runtime } = await known(new PagedRuntime(), (r) => keyed(r).revision());
        keyed(runtime).page(0n, 4n);
        await h.settle();

        const cut = keyed(runtime).page(2n, 1n);
        assert.ok(cut.type === "some");
        assert.equal(equalFor(Keyed)(cut.value, new SortedMap([["c", 3n]], keys)), true);
        assert.equal(windows("inputs.preview_counts").length, 1);
    });

    test("a window covers what it holds — one e3 trimmed to its page budget covers only its own count", async () => {
        // Lines of incompressible text, each over a third of e3's 4 MiB page budget: a window of four is trimmed to two.
        const lines = ex.previewLinesInput;
        await h.write(lines, Array.from({ length: 6 }, (_, i) => noise(1_600_000, i + 1)));
        const LinesType = toEastTypeValue(ArrayType(StringType));
        const read = (r: PagedRuntime) => handleOf(r, LinesType, lines.path);
        const R1 = await hashOf(lines);
        const { runtime } = await known(new PagedRuntime(), (r) => read(r).revision!());
        read(runtime).page(0n, 4n);
        await h.settle();
        const landed = read(runtime).page(0n, 4n);
        assert.ok(landed.type === "some");
        assert.equal(landed.value.length, 2, "asked for four, trimmed to two");

        assert.equal(read(runtime).page(1n, 1n).type, "some", "inside what it holds");
        assert.equal(windows("inputs.preview_lines").length, 1);
        assert.equal(read(runtime).page(1n, 2n).type, "none", "past what it holds: fetched");
        assert.deepEqual(windows("inputs.preview_lines")[1], { offset: 1, limit: 2, hash: R1 });
        await h.settle();
    });

    test("a window of another index, or of another snapshot, answers nothing", async () => {
        const OrdersType = toEastTypeValue(orders.type);
        const primary = (r: PagedRuntime) => handleOf(r, OrdersType, ordersPath);
        const R1 = await hashOf(orders);
        const { runtime, clock } = await known(new PagedRuntime(), (r) => primary(r).revision!());
        primary(runtime).page(0n, 4n);
        await h.settle();

        const byStatus = handleOf(runtime, QueueWindowType, ordersPath, "pinned", BY_STATUS);
        assert.equal(byStatus.page(1n, 2n).type, "none", "an index's rows are another row space");
        assert.deepEqual(windows("records.work_orders")[1], { offset: 1, limit: 2, hash: R1, index: "by_status", join: false });
        await h.settle();

        assert.equal(primary(runtime).page(1n, 2n).type, "some");
        const held = await h.read(orders);
        await h.patch(orders, new SortedMap([...held].map(([id, order]) => [id, id === "WO-1002" ? { ...order, crew: "Elec" } : order] as const), keys));
        const R2 = await hashOf(orders);
        await poll(clock);
        assert.equal(primary(runtime).page(1n, 2n).type, "none", "a move drops the window and its cut");
        assert.deepEqual(windows("records.work_orders").at(-1), { offset: 1, limit: 2, hash: R2 });
        await h.settle();
    });
});

describe("PagedRuntime — snapshots", () => {
    test("revision reads `none` until found, then the dataset's hash, and every read carries it", async () => {
        const R1 = await hashOf(rows);
        const runtime = new PagedRuntime();
        runtime.initialize(newApi().api, h.workspace);

        const held = h.e3.hold(lookups("inputs.preview_rows"));
        assert.equal(callRevision(runtime).type, "none", "being found");
        assert.equal(callPage(runtime, 0n, 2n).type, "none");
        await held.holding;
        assert.equal(windows().length, 0, "nothing is fetched before the revision is known");
        assert.equal(looked(), 1, "one lookup serves every read of the dataset");
        held.release();
        await h.settle();

        assert.deepEqual(callRevision(runtime), some(R1));
        callPage(runtime, 0n, 2n);
        assert.equal(windows()[0]!.hash, R1);
        await h.settle();
    });

    test("every bind of one dataset shares its snapshot, an index read included", async () => {
        const R1 = await hashOf(orders);
        const byStatus = (r: PagedRuntime) => handleOf(r, QueueWindowType, ordersPath, "pinned", BY_STATUS);
        const { runtime, clock } = await known(new PagedRuntime(), (r) => handleOf(r, toEastTypeValue(orders.type), ordersPath).revision!());

        assert.deepEqual(byStatus(runtime).revision!(), some(R1), "an index read is pinned to the record's state hash");
        byStatus(runtime).page(0n, 2n);
        assert.deepEqual(windows("records.work_orders")[0], { offset: 0, limit: 2, hash: R1, index: "by_status", join: false });
        assert.equal(looked("records.work_orders"), 1, "no second lookup");
        await poll(clock);
        assert.deepEqual(h.requests("status").at(-1)?.query.getAll("path"), [".records.work_orders"], "one watch follows the dataset");
    });

    test("a refused pin moves the source to the content e3 names", async () => {
        const { runtime } = await known(new PagedRuntime());
        let moves = 0;
        runtime.subscribe(pagedRevisionKey(h.workspace, rowsPath), () => { moves += 1; });

        // The window is held on its way to e3 while another session writes: e3 refuses its pin.
        const held = h.e3.hold(pages("inputs.preview_rows"));
        callPage(runtime, 0n, 2n);
        await held.holding;
        await h.write(rows, [8n, 9n]);
        const R2 = await hashOf(rows);
        held.release();
        await h.settle();

        assert.equal(moves, 1, "every read of the dataset re-fires");
        assert.deepEqual(callRevision(runtime), some(R2));
        assert.equal(looked(), 1, "e3's refusal named the content: nothing is looked up");
        assert.equal(callPage(runtime, 0n, 2n).type, "none", "a 409 is a move, not a failure");
        assert.equal(windows()[1]!.hash, R2, "the window is fetched again, pinned to the new content");
        await h.settle();
    });

    test("a refusal that names no content looks the revision up", async () => {
        const { runtime } = await known(new PagedRuntime());
        // Another session writes, so e3 refuses the window's pin; its refusal arrives without the header naming the
        // content, as through a proxy that drops it.
        const stop = h.e3.fail(pages("inputs.preview_rows"), "untagged");
        await h.write(rows, [8n, 9n]);
        const R2 = await hashOf(rows);
        callPage(runtime, 0n, 2n);
        await h.settle();
        stop();

        assert.equal(looked(), 2);
        assert.deepEqual(callRevision(runtime), some(R2));
    });

    test("the source follows its dataset: a new hash moves it, the same hash changes nothing", async () => {
        await h.write(rows, [1n]);
        const { runtime, clock } = await known(new PagedRuntime());
        callPage(runtime, 0n, 2n);
        await h.settle();
        let moves = 0;
        runtime.subscribe(pagedRevisionKey(h.workspace, rowsPath), () => { moves += 1; });

        await poll(clock);
        assert.equal(moves, 0, "a report of the content it holds changes nothing");
        assert.equal(callPage(runtime, 0n, 2n).type, "some");

        await h.write(rows, [2n]);
        const R2 = await hashOf(rows);
        await poll(clock);
        assert.equal(moves, 1);
        assert.equal(callTotal(runtime).type, "none", "the old snapshot's total is gone");
        assert.equal(callPage(runtime, 0n, 2n).type, "none", "the old snapshot's window is never served");
        assert.equal(windows()[1]!.hash, R2);
        await h.settle();
        const fresh = callPage(runtime, 0n, 2n);
        assert.ok(fresh.type === "some");
        assert.deepEqual(fresh.value, [2n]);
    });

    test("a window in flight when the source moves never lands in the new snapshot", async () => {
        await h.write(rows, [1n]);
        const { runtime, clock } = await known(new PagedRuntime());
        // e3 answers each window, and its answer is held on its way back.
        const answers = h.e3.holdAnswers(pages("inputs.preview_rows"));
        callPage(runtime, 0n, 2n);             // pinned to R1, answered, held
        await answers.holding;

        await h.write(rows, [2n]);
        await poll(clock);
        callPage(runtime, 0n, 2n);             // pinned to R2, in flight
        answers.releaseOne();                  // R1's answer arrives late
        await h.settle();
        assert.equal(callPage(runtime, 0n, 2n).type, "none", "R1's answer is dropped");
        assert.equal(callTotal(runtime).type, "none", "R1's total is dropped");

        answers.release();
        await h.settle();
        const fresh = callPage(runtime, 0n, 2n);
        assert.ok(fresh.type === "some");
        assert.deepEqual(fresh.value, [2n]);
    });

    test("refresh(some(h)) moves to h, and refresh(none) moves to what the dataset holds", async () => {
        const R1 = await hashOf(rows);
        const { runtime } = await known(new PagedRuntime());
        const handle = handleOf(runtime, rowsTypeValue, rowsPath);

        // Another session writes; the source hears of it from the write it confirmed.
        await h.write(rows, [2n]);
        const R2 = await hashOf(rows);
        assert.equal(handle.refresh!(some(R2)), null, "returns at once");
        assert.deepEqual(handle.revision!(), some(R1), "the move is deferred out of the caller's render");
        await h.settle();
        assert.deepEqual(handle.revision!(), some(R2));

        await h.write(rows, [3n]);
        const R3 = await hashOf(rows);
        handle.refresh!(none);
        await h.settle();
        assert.equal(looked(), 2);
        assert.deepEqual(handle.revision!(), some(R3));
    });

    test("a dataset with no value reads `none` and fetches nothing until a value lands", async () => {
        // The workspace as a deploy leaves it: the jobs a task generates have no value until the dataflow runs.
        await h.unrun();
        const jobs = ex.jobsTask.output;
        const JobsType = toEastTypeValue(jobs.type);
        const read = (r: PagedRuntime) => handleOf(r, JobsType, jobs.path);
        const { runtime, clock } = await known(new PagedRuntime(), (r) => read(r).revision!());

        assert.equal(read(runtime).revision!().type, "none");
        assert.equal(read(runtime).page(0n, 2n).type, "none");
        assert.equal(read(runtime).total().type, "none");
        assert.equal(windows("tasks.jobs.output").length, 0);

        await h.run();
        const R1 = await hashOf(jobs);
        await poll(clock);
        assert.deepEqual(read(runtime).revision!(), some(R1));
        read(runtime).page(0n, 2n);
        assert.equal(windows("tasks.jobs.output")[0]!.hash, R1);
        await h.settle();
    });

    test("a pinned read answered `dataset_unassigned` moves the source to no snapshot", async () => {
        const jobs = ex.jobsTask.output;
        const JobsType = toEastTypeValue(jobs.type);
        const read = (r: PagedRuntime) => handleOf(r, JobsType, jobs.path);
        const { runtime } = await known(new PagedRuntime(), (r) => read(r).revision!());
        // The window is held on its way to e3 while the workspace is reset: the jobs have no value when it arrives.
        const held = h.e3.hold(pages("tasks.jobs.output"));
        read(runtime).page(0n, 2n);
        await held.holding;
        await h.unrun();
        held.release();
        await h.settle();

        assert.equal(read(runtime).revision!().type, "none");
        assert.equal(read(runtime).page(0n, 2n).type, "none", "no value is `none`, not a failure");
        assert.equal(windows("tasks.jobs.output").length, 1);
        assert.equal(looked("tasks.jobs.output"), 1, "e3's refusal said the output has no value: nothing is looked up");
    });

    test("a failed lookup throws its reason until a read after the gap looks again", async () => {
        const R1 = await hashOf(rows);
        // The store is down: the lookup fails, and so does the cache's status poll, which would report the hash at once.
        const recover = h.e3.fail((request) => lookups("inputs.preview_rows")(request) || request.kind === "status", DOWN);
        const runtime = new TestPagedRuntime();
        runtime.initialize(newApi().api, h.workspace);

        assert.equal(callPage(runtime, 0n, 2n).type, "none");
        await h.settle();
        assert.throws(() => callPage(runtime, 0n, 2n), /internal: the store is down/);
        assert.throws(() => callRevision(runtime), /internal/);
        assert.equal(looked(), 1);

        recover();
        runtime.clockMs = 5000;
        assert.equal(callPage(runtime, 0n, 2n).type, "none");
        await h.settle();
        assert.equal(looked(), 2);
        assert.deepEqual(callRevision(runtime), some(R1));
    });

    test("a dataset its readers have all let go is no longer followed — and a read follows it again", async () => {
        const { runtime, clock } = await known(new PagedRuntime());
        /** One reader's run, as a view's: read under tracking, then subscribe
         *  to what the read tracked. Returns what lets it all go. */
        const read = (): (() => void) => {
            runtime.enableTracking();
            callPage(runtime, 0n, 2n);
            const unsubs = runtime.disableTracking().map((key) => runtime.subscribe(key, () => {}));
            return () => { for (const unsub of unsubs) unsub(); };
        };
        let reader = read();
        await h.settle();
        assert.equal(clock.intervals.length, 1, "the dataset is followed");

        // A reader running again lets every key go before it subscribes again.
        reader();
        reader = read();
        await h.settle();
        assert.equal(clock.intervals.length, 1, "a reader re-subscribing keeps the dataset followed");

        // The last reader goes: once that is done, nothing follows the dataset.
        reader();
        assert.equal(clock.intervals.length, 1, "not inside the task that let it go");
        await h.settle();
        assert.equal(clock.intervals.length, 0, "nothing reads it: nothing follows it");

        // Another session writes meanwhile. A read follows it again, and serves what its snapshot delivered.
        await h.write(rows, [5n]);
        const R2 = await hashOf(rows);
        reader = read();
        assert.equal(clock.intervals.length, 1);
        assert.equal(callPage(runtime, 0n, 2n).type, "some", "the landed window stayed");
        assert.equal(windows().length, 1, "nothing fetched again");
        // The dataset moved meanwhile: it moves at the first report.
        await h.settle();
        assert.equal(callPage(runtime, 0n, 2n).type, "none");
        assert.equal(windows()[1]!.hash, R2);
        reader();
        await h.settle();
    });

    test("a released handle is pinned, follows and fails like a pinned one", async () => {
        const R1 = await hashOf(rows);
        const { api, clock } = newApi();
        const runtime = new TestPagedRuntime();
        runtime.initialize(api, h.workspace);
        const released = handleOf(runtime, rowsTypeValue, rowsPath, "released");

        assert.equal(released.page(0n, 2n).type, "none");
        await h.settle();
        const stop = h.e3.fail(pages("inputs.preview_rows"), DOWN);
        released.page(0n, 2n);
        assert.equal(windows()[0]!.hash, R1, "pinned");
        await h.settle();
        assert.throws(() => released.page(0n, 2n), /internal/, "fails visibly");

        stop();
        await h.write(rows, [6n]);
        const R2 = await hashOf(rows);
        await poll(clock);
        assert.equal(released.page(0n, 2n).type, "none", "follows: the failure belonged to the old snapshot");
        assert.equal(windows()[1]!.hash, R2);
        await h.settle();
    });
});

describe("PagedRuntime — key search (#574)", () => {
    const seekOf = (runtime: PagedRuntime, type: EastTypeValue, path: TreePath = countsPath, selector: PagedSelector = NO_INDEX) => {
        const seek = handleOf(runtime, type, path, "pinned", selector).seek;
        assert.ok(seek.type === "some", "the source must declare the capability");
        return seek.value;
    };
    const callSeek = (runtime: PagedRuntime, query: ValueTypeOf<SeekQueryType>) => seekOf(runtime, KeyedType)(query);
    /** A runtime whose counts source, keyed `ja`, `ka1`–`ka3` and `kb`, has looked its revision up. */
    const keyed = async <R extends PagedRuntime>(runtime: R) => {
        await h.write(counts, KEYED_COUNTS);
        const R1 = await hashOf(counts);
        return { R1, ...await known(runtime, (r) => handleOf(r, KeyedType, countsPath).revision!()) };
    };

    test("the capability follows the DATASET's type — keyed seeks, an Array cannot", () => {
        // `datasetFindKey` binary-searches a stored collection's segment fences
        // with the key comparator; an Array has no key order to search, so the
        // handle must not advertise an affordance that can never answer.
        const runtime = new PagedRuntime();
        runtime.initialize(newApi().api, h.workspace);
        assert.equal(handleOf(runtime, KeyedType, countsPath).seek.type, "some");
        assert.equal(handleOf(runtime, rowsTypeValue, rowsPath).seek.type, "none");
    });

    test("a query reads `none` while the fences are walked, then `some(range)`", async () => {
        const { R1, runtime } = await keyed(new PagedRuntime());
        const held = h.e3.hold(finds("inputs.preview_counts"));
        const first = callSeek(runtime, variant("prefix", "ka"));
        assert.equal(first.type, "none", "in flight is `none`, never a wrong answer");
        await held.holding;
        assert.deepEqual(searches(), [{ prefix: "ka", hash: R1 }], "the search is pinned to the revision");

        // A re-read while in flight must not start a second search.
        callSeek(runtime, variant("prefix", "ka"));
        assert.equal(searches().length, 1, "an in-flight query is not re-asked");

        held.release();
        await h.settle();
        const landed = callSeek(runtime, variant("prefix", "ka"));
        assert.ok(landed.type === "some");
        assert.equal(landed.value.found, true);
        // Integers cross the boundary as bigint — the row plugs straight into a
        // window offset, which is the whole point of the shared row space.
        assert.equal(landed.value.row, 1n);
        assert.equal(landed.value.count, 3n);
        assert.equal(searches().length, 1, "an answered query is served from its channel");
    });

    test("every distinct query gets its OWN channel", async () => {
        const { R1, runtime } = await keyed(new PagedRuntime());
        callSeek(runtime, variant("prefix", "ka"));
        callSeek(runtime, variant("prefix", "kc"));
        assert.equal(searches().length, 2, "a different query is a different search");
        assert.notEqual(
            pagedSeekKey(h.workspace, countsPath, R1, { prefix: "ka" }),
            pagedSeekKey(h.workspace, countsPath, R1, { prefix: "kc" }),
        );
        // ... and a miss is an ANSWER, not an absence: it carries the insertion
        // row so a viewport can still position.
        await h.settle();
        const miss = callSeek(runtime, variant("prefix", "kc"));
        assert.ok(miss.type === "some");
        assert.equal(miss.value.found, false);
        assert.equal(miss.value.row, 5n);
    });

    test("a search answer belongs to its snapshot — a move asks again", async () => {
        const { runtime, clock } = await keyed(new PagedRuntime());
        callSeek(runtime, variant("prefix", "ka"));
        await h.settle();

        await h.write(counts, new SortedMap([...KEYED_COUNTS, ["kz", 6n]], keys));
        const R2 = await hashOf(counts);
        await poll(clock);
        assert.equal(callSeek(runtime, variant("prefix", "ka")).type, "none");
        assert.deepEqual(searches().at(-1), { prefix: "ka", hash: R2 });
        await h.settle();
    });

    test("the East query re-tags to e3's wire query — all three shapes", () => {
        // Deliberately the same three shapes, so this is a re-tagging rather
        // than a translation. The `fields` arm's East option becomes an ABSENT
        // property, which is what `exactOptionalPropertyTypes` requires.
        assert.deepEqual(toFindQuery(variant("key", '"press"')), { key: '"press"' });
        assert.deepEqual(toFindQuery(variant("prefix", "pre")), { prefix: "pre" });
        assert.deepEqual(
            toFindQuery(variant("fields", { values: ['"press"', "2"], prefix: none })),
            { fields: ['"press"', "2"] },
        );
        assert.deepEqual(
            toFindQuery(variant("fields", { values: ['"press"'], prefix: some("L") })),
            { fields: ['"press"'], prefix: "L" },
        );
    });

    test("a range re-tags with its open end omitted; open at both ends it is refused, never sent", async () => {
        assert.deepEqual(toFindQuery(variant("range", { from: ['"late"', "2"], to: ['"ok"'] })),
            { from: ['"late"', "2"], to: ['"ok"'] });
        assert.deepEqual(toFindQuery(variant("range", { from: ['"late"'], to: [] })), { from: ['"late"'] });
        assert.deepEqual(toFindQuery(variant("range", { from: [], to: ['"ok"'] })), { to: ['"ok"'] });

        // No end names no run. e3 refuses it, so the seek refuses it where it
        // was written, and nothing is fetched.
        const { runtime } = await keyed(new PagedRuntime());
        assert.throws(() => callSeek(runtime, variant("range", { from: [], to: [] })), /names no end/);
        assert.equal(searches().length, 0);
    });

    test("a failed search throws its reason and retries after the gap, exactly like a window", async () => {
        // The search chrome polls while the user types; a failing server must
        // not be hammered once per keystroke-frame.
        const { runtime } = await keyed(new TestPagedRuntime());
        const recover = h.e3.fail(finds("inputs.preview_counts"), DOWN);
        callSeek(runtime, variant("prefix", "ka"));
        await h.settle();
        assert.throws(() => callSeek(runtime, variant("prefix", "ka")), /internal/);

        runtime.clockMs = 500;
        assert.throws(() => callSeek(runtime, variant("prefix", "ka")), /internal/);
        assert.equal(searches().length, 1, "retry suppressed inside the gap");

        recover();
        runtime.clockMs = 5000;
        assert.equal(callSeek(runtime, variant("prefix", "ka")).type, "none");
        assert.equal(searches().length, 2, "retry allowed after the gap");
        await h.settle();
        assert.equal(callSeek(runtime, variant("prefix", "ka")).type, "some");
    });

    test("refresh(none) is a Retry: a failed window and a failed search are asked again at once, inside the gap; a permanent failure stays", async () => {
        // A narrowing's Retry, or a Sheet's, refreshes its source: what failed is
        // asked again now, its readers re-fired, rather than after the gap a read
        // alone waits — a revision that did not move must not leave it failed.
        const { R1, runtime } = await keyed(new TestPagedRuntime());
        const handle = handleOf(runtime, KeyedType, countsPath) as unknown as KeyedHandle & { refresh: (target: unknown) => null };
        const stopPages = h.e3.fail(pages("inputs.preview_counts"), DOWN);
        const stopFinds = h.e3.fail((request) => finds("inputs.preview_counts")(request) && request.query.get("prefix") === "ka", DOWN);
        handle.page(0n, 2n);
        callSeek(runtime, variant("prefix", "ka"));
        // A key that is no `.east` literal: e3 cannot parse it, however often it is asked.
        callSeek(runtime, variant("key", "not a literal"));
        await h.settle();
        let refired = 0;
        runtime.subscribe(pagedWindowKey(h.workspace, countsPath, R1, 0, 2), () => { refired += 1; });
        runtime.subscribe(pagedSeekKey(h.workspace, countsPath, R1, { prefix: "ka" }), () => { refired += 1; });
        assert.throws(() => handle.page(0n, 2n), /internal/);

        stopPages();
        stopFinds();
        handle.refresh(none);
        assert.throws(() => handle.page(0n, 2n), /internal/, "deferred out of the caller's render");
        await h.settle();
        assert.equal(refired, 2, "the failed window's and search's readers re-fire");
        assert.equal(runtime.clockMs, 0, "still inside the gap");
        assert.equal(handle.page(0n, 2n).type, "none", "asked again: in flight, no longer failed");
        assert.equal(callSeek(runtime, variant("prefix", "ka")).type, "none");
        assert.deepEqual([windows("inputs.preview_counts").length, searches().length], [2, 3]);
        assert.throws(() => callSeek(runtime, variant("key", "not a literal")), /key_parse_error/, "no retry can fix it");
        assert.equal(searches().length, 3, "a permanent failure is never re-asked");

        await h.settle();
        assert.equal(handle.page(0n, 2n).type, "some");
        assert.equal(callSeek(runtime, variant("prefix", "ka")).type, "some");
        // A refresh with nothing failed refetches nothing.
        handle.refresh(none);
        await h.settle();
        assert.equal(handle.page(0n, 2n).type, "some");
        assert.deepEqual([windows("inputs.preview_counts").length, searches().length], [2, 3]);
    });

    test("a key e3 cannot parse keeps throwing, never re-asked", async () => {
        const { runtime } = await keyed(new TestPagedRuntime());
        callSeek(runtime, variant("key", "not a literal"));
        await h.settle();

        runtime.clockMs = 60_000;
        assert.throws(() => callSeek(runtime, variant("key", "not a literal")), /key_parse_error/);
        assert.equal(searches().length, 1);
    });
});

describe("PagedRuntime — a burst of searches settles as one (#1360)", () => {
    // A window over an interval index is some fifty-five searches launched in
    // one pass: its reader re-fires once when they have all landed, not once a
    // search, and a read meanwhile sees each answer as it lands.
    const seekOf = (runtime: PagedRuntime, selector: PagedSelector = NO_INDEX) => {
        const seek = handleOf(runtime, KeyedType, countsPath, "pinned", selector).seek;
        assert.ok(seek.type === "some", "the source must declare the capability");
        return (prefix: string) => seek.value(variant("prefix", prefix));
    };
    const keyOf = (R1: string, prefix: string) =>
        pagedSeekKey(h.workspace, countsPath, R1, toFindQuery(variant("prefix", prefix), NO_INDEX), NO_INDEX);
    /** A runtime whose counts source, keyed `ja`, `ka1`–`ka3` and `kb`, has looked its revision up. */
    const keyed = async <R extends PagedRuntime>(runtime: R) => {
        await h.write(counts, KEYED_COUNTS);
        const R1 = await hashOf(counts);
        return { R1, ...await known(runtime, (r) => handleOf(r, KeyedType, countsPath).revision!()) };
    };

    test("searches of one source launched together re-fire their reader once, when the last lands, every version moved", async () => {
        const { R1, runtime } = await keyed(new PagedRuntime());
        const seek = seekOf(runtime);
        const prefixes = ["ka", "kb", "kc"];
        // One reader of all three, as a window's reader is of its searches.
        const seen: number[][] = [];
        const reader = () => { seen.push(prefixes.map((prefix) => runtime.getKeyVersion(keyOf(R1, prefix)))); };
        for (const prefix of prefixes) runtime.subscribe(keyOf(R1, prefix), reader);
        const held = h.e3.hold(finds("inputs.preview_counts"));
        for (const prefix of prefixes) assert.equal(seek(prefix).type, "none");
        await held.holding;
        await h.settle();
        assert.equal(searches().length, 3);

        held.releaseOne();
        held.releaseOne();
        await h.settle();
        assert.deepEqual(seen, [], "no reader re-fires while its burst is in flight");
        assert.deepEqual(seek("ka"), some({ found: true, row: 1n, count: 3n }), "an answer is read as it lands");

        held.releaseOne();
        await h.settle();
        assert.deepEqual(seen, [[1, 1, 1]], "once, after every channel's version has moved");
    });

    test("a burst with a failed member re-fires once, the failure read as it was", async () => {
        const { R1, runtime } = await keyed(new TestPagedRuntime());
        const seek = seekOf(runtime);
        let fired = 0;
        const reader = () => { fired += 1; };
        for (const prefix of ["ka", "kb"]) runtime.subscribe(keyOf(R1, prefix), reader);
        const held = h.e3.hold(finds("inputs.preview_counts"));
        h.e3.fail((request) => finds("inputs.preview_counts")(request) && request.query.get("prefix") === "ka", DOWN);
        seek("ka");
        seek("kb");
        await held.holding;
        await h.settle();

        held.releaseOne();   // ka, which fails
        await h.settle();
        assert.equal(fired, 0);
        held.releaseOne();   // kb
        await h.settle();
        assert.equal(fired, 1);
        assert.throws(() => seek("ka"), /internal/);
        assert.deepEqual(seek("kb"), some({ found: true, row: 4n, count: 1n }));
    });

    test("a member a move drops still ends its burst: what the burst answered re-fires", async () => {
        const { R1, runtime, clock } = await keyed(new PagedRuntime());
        const seek = seekOf(runtime);
        let fired = 0;
        const reader = () => { fired += 1; };
        for (const prefix of ["ka", "kb"]) runtime.subscribe(keyOf(R1, prefix), reader);
        const held = h.e3.hold(finds("inputs.preview_counts"));
        seek("ka");
        seek("kb");
        await held.holding;
        await h.settle();

        held.releaseOne();   // ka lands
        await h.settle();
        await h.write(counts, new SortedMap([...KEYED_COUNTS, ["kz", 6n]], keys));
        const R2 = await hashOf(counts);
        await poll(clock);
        held.releaseOne();   // kb, pinned to R1: refused, and dropped
        await h.settle();
        assert.equal(fired, 1, "the burst ended with its dropped member");
        assert.equal(seek("ka").type, "none", "R1's answers are never read under R2");
        assert.deepEqual(searches().at(-1), { prefix: "ka", hash: R2 });
        await h.settle();
    });

    test("a search of other rows launched in the same turn re-fires on its own", async () => {
        const R1 = await hashOf(orders);
        const OrdersType = toEastTypeValue(orders.type);
        const { runtime } = await known(new PagedRuntime(), (r) => handleOf(r, OrdersType, ordersPath).revision!());
        const primary = handleOf(runtime, OrdersType, ordersPath).seek;
        const queue = handleOf(runtime, QueueWindowType, ordersPath, "pinned", BY_STATUS).seek;
        assert.ok(primary.type === "some" && queue.type === "some");
        const fired = { primary: 0, index: 0 };
        runtime.subscribe(pagedSeekKey(h.workspace, ordersPath, R1, toFindQuery(variant("prefix", "WO-100"), NO_INDEX), NO_INDEX), () => { fired.primary += 1; });
        runtime.subscribe(pagedSeekKey(h.workspace, ordersPath, R1, toFindQuery(variant("prefix", "late"), BY_STATUS), BY_STATUS), () => { fired.index += 1; });
        // A Save's confirmation reads the record's own rows; the index is other rows.
        const held = h.e3.hold(finds("records.work_orders"));
        primary.value(variant("prefix", "WO-100"));
        queue.value(variant("prefix", "late"));
        await held.holding;
        await h.settle();
        assert.deepEqual(searches("records.work_orders"), [{ prefix: "WO-100", hash: R1 }, { prefix: "late", index: "by_status", hash: R1 }]);

        held.releaseOne();
        await h.settle();
        assert.deepEqual(fired, { primary: 1, index: 0 }, "the record's rows never wait on the index's burst");
        held.releaseOne();
        await h.settle();
        assert.deepEqual(fired, { primary: 1, index: 1 });
    });

    test("a window still re-fires as it lands, beside another in flight", async () => {
        await h.write(rows, [10n, 20n, 30n, 40n]);
        const R1 = await hashOf(rows);
        const { runtime } = await known(new PagedRuntime());
        const fired = { first: 0, second: 0 };
        runtime.subscribe(pagedWindowKey(h.workspace, rowsPath, R1, 0, 2), () => { fired.first += 1; });
        runtime.subscribe(pagedWindowKey(h.workspace, rowsPath, R1, 2, 2), () => { fired.second += 1; });
        const held = h.e3.hold(pages("inputs.preview_rows"));
        callPage(runtime, 0n, 2n);
        callPage(runtime, 2n, 2n);
        await held.holding;
        await h.settle();

        held.releaseOne();
        await h.settle();
        assert.deepEqual(fired, { first: 1, second: 0 }, "a sheet's rows appear as they arrive");
        held.releaseOne();
        await h.settle();
        assert.deepEqual(fired, { first: 1, second: 1 });
    });
});

/**
 * A line of `width` letters no compressor shrinks: a xorshift stream over 64
 * letters, from its seed, so a page of such lines weighs what it holds.
 *
 * @param width - Its length
 * @param seed - Where its stream starts
 * @returns The line
 */
function noise(width: number, seed: number): string {
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-";
    let state = (0x9e3779b9 ^ Math.imul(seed, 0x85ebca6b)) >>> 0;
    const out: string[] = new Array(width);
    for (let i = 0; i < width; i++) {
        state ^= state << 13; state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5; state >>>= 0;
        out[i] = letters[state & 63]!;
    }
    return out.join("");
}
