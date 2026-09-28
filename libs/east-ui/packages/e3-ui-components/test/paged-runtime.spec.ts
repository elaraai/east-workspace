/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for `PagedRuntime` — the `Data.bindPaged` platform runtime. Uses a
 * hand-rolled `PagedApi` stub with a manual release gate so every state of a
 * window (in flight, landed, exhausted, failed) is deterministic and
 * network-free, a revision the test moves by hand, and an injected clock so
 * the retry gate is driven rather than slept through.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    ArrayType,
    DictType,
    FloatType,
    IntegerType,
    StringType,
    StructType,
    encodeBeast2For,
    none,
    some,
    toEastTypeValue,
    variant,
    type EastTypeValue,
    type ValueTypeOf,
} from "@elaraai/east";
import { PagedSourceType, PinnedSourceType, type SeekQueryType } from "@elaraai/east-ui";
import { DatasetHashMismatchError, type DatasetPage, type DatasetFindQuery, type DatasetFindResult } from "@elaraai/e3-api-client";
import type { TreePath } from "@elaraai/e3-types";
import {
    PagedRuntime,
    pagedRevisionKey,
    pagedWindowKey,
    pagedTotalKey,
    pagedSeekKey,
    toFindQuery,
    type PagedApi,
    type PagedSelector,
    type PagedWindow,
} from "../src/platform/paged-runtime.js";

const ws = "test-workspace";
const pathOf = (...segs: string[]): TreePath => segs.map(s => variant("field", s));
const opsPath = pathOf("inputs", "ops");
const R1 = "1".repeat(64);
const R2 = "2".repeat(64);
const R3 = "3".repeat(64);
const NO_INDEX: PagedSelector = { index: null, join: false };

const Row = StructType({ id: StringType, v: FloatType });
const RowsType = ArrayType(Row);
const rowsTypeValue = toEastTypeValue(RowsType);
const encodeRows = encodeBeast2For(RowsType);

/** A `PagedApi` whose every response is released by hand, and whose dataset
 *  holds `revision` until the test moves it. */
function gatedApi(initial: string | null = R1) {
    const pending: Array<{ window: PagedWindow; resolve: (p: DatasetPage) => void; reject: (e: unknown) => void }> = [];
    const calls: PagedWindow[] = [];
    const finds: DatasetFindQuery[] = [];
    const pendingFinds: Array<{ resolve: (r: DatasetFindResult) => void; reject: (e: unknown) => void }> = [];
    const watchers = new Set<(hash: string | null) => void>();
    const state = { revision: initial, lookups: 0, lookupError: null as unknown };
    const api: PagedApi = {
        getPage(_workspace, _path, window) {
            calls.push(window);
            return new Promise<DatasetPage>((resolve, reject) => {
                pending.push({ window, resolve, reject });
            });
        },
        findKey(_workspace, _path, query) {
            finds.push(query);
            return new Promise<DatasetFindResult>((resolve, reject) => {
                pendingFinds.push({ resolve, reject });
            });
        },
        async getRevision() {
            state.lookups += 1;
            if (state.lookupError !== null) throw state.lookupError;
            return state.revision;
        },
        watchRevision(_workspace, _path, onChange) {
            watchers.add(onChange);
            return () => { watchers.delete(onChange); };
        },
    };
    const page = (elements: { id: string; v: number }[], window: PagedWindow, total: number): DatasetPage => {
        const data = encodeRows(elements);
        return {
            data, totalElements: total, totalBytes: data.length, totalExact: true,
            segmentCount: 0, offset: window.offset, count: elements.length, hash: window.hash ?? "",
        };
    };
    return {
        api, calls, state,
        get watching() { return watchers.size; },
        /** The dataset moves: the store's poll reports its new hash. */
        move(hash: string | null) {
            state.revision = hash;
            for (const onChange of [...watchers]) onChange(hash);
        },
        /** Release the oldest in-flight fetch with these elements. */
        release(elements: { id: string; v: number }[], total = elements.length) {
            const next = pending.shift();
            assert.ok(next, "expected an in-flight page request");
            next.resolve(page(elements, next.window, total));
        },
        /** Fail the oldest in-flight fetch. */
        fail(err: unknown) {
            const next = pending.shift();
            assert.ok(next, "expected an in-flight page request");
            next.reject(err);
        },
        get inFlight() { return pending.length; },
        finds,
        /** Answer the oldest in-flight key search. */
        releaseFind(found: boolean, row: number, count: number) {
            const next = pendingFinds.shift();
            assert.ok(next, "expected an in-flight key search");
            next.resolve({ found, row, count, hash: "" });
        },
        /** Fail the oldest in-flight key search. */
        failFind(err: unknown) {
            const next = pendingFinds.shift();
            assert.ok(next, "expected an in-flight key search");
            next.reject(err);
        },
    };
}

