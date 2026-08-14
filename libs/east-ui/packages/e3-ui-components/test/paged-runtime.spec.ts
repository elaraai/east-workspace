/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for `PagedRuntime` — the `Data.bindPaged` platform runtime. Uses a
 * hand-rolled `PagedApi` stub with a manual release gate so every state of a
 * window (in flight, landed, exhausted, failed) is deterministic and
 * network-free, and an injected clock so the retry gate is driven rather than
 * slept through.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    ArrayType,
    FloatType,
    IntegerType,
    StringType,
    StructType,
    encodeBeast2For,
    toEastTypeValue,
    variant,
    type EastTypeValue,
} from "@elaraai/east";
import type { DatasetPage } from "@elaraai/e3-api-client";
import type { TreePath } from "@elaraai/e3-types";
import {
    PagedRuntime,
    pagedWindowKey,
    pagedTotalKey,
    createInMemoryPagedApi,
    type PagedApi,
    type PagedWindow,
} from "../src/platform/paged-runtime.js";

const ws = "test-workspace";
const pathOf = (...segs: string[]): TreePath => segs.map(s => variant("field", s));
const opsPath = pathOf("inputs", "ops");

const Row = StructType({ id: StringType, v: FloatType });
const RowsType = ArrayType(Row);
const rowsTypeValue = toEastTypeValue(RowsType);
const encodeRows = encodeBeast2For(RowsType);

/** A `PagedApi` whose every response is released by hand. */
function gatedApi() {
    const pending: Array<{ window: PagedWindow; resolve: (p: DatasetPage) => void; reject: (e: unknown) => void }> = [];
    const calls: PagedWindow[] = [];
    const api: PagedApi = {
        getPage(_workspace, _path, window) {
            calls.push(window);
            return new Promise<DatasetPage>((resolve, reject) => {
                pending.push({ window, resolve, reject });
            });
        },
    };
    const page = (elements: { id: string; v: number }[], window: PagedWindow, total: number): DatasetPage => {
        const data = encodeRows(elements);
        return {
            data, totalElements: total, totalBytes: data.length, totalExact: true,
            segmentCount: 0, offset: window.offset, count: elements.length, hash: "",
        };
    };
    return {
        api, calls,
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
    };
}

/** A runtime whose `now()` is driven by the test. */
class TestPagedRuntime extends PagedRuntime {
    public clockMs = 0;
    protected override now(): number { return this.clockMs; }
}

/** Resolve after the microtask queue drains, so a released fetch has settled. */
const settle = () => new Promise<void>(res => setTimeout(res, 0));

/** The handle's compiled methods — the real call path a UI takes. */
interface PagedHandle {
    page: (offset: bigint, limit: bigint) => unknown;
    total: () => unknown;
}
const handleOf = (runtime: PagedRuntime, type: EastTypeValue, path: TreePath): PagedHandle =>
    runtime.buildHandle(type, path) as unknown as PagedHandle;

function callPage(runtime: PagedRuntime, type: EastTypeValue, path: TreePath, offset: bigint, limit: bigint): unknown {
    return handleOf(runtime, type, path).page(offset, limit);
}

function callTotal(runtime: PagedRuntime, type: EastTypeValue, path: TreePath): unknown {
    return handleOf(runtime, type, path).total();
}