/** A runtime whose `now()` is driven by the test. */
class TestPagedRuntime extends PagedRuntime {
    public clockMs = 0;
    protected override now(): number { return this.clockMs; }
}

/** Resolve after the microtask queue drains, so a released fetch has settled. */
const settle = () => new Promise<void>(res => setTimeout(res, 0));

/** An error the server's code rides on, as `ApiError` carries it. */
const serverError = (code: string, details = `${code} details`) =>
    Object.assign(new Error(`API error: ${code}`), { code, details });

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
    handleOf(runtime, rowsTypeValue, opsPath).page(offset, limit);
const callTotal = (runtime: PagedRuntime) => handleOf(runtime, rowsTypeValue, opsPath).total();
const callRevision = (runtime: PagedRuntime) => handleOf(runtime, rowsTypeValue, opsPath).revision!();

/** A runtime over `api` whose source has looked its revision up. */
async function known<R extends PagedRuntime>(runtime: R, api: PagedApi): Promise<R> {
    runtime.initialize(api, ws);
    callRevision(runtime);
    await settle();
    return runtime;
}

describe("PagedRuntime", () => {
    test("a window reads `none` while in flight, then `some` once it lands", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);

        // First read starts the fetch and reports "not yet".
        assert.equal(callPage(runtime, 0n, 2n).type, "none");
        assert.equal(g.calls.length, 1);
        assert.deepEqual(g.calls[0], { offset: 0, limit: 2, hash: R1 }, "the window is pinned to the revision");

        // A re-read while in flight must NOT start a second fetch.
        callPage(runtime, 0n, 2n);
        assert.equal(g.calls.length, 1, "an in-flight window is not refetched");

        g.release([{ id: "a", v: 1.0 }, { id: "b", v: 2.0 }], 5);
        await settle();

        const landed = callPage(runtime, 0n, 2n);
        assert.ok(landed.type === "some");
        assert.equal(landed.value.length, 2);
        assert.equal(landed.value[0]!.id, "a");
        assert.equal(g.calls.length, 1, "a landed window is served from the channel");
    });

    test("an EMPTY window is `some([])` — exhausted, not loading", async () => {
        // The contract the canvas readers walk on: `none` means "ask again",
        // `some([])` means "stop". A server that clamps past the end must
        // therefore produce `some`, never `none`.
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);

        callPage(runtime, 100n, 10n);
        g.release([], 5);
        await settle();

        const w = callPage(runtime, 100n, 10n);
        assert.ok(w.type === "some");
        assert.equal(w.value.length, 0);
    });

    test("any landed window teaches the source's total, on its own channel", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);

        assert.equal(callTotal(runtime).type, "none");

        callPage(runtime, 0n, 2n);
        g.release([{ id: "a", v: 1.0 }], 37);
        await settle();

        const total = callTotal(runtime);
        assert.equal(total.type, "some");
        assert.equal(total.value, 37n);
    });

    test("a settling window notifies its own key, and the total's", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);

        let windowHits = 0;
        let totalHits = 0;
        runtime.subscribe(pagedWindowKey(ws, opsPath, R1, 0, 2), () => { windowHits += 1; });
        runtime.subscribe(pagedTotalKey(ws, opsPath, R1), () => { totalHits += 1; });

        callPage(runtime, 0n, 2n);
        // The launch itself must stay silent: the read that triggers it runs
        // inside a render pass, and notifying there re-enters the renderer.
        assert.equal(windowHits, 0, "launch must not notify");
        assert.equal(totalHits, 0, "launch must not notify");

        g.release([{ id: "a", v: 1.0 }], 9);
        await settle();
        assert.equal(windowHits, 1);
        assert.equal(totalHits, 1);
    });

    test("reads register the revision, window and total keys for reactive tracking", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);

        runtime.enableTracking();
        callPage(runtime, 0n, 2n);
        callTotal(runtime);
        const keys = runtime.disableTracking();

        assert.ok(keys.includes(pagedRevisionKey(ws, opsPath)), "revision key tracked, so a move re-fires the read");
        assert.ok(keys.includes(pagedWindowKey(ws, opsPath, R1, 0, 2)), "window key tracked");
        assert.ok(keys.includes(pagedTotalKey(ws, opsPath, R1)), "total key tracked");
    });

    test("a failed window throws its reason, and a read after the gap fetches it again", async () => {
        const g = gatedApi();
        const runtime = await known(new TestPagedRuntime(), g.api);

        assert.equal(callPage(runtime, 0n, 2n).type, "none");
        g.fail(serverError("internal", "the store is down"));
        await settle();

        // A failure is not "in flight": a view must see it, not spin.
        assert.throws(() => callPage(runtime, 0n, 2n), /inputs\.ops: internal: the store is down/);
        runtime.clockMs = 500;
        assert.throws(() => callPage(runtime, 0n, 2n), /internal/, "still failed inside the gap");
        assert.equal(g.calls.length, 1, "retry suppressed inside the gap");

        // Past the gap: the read fetches again, and is in flight until it lands.
        runtime.clockMs = 5000;
        assert.equal(callPage(runtime, 0n, 2n).type, "none");
        assert.equal(g.calls.length, 2, "retry allowed after the gap");

        g.release([{ id: "a", v: 1.0 }], 1);
        await settle();
        assert.equal(callPage(runtime, 0n, 2n).type, "some");
    });

    for (const code of ["dataset_not_pageable", "index_not_found", "dataset_not_indexed"]) {
        test(`a \`${code}\` failure keeps throwing, never refetched, until the source moves`, async () => {
            const g = gatedApi();
            const runtime = await known(new TestPagedRuntime(), g.api);

            callPage(runtime, 0n, 2n);
            g.fail(serverError(code));
            await settle();

            runtime.clockMs = 60_000;
            assert.throws(() => callPage(runtime, 0n, 2n), new RegExp(code));
            assert.equal(g.calls.length, 1, "no retry can help while the content is the same");

            g.move(R2);
            assert.equal(callPage(runtime, 0n, 2n).type, "none", "another snapshot is asked afresh");
            assert.equal(g.calls.length, 2);
        });
    }

    test("a window that does not decode as the source's type keeps throwing", async () => {
        const g = gatedApi();
        const runtime = await known(new TestPagedRuntime(), g.api);
        const handle = handleOf(runtime, toEastTypeValue(ArrayType(StructType({ n: IntegerType }))), opsPath);

        handle.page(0n, 2n);
        g.release([{ id: "a", v: 1.0 }], 1);   // rows of another type
        await settle();

        runtime.clockMs = 60_000;
        assert.throws(() => handle.page(0n, 2n), /does not decode as the source's type/);
        assert.equal(g.calls.length, 1, "never refetched");
    });

    test("windows are per (offset, limit) — different windows are different channels", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);

        callPage(runtime, 0n, 2n);
        callPage(runtime, 2n, 2n);
        assert.equal(g.calls.length, 2);
        assert.deepEqual(g.calls[1], { offset: 2, limit: 2, hash: R1 });

        g.release([{ id: "a", v: 1.0 }], 4);   // window 0
        g.release([{ id: "c", v: 3.0 }], 4);   // window 1
        await settle();

        const w0 = callPage(runtime, 0n, 2n);
        const w1 = callPage(runtime, 2n, 2n);
        assert.ok(w0.type === "some" && w1.type === "some");
        assert.equal(w0.value[0]!.id, "a");
        assert.equal(w1.value[0]!.id, "c");
    });

    test("the compiled-handle cache keys on TYPE and shape as well as path", () => {
        // The window decoder is baked from the source type, so a path re-bound
        // at a different type (a redeployed dataset) must not be handed the
        // handle compiled against the old one.
        const g = gatedApi();
        const runtime = new PagedRuntime();
        runtime.initialize(g.api, ws);

        const a = handleOf(runtime, rowsTypeValue, opsPath);
        assert.equal(a, handleOf(runtime, rowsTypeValue, opsPath), "same (type, path, shape) is cached");

        const otherType = toEastTypeValue(ArrayType(StructType({ id: StringType, n: IntegerType })));
        assert.notEqual(a, handleOf(runtime, otherType, opsPath), "a different source type must not reuse the handle");

        const released = handleOf(runtime, rowsTypeValue, opsPath, "released");
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
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);
        callPage(runtime, 0n, 2n);
        g.release([{ id: "a", v: 1.0 }], 1);
        await settle();
        assert.equal(callPage(runtime, 0n, 2n).type, "some");
        assert.equal(g.watching, 1);

        runtime.clear();
        assert.equal(g.watching, 0, "the dataset is no longer followed");
        assert.throws(() => callPage(runtime, 0n, 2n), /no paging service/);
    });

    test("clear(api) leaves an adapter another provider installed in place", async () => {
        const first = gatedApi();
        const second = gatedApi();
        const runtime = new PagedRuntime();
        runtime.initialize(first.api, ws);
        runtime.initialize(second.api, ws);

        runtime.clear(first.api);
        callRevision(runtime);
        await settle();
        assert.equal(callRevision(runtime).value, R1, "the second adapter still serves");
        assert.equal(second.state.lookups, 1);

        runtime.clear(second.api);
        assert.throws(() => callPage(runtime, 0n, 2n), /no paging service/);
    });
});

describe("PagedRuntime — snapshots", () => {
    test("revision reads `none` until found, then the dataset's hash, and every read carries it", async () => {
        const g = gatedApi();
        const runtime = new PagedRuntime();
        runtime.initialize(g.api, ws);

        assert.equal(callRevision(runtime).type, "none", "being found");
        assert.equal(callPage(runtime, 0n, 2n).type, "none");
        assert.equal(g.calls.length, 0, "nothing is fetched before the revision is known");
        assert.equal(g.state.lookups, 1, "one lookup serves every read of the dataset");
        await settle();

        assert.deepEqual(callRevision(runtime), some(R1));
        callPage(runtime, 0n, 2n);
        assert.equal(g.calls[0]!.hash, R1);
    });

    test("every bind of one dataset shares its snapshot, an index read included", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);
        const byStatus = handleOf(runtime, rowsTypeValue, opsPath, "pinned", { index: "by_status", join: false });

        assert.deepEqual(byStatus.revision!(), some(R1), "an index read is pinned to the record's state hash");
        byStatus.page(0n, 2n);
        assert.deepEqual(g.calls[0], { offset: 0, limit: 2, hash: R1, index: "by_status", join: false });
        assert.equal(g.state.lookups, 1, "no second lookup");
        assert.equal(g.watching, 1, "one watch follows the dataset");
    });

    test("a refused pin moves the source to the content the server names", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);
        let moves = 0;
        runtime.subscribe(pagedRevisionKey(ws, opsPath), () => { moves += 1; });

        callPage(runtime, 0n, 2n);
        g.fail(new DatasetHashMismatchError("moved", R2));
        await settle();

        assert.equal(moves, 1, "every read of the dataset re-fires");
        assert.deepEqual(callRevision(runtime), some(R2));
        assert.equal(callPage(runtime, 0n, 2n).type, "none", "a 409 is a move, not a failure");
        assert.equal(g.calls[1]!.hash, R2, "the window is fetched again, pinned to the new content");
    });

    test("a refusal that names no content looks the revision up", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);

        callPage(runtime, 0n, 2n);
        g.state.revision = R2;
        g.fail(new DatasetHashMismatchError("moved", null));
        await settle();

        assert.equal(g.state.lookups, 2);
        assert.deepEqual(callRevision(runtime), some(R2));
    });

    test("the source follows its dataset: a new hash moves it, the same hash changes nothing", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);
        callPage(runtime, 0n, 2n);
        g.release([{ id: "old", v: 1.0 }], 1);
        await settle();
        let moves = 0;
        runtime.subscribe(pagedRevisionKey(ws, opsPath), () => { moves += 1; });

        g.move(R1);
        assert.equal(moves, 0, "a report of the content it holds changes nothing");
        assert.equal(callPage(runtime, 0n, 2n).type, "some");

        g.move(R2);
        assert.equal(moves, 1);
        assert.equal(callTotal(runtime).type, "none", "the old snapshot's total is gone");
        assert.equal(callPage(runtime, 0n, 2n).type, "none", "the old snapshot's window is never served");
        assert.equal(g.calls[1]!.hash, R2);
        g.release([{ id: "new", v: 2.0 }], 1);
        await settle();
        const fresh = callPage(runtime, 0n, 2n);
        assert.ok(fresh.type === "some");
        assert.equal(fresh.value[0]!.id, "new");
    });

    test("a window in flight when the source moves never lands in the new snapshot", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);
        callPage(runtime, 0n, 2n);             // pinned to R1, in flight

        g.move(R2);
        callPage(runtime, 0n, 2n);             // pinned to R2, in flight
        g.release([{ id: "from-R1", v: 1.0 }], 1);
        await settle();
        assert.equal(callPage(runtime, 0n, 2n).type, "none", "R1's answer is dropped");
        assert.equal(callTotal(runtime).type, "none", "R1's total is dropped");

        g.release([{ id: "from-R2", v: 2.0 }], 1);
        await settle();
        const fresh = callPage(runtime, 0n, 2n);
        assert.ok(fresh.type === "some");
        assert.equal(fresh.value[0]!.id, "from-R2");
    });

    test("refresh(some(h)) moves to h, and refresh(none) moves to what the dataset holds", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);
        const handle = handleOf(runtime, rowsTypeValue, opsPath);

        assert.equal(handle.refresh!(some(R2)), null, "returns at once");
        assert.deepEqual(handle.revision!(), some(R1), "the move is deferred out of the caller's render");
        await settle();
        assert.deepEqual(handle.revision!(), some(R2));

        g.state.revision = R3;
        handle.refresh!(none);
        await settle();
        assert.equal(g.state.lookups, 2);
        assert.deepEqual(handle.revision!(), some(R3));
    });

    test("a dataset with no value reads `none` and fetches nothing until a value lands", async () => {
        const g = gatedApi(null);
        const runtime = await known(new PagedRuntime(), g.api);

        assert.equal(callRevision(runtime).type, "none");
        assert.equal(callPage(runtime, 0n, 2n).type, "none");
        assert.equal(callTotal(runtime).type, "none");
        assert.equal(g.calls.length, 0);

        g.move(R1);
        assert.deepEqual(callRevision(runtime), some(R1));
        callPage(runtime, 0n, 2n);
        assert.equal(g.calls[0]!.hash, R1);
    });

    test("a pinned read answered `dataset_unassigned` moves the source to no snapshot", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);
        callPage(runtime, 0n, 2n);
        g.fail(serverError("dataset_unassigned"));
        await settle();

        assert.equal(callRevision(runtime).type, "none");
        assert.equal(callPage(runtime, 0n, 2n).type, "none", "no value is `none`, not a failure");
        assert.equal(g.calls.length, 1);
    });

    test("a failed lookup throws its reason until a read after the gap looks again", async () => {
        const g = gatedApi();
        g.state.lookupError = serverError("dataset_not_found", "no such dataset");
        const runtime = new TestPagedRuntime();
        runtime.initialize(g.api, ws);

        assert.equal(callPage(runtime, 0n, 2n).type, "none");
        await settle();
        assert.throws(() => callPage(runtime, 0n, 2n), /dataset_not_found: no such dataset/);
        assert.throws(() => callRevision(runtime), /dataset_not_found/);
        assert.equal(g.state.lookups, 1);

        g.state.lookupError = null;
        runtime.clockMs = 5000;
        assert.equal(callPage(runtime, 0n, 2n).type, "none");
        await settle();
        assert.equal(g.state.lookups, 2);
        assert.deepEqual(callRevision(runtime), some(R1));
    });

    test("a released handle is pinned, follows and fails like a pinned one", async () => {
        const g = gatedApi();
        const runtime = new TestPagedRuntime();
        runtime.initialize(g.api, ws);
        const released = handleOf(runtime, rowsTypeValue, opsPath, "released");

        assert.equal(released.page(0n, 2n).type, "none");
        await settle();
        released.page(0n, 2n);
        assert.equal(g.calls[0]!.hash, R1, "pinned");

        g.fail(serverError("internal"));
        await settle();
        assert.throws(() => released.page(0n, 2n), /internal/, "fails visibly");

        g.move(R2);
        assert.equal(released.page(0n, 2n).type, "none", "follows: the failure belonged to the old snapshot");
        assert.equal(g.calls[1]!.hash, R2);
    });
});