describe("PagedRuntime", () => {
    test("a window reads `none` while in flight, then `some` once it lands", async () => {
        const g = gatedApi();
        const runtime = new PagedRuntime();
        runtime.initialize(g.api, ws);

        // First read starts the fetch and reports "not yet".
        const first = callPage(runtime, rowsTypeValue, opsPath, 0n, 2n);
        assert.equal((first as { type: string }).type, "none");
        assert.equal(g.calls.length, 1);
        assert.deepEqual(g.calls[0], { offset: 0, limit: 2 });

        // A re-read while in flight must NOT start a second fetch.
        callPage(runtime, rowsTypeValue, opsPath, 0n, 2n);
        assert.equal(g.calls.length, 1, "an in-flight window is not refetched");

        g.release([{ id: "a", v: 1.0 }, { id: "b", v: 2.0 }], 5);
        await settle();

        const landed = callPage(runtime, rowsTypeValue, opsPath, 0n, 2n) as { type: string; value: unknown[] };
        assert.equal(landed.type, "some");
        assert.equal(landed.value.length, 2);
        assert.equal((landed.value[0] as { id: string }).id, "a");
        assert.equal(g.calls.length, 1, "a landed window is served from the channel");
    });

    test("an EMPTY window is `some([])` — exhausted, not loading", async () => {
        // The contract the canvas readers walk on: `none` means "ask again",
        // `some([])` means "stop". A server that clamps past the end must
        // therefore produce `some`, never `none`.
        const g = gatedApi();
        const runtime = new PagedRuntime();
        runtime.initialize(g.api, ws);

        callPage(runtime, rowsTypeValue, opsPath, 100n, 10n);
        g.release([], 5);
        await settle();

        const w = callPage(runtime, rowsTypeValue, opsPath, 100n, 10n) as { type: string; value: unknown[] };
        assert.equal(w.type, "some");
        assert.equal(w.value.length, 0);
    });

    test("any landed window teaches the source's total, on its own channel", async () => {
        const g = gatedApi();
        const runtime = new PagedRuntime();
        runtime.initialize(g.api, ws);

        assert.equal((callTotal(runtime, rowsTypeValue, opsPath) as { type: string }).type, "none");

        callPage(runtime, rowsTypeValue, opsPath, 0n, 2n);
        g.release([{ id: "a", v: 1.0 }], 37);
        await settle();

        const total = callTotal(runtime, rowsTypeValue, opsPath) as { type: string; value: bigint };
        assert.equal(total.type, "some");
        assert.equal(total.value, 37n);
    });

    test("a settling window notifies its own key, and the total's", async () => {
        const g = gatedApi();
        const runtime = new PagedRuntime();
        runtime.initialize(g.api, ws);

        const windowKey = pagedWindowKey(ws, opsPath, 0, 2);
        const totalKey = pagedTotalKey(ws, opsPath);
        let windowHits = 0;
        let totalHits = 0;
        runtime.subscribe(windowKey, () => { windowHits += 1; });
        runtime.subscribe(totalKey, () => { totalHits += 1; });

        callPage(runtime, rowsTypeValue, opsPath, 0n, 2n);
        // The launch itself must stay silent: the read that triggers it runs
        // inside a render pass, and notifying there re-enters the renderer.
        assert.equal(windowHits, 0, "launch must not notify");
        assert.equal(totalHits, 0, "launch must not notify");

        g.release([{ id: "a", v: 1.0 }], 9);
        await settle();
        assert.equal(windowHits, 1);
        assert.equal(totalHits, 1);
    });

    test("reads register the window + total keys for reactive tracking", async () => {
        const g = gatedApi();
        const runtime = new PagedRuntime();
        runtime.initialize(g.api, ws);

        runtime.enableTracking();
        callPage(runtime, rowsTypeValue, opsPath, 0n, 2n);
        callTotal(runtime, rowsTypeValue, opsPath);
        const keys = runtime.disableTracking();

        assert.ok(keys.includes(pagedWindowKey(ws, opsPath, 0, 2)), "window key tracked");
        assert.ok(keys.includes(pagedTotalKey(ws, opsPath)), "total key tracked");
    });

    test("a failed window retries, but only after the rate-limit gap", async () => {
        const g = gatedApi();
        const runtime = new TestPagedRuntime();
        runtime.initialize(g.api, ws);

        callPage(runtime, rowsTypeValue, opsPath, 0n, 2n);
        g.fail(new Error("network"));
        await settle();
        assert.equal(g.calls.length, 1);

        // Inside the gap: a polling reader must not hammer a failing server.
        runtime.clockMs = 500;
        callPage(runtime, rowsTypeValue, opsPath, 0n, 2n);
        assert.equal(g.calls.length, 1, "retry suppressed inside the gap");

        // Past the gap: one more attempt.
        runtime.clockMs = 5000;
        callPage(runtime, rowsTypeValue, opsPath, 0n, 2n);
        assert.equal(g.calls.length, 2, "retry allowed after the gap");

        g.release([{ id: "a", v: 1.0 }], 1);
        await settle();
        assert.equal((callPage(runtime, rowsTypeValue, opsPath, 0n, 2n) as { type: string }).type, "some");
    });

    test("a `dataset_not_pageable` failure is permanent — never retried", async () => {
        // Binding a non-collection dataset is an authoring mistake; retrying it
        // forever would just spam the console and the server.
        const g = gatedApi();
        const runtime = new TestPagedRuntime();
        runtime.initialize(g.api, ws);

        callPage(runtime, rowsTypeValue, opsPath, 0n, 2n);
        g.fail(Object.assign(new Error("not pageable"), { code: "dataset_not_pageable" }));
        await settle();

        runtime.clockMs = 60_000;
        callPage(runtime, rowsTypeValue, opsPath, 0n, 2n);
        assert.equal(g.calls.length, 1, "an authoring error is never retried");
    });

    test("windows are per (offset, limit) — different windows are different channels", async () => {
        const g = gatedApi();
        const runtime = new PagedRuntime();
        runtime.initialize(g.api, ws);

        callPage(runtime, rowsTypeValue, opsPath, 0n, 2n);
        callPage(runtime, rowsTypeValue, opsPath, 2n, 2n);
        assert.equal(g.calls.length, 2);
        assert.deepEqual(g.calls[1], { offset: 2, limit: 2 });

        g.release([{ id: "a", v: 1.0 }], 4);   // window 0
        g.release([{ id: "c", v: 3.0 }], 4);   // window 1
        await settle();

        const w0 = callPage(runtime, rowsTypeValue, opsPath, 0n, 2n) as { value: { id: string }[] };
        const w1 = callPage(runtime, rowsTypeValue, opsPath, 2n, 2n) as { value: { id: string }[] };
        assert.equal(w0.value[0]!.id, "a");
        assert.equal(w1.value[0]!.id, "c");
    });

    test("the compiled-handle cache keys on TYPE as well as path", () => {
        // The window decoder is baked from the source type, so a path re-bound
        // at a different type (a redeployed dataset) must not be handed the
        // handle compiled against the old one.
        const g = gatedApi();
        const runtime = new PagedRuntime();
        runtime.initialize(g.api, ws);

        const a = runtime.buildHandle(rowsTypeValue, opsPath);
        const again = runtime.buildHandle(rowsTypeValue, opsPath);
        assert.equal(a, again, "same (type, path) is cached");

        const otherType = toEastTypeValue(ArrayType(StructType({ id: StringType, n: IntegerType })));
        const b = runtime.buildHandle(otherType, opsPath);
        assert.notEqual(a, b, "a different source type must not reuse the handle");
    });

    test("no workspace configured is a named error, not a silent none", () => {
        const runtime = new PagedRuntime();
        assert.throws(
            () => callPage(runtime, rowsTypeValue, opsPath, 0n, 2n),
            /no workspace configured/,
        );
    });

    test("clear() drops the api, the workspace and every window", async () => {
        const g = gatedApi();
        const runtime = new PagedRuntime();
        runtime.initialize(g.api, ws);
        callPage(runtime, rowsTypeValue, opsPath, 0n, 2n);
        g.release([{ id: "a", v: 1.0 }], 1);
        await settle();
        assert.equal((callPage(runtime, rowsTypeValue, opsPath, 0n, 2n) as { type: string }).type, "some");

        runtime.clear();
        assert.throws(() => callPage(runtime, rowsTypeValue, opsPath, 0n, 2n), /no workspace configured/);
    });
});

describe("createInMemoryPagedApi", () => {
    test("serves windows out of a local array, with exact totals", async () => {
        const elements = [
            { id: "a", v: 1.0 }, { id: "b", v: 2.0 }, { id: "c", v: 3.0 },
        ];
        const api = createInMemoryPagedApi([{
            path: opsPath,
            encode: e => encodeRows(e as { id: string; v: number }[]),
            elements,
        }]);

        const first = await api.getPage(ws, opsPath, { offset: 0, limit: 2 });
        assert.equal(first.count, 2);
        assert.equal(first.totalElements, 3);

        const past = await api.getPage(ws, opsPath, { offset: 10, limit: 2 });
        assert.equal(past.count, 0, "past the end is an empty window, not an error");
    });

    test("an unknown path is an error, not an empty window", async () => {
        const api = createInMemoryPagedApi([]);
        await assert.rejects(() => api.getPage(ws, opsPath, { offset: 0, limit: 1 }), /no in-memory paged source/);
    });
});