describe("PagedRuntime — key search (#574)", () => {
    const KeyedType = toEastTypeValue(DictType(StringType, Row));
    const callSeek = (runtime: PagedRuntime, type: EastTypeValue, query: ValueTypeOf<SeekQueryType>) => {
        const seek = handleOf(runtime, type, opsPath).seek;
        assert.ok(seek.type === "some", "the source must declare the capability");
        return seek.value(query);
    };

    test("the capability follows the DATASET's type — keyed seeks, an Array cannot", () => {
        // `datasetFindKey` binary-searches a stored blob's segment fences with
        // the key comparator; an Array blob has no key order to search, so the
        // handle must not advertise an affordance that can never answer.
        const runtime = new PagedRuntime();
        runtime.initialize(gatedApi().api, ws);
        assert.equal(handleOf(runtime, KeyedType, opsPath).seek.type, "some");
        assert.equal(handleOf(runtime, rowsTypeValue, opsPath).seek.type, "none");
    });

    test("a query reads `none` while the fences are walked, then `some(range)`", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);

        const first = callSeek(runtime, KeyedType, variant("prefix", "ka"));
        assert.equal(first.type, "none", "in flight is `none`, never a wrong answer");
        assert.equal(g.finds.length, 1);
        assert.deepEqual(g.finds[0], { prefix: "ka", hash: R1 }, "the search is pinned to the revision");

        // A re-read while in flight must not start a second search.
        callSeek(runtime, KeyedType, variant("prefix", "ka"));
        assert.equal(g.finds.length, 1, "an in-flight query is not re-asked");

        g.releaseFind(true, 2, 3);
        await settle();

        const landed = callSeek(runtime, KeyedType, variant("prefix", "ka"));
        assert.ok(landed.type === "some");
        assert.equal(landed.value.found, true);
        // Integers cross the boundary as bigint — the row plugs straight into a
        // window offset, which is the whole point of the shared row space.
        assert.equal(landed.value.row, 2n);
        assert.equal(landed.value.count, 3n);
        assert.equal(g.finds.length, 1, "an answered query is served from its channel");
    });

    test("every distinct query gets its OWN channel", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);

        callSeek(runtime, KeyedType, variant("prefix", "ka"));
        callSeek(runtime, KeyedType, variant("prefix", "kb"));
        assert.equal(g.finds.length, 2, "a different query is a different search");
        assert.notEqual(
            pagedSeekKey(ws, opsPath, R1, { prefix: "ka" }),
            pagedSeekKey(ws, opsPath, R1, { prefix: "kb" }),
        );
        // ... and a miss is an ANSWER, not an absence: it carries the insertion
        // row so a viewport can still position.
        g.releaseFind(false, 7, 0);
        await settle();
        const miss = callSeek(runtime, KeyedType, variant("prefix", "ka"));
        assert.ok(miss.type === "some");
        assert.equal(miss.value.found, false);
        assert.equal(miss.value.row, 7n);
    });

    test("a search answer belongs to its snapshot — a move asks again", async () => {
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);
        callSeek(runtime, KeyedType, variant("prefix", "ka"));
        g.releaseFind(true, 2, 3);
        await settle();

        g.move(R2);
        assert.equal(callSeek(runtime, KeyedType, variant("prefix", "ka")).type, "none");
        assert.deepEqual(g.finds[1], { prefix: "ka", hash: R2 });
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

        // No end names no run. The server refuses it, so the seek refuses it
        // where it was written, and nothing is fetched.
        const g = gatedApi();
        const runtime = await known(new PagedRuntime(), g.api);
        assert.throws(() => callSeek(runtime, KeyedType, variant("range", { from: [], to: [] })), /names no end/);
        assert.equal(g.finds.length, 0);
    });

    test("a failed search throws its reason and retries after the gap, exactly like a window", async () => {
        // The search chrome polls while the user types; a failing server must
        // not be hammered once per keystroke-frame.
        const g = gatedApi();
        const runtime = await known(new TestPagedRuntime(), g.api);

        callSeek(runtime, KeyedType, variant("prefix", "ka"));
        g.failFind(serverError("internal"));
        await settle();
        assert.throws(() => callSeek(runtime, KeyedType, variant("prefix", "ka")), /internal/);

        runtime.clockMs = 500;
        assert.throws(() => callSeek(runtime, KeyedType, variant("prefix", "ka")), /internal/);
        assert.equal(g.finds.length, 1, "retry suppressed inside the gap");

        runtime.clockMs = 5000;
        assert.equal(callSeek(runtime, KeyedType, variant("prefix", "ka")).type, "none");
        assert.equal(g.finds.length, 2, "retry allowed after the gap");

        g.releaseFind(true, 1, 1);
        await settle();
        assert.equal(callSeek(runtime, KeyedType, variant("prefix", "ka")).type, "some");
    });

    test("a key the server cannot parse keeps throwing, never re-asked", async () => {
        const g = gatedApi();
        const runtime = await known(new TestPagedRuntime(), g.api);
        callSeek(runtime, KeyedType, variant("key", "not a literal"));
        g.failFind(serverError("key_parse_error"));
        await settle();

        runtime.clockMs = 60_000;
        assert.throws(() => callSeek(runtime, KeyedType, variant("key", "not a literal")), /key_parse_error/);
        assert.equal(g.finds.length, 1);
    });
});
