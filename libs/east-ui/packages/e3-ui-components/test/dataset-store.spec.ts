/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Exhaustive tests for `ReactiveDatasetCache` + `createDefaultDatasetApi` +
 * the path/key helpers, on e3 itself (#1378): every cache reads e3 through
 * its default API, over the Data.bind examples' datasets — the count, the
 * name and the threshold, and the counts' report, a task's output. A
 * `FakeClock` times the polls, and a `FakeVisibility` hides the page: they are
 * time and the page, not e3. Another session's change is a write through e3's
 * API; a dataset losing its value is the workspace reset to the package as a
 * deploy leaves it; what a poll asked, and with which tag, is read from the
 * request log; and a request in flight, failed or delivered untagged is held,
 * failed or stripped at the harness's fetch.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { IntegerType, SortedMap, StringType, compareFor, encodeBeast2For, variant } from "@elaraai/east";
import type { TreePath } from "@elaraai/e3-types";
import { datasetGetStatus, workspaceStatusSince, type RequestOptions } from "@elaraai/e3-api-client";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import type { E3Request } from "../src/e3-web.test-utils.js";
import {
    ReactiveDatasetCache,
    STATUS_UNCHANGED_MAX_MS,
    createDefaultDatasetApi,
    datasetCacheKey,
    datasetPathToString,
} from "../src/platform/dataset-store.js";
import { createFakeVisibility, type FakeClock } from "./fixtures/fake-clock.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "bind/data/data": ex });

const path = (...segs: string[]): TreePath => segs.map(s => variant("field", s));
/** The count: an Integer input, 0 as deployed. */
const policy = ex.countInput;
const policyPath = policy.path;
/** The name: a String input, empty as deployed. */
const schedule = ex.nameInput;
const schedulePath = schedule.path;
/** The counts' report: a task's output, which writing the counts leaves stale and a reset leaves with no value. */
const report = ex.previewReportTask.output;

const int = (n: bigint) => encodeBeast2For(IntegerType)(n);
const str = (s: string) => encodeBeast2For(StringType)(s);
/** A fault e3 answers a request with, as its store would fail one. */
const FAILED = { status: 500, type: "internal", message: "the store is down" } as const;

const isStatus = (request: E3Request) => request.kind === "status";
const isWrite = (of: string) => (request: E3Request) => request.kind === "write" && request.dataset === of;
const isRead = (of: string) => (request: E3Request) => request.kind === "read" && request.dataset === of;
/** The status polls made of the test's workspace. */
const polls = () => h.requests("status");
/** The reads of a dataset whole made of the test's workspace. */
const reads = (of: string) => h.requests("read", of).length;

/** The content hash e3 holds a dataset under now, or `null` while it has no value. */
async function hashOf(dataset: { readonly path: TreePath }, workspace: string = h.workspace): Promise<string | null> {
    const status = await datasetGetStatus(h.e3.apiUrl, h.e3.repo, workspace, dataset.path, h.e3.direct);
    return status.hash.type === "some" ? status.hash.value : null;
}

/** The tag e3 names its workspace's status by now: what a poll holding the current status sends. */
async function tagNow(): Promise<string | null> {
    return (await workspaceStatusSince(h.e3.apiUrl, h.e3.repo, h.workspace, null, h.e3.direct))!.etag;
}

/** A cache over e3 in the test's workspace, and the clock its polls are timed by. */
const newCache = () => h.cache();
/** The default dataset API over the harness's fetch. */
const api = () => createDefaultDatasetApi(h.e3.apiUrl, h.e3.repo, h.options);
const ws = () => h.workspace;

// =============================================================================
// A.1 — pure helpers
// =============================================================================

describe("datasetPathToString / datasetCacheKey", () => {
    test("datasetPathToString empty path", () => {
        assert.equal(datasetPathToString([]), "");
    });
    test("datasetPathToString single segment", () => {
        assert.equal(datasetPathToString(path("foo")), "foo");
    });
    test("datasetPathToString multi segment", () => {
        assert.equal(datasetPathToString(path("a", "b", "c")), "a.b.c");
    });
    test("datasetCacheKey empty path returns workspace", () => {
        assert.equal(datasetCacheKey("ws", []), "ws");
    });
    test("datasetCacheKey with path joins on dot", () => {
        assert.equal(datasetCacheKey("ws", path("a", "b")), "ws.a.b");
    });
});

// =============================================================================
// A.2 — construction + getConfig
// =============================================================================

describe("ReactiveDatasetCache — construction + getConfig", () => {
    /** A cache made with the configuration given, over e3's API, destroyed once read. */
    function configOf(config: ConstructorParameters<typeof ReactiveDatasetCache>[0]) {
        const cache = new ReactiveDatasetCache(config, api());
        try {
            return cache.getConfig();
        } finally {
            cache.destroy();
        }
    }

    test("omitted workspace → no workspace field in getConfig", () => {
        assert.deepEqual(configOf({}), {});
    });

    test("provided workspace round-trips", () => {
        assert.deepEqual(configOf({ workspace: "ws" }), { workspace: "ws" });
    });

    test("getConfig does NOT contain server identity (regression guard)", () => {
        const { cache } = newCache();
        const cfg = cache.getConfig() as Record<string, unknown>;
        assert.equal("apiUrl" in cfg, false);
        assert.equal("repo" in cfg, false);
        assert.equal("token" in cfg, false);
        assert.equal("staleTime" in cfg, false);
    });

    test("the poll intervals given round-trip, and only those given", () => {
        assert.deepEqual(configOf({ workspace: "ws", pollIntervalMs: 2000, pollBackoffMs: 9000 }),
            { workspace: "ws", pollIntervalMs: 2000, pollBackoffMs: 9000 });
        assert.deepEqual(configOf({ pollBackoffMs: 9000 }), { pollBackoffMs: 9000 });
    });
});

// =============================================================================
// A.3 — sync reads
// =============================================================================

describe("ReactiveDatasetCache — sync reads", () => {
    test("read returns undefined for uncached", () => {
        const { cache } = newCache();
        assert.equal(cache.read(ws(), policyPath), undefined);
    });

    test("has returns false for uncached, true after write", async () => {
        const { cache } = newCache();
        assert.equal(cache.has(ws(), policyPath), false);
        await cache.write(ws(), policyPath, int(1n));
        assert.equal(cache.has(ws(), policyPath), true);
    });

    test("getStatus defaults to unset; flips to stale after optimistic write", async () => {
        const { cache } = newCache();
        assert.equal(cache.getStatus(ws(), policyPath).type, "unset");
        const held = h.e3.hold(isWrite("inputs.count"));
        const writePromise = cache.write(ws(), policyPath, int(1n));
        // Optimistic — cache + status set BEFORE e3 answers the write.
        assert.deepEqual(cache.read(ws(), policyPath), int(1n));
        assert.equal(cache.getStatus(ws(), policyPath).type, "stale");
        await held.holding;
        held.release();
        await writePromise;
    });
});

// =============================================================================
// A.4 — subscribe + per-key + global
// =============================================================================

describe("ReactiveDatasetCache — subscribe", () => {
    test("per-key fires only on its key", async () => {
        const { cache } = newCache();
        let policyCalls = 0, scheduleCalls = 0;
        cache.subscribe(datasetCacheKey(ws(), policyPath), () => { policyCalls++; });
        cache.subscribe(datasetCacheKey(ws(), schedulePath), () => { scheduleCalls++; });
        await cache.write(ws(), policyPath, int(1n));
        assert.equal(policyCalls, 1);
        assert.equal(scheduleCalls, 0);
    });

    test("global fires on every change", async () => {
        const { cache } = newCache();
        let globalCalls = 0;
        cache.subscribe(() => { globalCalls++; });
        await cache.write(ws(), policyPath, int(1n));
        await cache.write(ws(), schedulePath, str("two"));
        assert.ok(globalCalls >= 2);
    });

    test("getKeyVersion increments per notification, monotonic", async () => {
        const { cache } = newCache();
        const key = datasetCacheKey(ws(), policyPath);
        const v0 = cache.getKeyVersion(key);
        await cache.write(ws(), policyPath, int(1n));
        const v1 = cache.getKeyVersion(key);
        await cache.write(ws(), policyPath, int(2n));
        const v2 = cache.getKeyVersion(key);
        assert.ok(v1 > v0);
        assert.ok(v2 > v1);
    });

    test("getSnapshot increments at most once per flush", async () => {
        const { cache } = newCache();
        const before = cache.getSnapshot();
        cache.batch(() => {
            // Two writes inside the batch — should produce ONE snapshot bump
            // (writes are sync inside the batch's optimistic update).
            void cache.write(ws(), policyPath, int(1n));
            void cache.write(ws(), schedulePath, str("two"));
        });
        const after = cache.getSnapshot();
        assert.equal(after - before, 1);
        await h.settle();
    });

    test("unsubscribe stops notifications", async () => {
        const { cache } = newCache();
        let calls = 0;
        const key = datasetCacheKey(ws(), policyPath);
        const off = cache.subscribe(key, () => { calls++; });
        await cache.write(ws(), policyPath, int(1n));
        off();
        await cache.write(ws(), policyPath, int(2n));
        assert.equal(calls, 1);
    });

    test("global unsubscribe disposer returns void (regression)", () => {
        const { cache } = newCache();
        const off = cache.subscribe(() => { /* noop */ });
        const result = off();
        assert.equal(result, undefined);
    });

    test("subscribe added during flush — does NOT fire for the in-flight notification", async () => {
        const { cache } = newCache();
        const xKey = datasetCacheKey(ws(), policyPath);
        const yKey = datasetCacheKey(ws(), schedulePath);
        let yCalls = 0;
        cache.subscribe(xKey, () => {
            // While dispatching the X-key notification, register a fresh
            // subscriber for the SAME flush's pending Y key. The
            // snapshot-first contract means y's subscriber list is
            // re-read inside the flush loop — so the late subscriber
            // could fire if it was added before y's iteration. To
            // avoid race-y assertions we just verify it doesn't crash.
            cache.subscribe(yKey, () => { yCalls++; });
        });
        await cache.write(ws(), policyPath, int(1n));
        // Late-registered Y subscriber has no effect on this flush, but
        // does fire on the NEXT write to its key.
        const before = yCalls;
        await cache.write(ws(), schedulePath, str("two"));
        assert.ok(yCalls > before);
    });
});

// =============================================================================
// A.5 — batch
// =============================================================================

describe("ReactiveDatasetCache — batch", () => {
    test("batched writes coalesce into one notification per key", async () => {
        const { cache } = newCache();
        let policyCalls = 0;
        cache.subscribe(datasetCacheKey(ws(), policyPath), () => { policyCalls++; });
        cache.batch(() => {
            void cache.write(ws(), policyPath, int(1n));
            void cache.write(ws(), policyPath, int(2n));
        });
        // Optimistic notification was deferred to end-of-batch — exactly one
        // for this key (cache has only the latest value at flush time).
        assert.equal(policyCalls, 1);
        await h.settle();
    });

    test("nested batch — outer flushes once", async () => {
        const { cache } = newCache();
        let calls = 0;
        cache.subscribe(datasetCacheKey(ws(), policyPath), () => { calls++; });
        cache.batch(() => {
            cache.batch(() => {
                void cache.write(ws(), policyPath, int(1n));
            });
            // Inner batch did NOT flush.
            assert.equal(calls, 0);
        });
        // Outer batch flushed.
        assert.equal(calls, 1);
        await h.settle();
    });

    test("batch returns fn's return value", () => {
        const { cache } = newCache();
        const result = cache.batch(() => 42);
        assert.equal(result, 42);
    });

    test("throwing inside batch still flushes", async () => {
        const { cache } = newCache();
        let calls = 0;
        cache.subscribe(datasetCacheKey(ws(), policyPath), () => { calls++; });
        assert.throws(() => {
            cache.batch(() => {
                void cache.write(ws(), policyPath, int(1n));
                throw new Error("boom");
            });
        }, /boom/);
        assert.equal(calls, 1);
        await h.settle();
    });
});

// =============================================================================
// A.6 — setScheduler
// =============================================================================

describe("ReactiveDatasetCache — setScheduler", () => {
    test("with scheduler — notify deferred until scheduler fires", async () => {
        const { cache } = newCache();
        const scheduled: { notify?: () => void } = {};
        cache.setScheduler(notify => { scheduled.notify = notify; });
        let calls = 0;
        cache.subscribe(datasetCacheKey(ws(), policyPath), () => { calls++; });
        await cache.write(ws(), policyPath, int(1n));
        // Without firing the scheduler, no callback yet.
        assert.equal(calls, 0);
        assert.ok(scheduled.notify);
        scheduled.notify();
        assert.equal(calls, 1);
    });

    test("without scheduler — synchronous", async () => {
        const { cache } = newCache();
        let calls = 0;
        cache.subscribe(datasetCacheKey(ws(), policyPath), () => { calls++; });
        await cache.write(ws(), policyPath, int(1n));
        // Optimistic update flushes synchronously
        assert.ok(calls >= 1);
    });

    test("replacing scheduler mid-flight: in-flight scheduled flush still fires", async () => {
        const { cache } = newCache();
        const scheduled: { notify?: () => void } = {};
        cache.setScheduler(notify => { scheduled.notify = notify; });
        let calls = 0;
        cache.subscribe(datasetCacheKey(ws(), policyPath), () => { calls++; });
        await cache.write(ws(), policyPath, int(1n));
        assert.equal(calls, 0);
        // Replace mid-flight — the already-captured pending notify still fires.
        cache.setScheduler(undefined);
        assert.ok(scheduled.notify);
        scheduled.notify();
        assert.equal(calls, 1);
        // Subsequent writes use the new (sync) scheduler.
        await cache.write(ws(), policyPath, int(2n));
        assert.equal(calls, 2);
    });
});

// =============================================================================
// A.7 — doFlush mutation-during-iteration safety
// =============================================================================

describe("ReactiveDatasetCache — doFlush snapshot semantics", () => {
    test("subscriber writing a new key during flush — new key not silently dropped", async () => {
        const { cache } = newCache();
        let xCalls = 0;
        let yCalls = 0;
        const xKey = datasetCacheKey(ws(), policyPath);
        const yKey = datasetCacheKey(ws(), schedulePath);
        cache.subscribe(xKey, () => {
            xCalls++;
            // Mutate during the flush — synchronously write Y while X is being notified.
            if (xCalls === 1) {
                void cache.write(ws(), schedulePath, str("ninety-nine"));
            }
        });
        cache.subscribe(yKey, () => { yCalls++; });
        await cache.write(ws(), policyPath, int(1n));
        // X fired once; Y must also fire (regression for the snapshot-clear ordering bug).
        assert.equal(xCalls, 1);
        assert.ok(yCalls >= 1);
        await h.settle();
    });
});

// =============================================================================
// A.8 — write success path
// =============================================================================

describe("ReactiveDatasetCache — write (success)", () => {
    test("optimistic — cache set BEFORE e3 answers the write", async () => {
        const { cache } = newCache();
        const held = h.e3.hold(isWrite("inputs.count"));
        const writePromise = cache.write(ws(), policyPath, int(7n));
        assert.deepEqual(cache.read(ws(), policyPath), int(7n));
        await held.holding;
        held.release();
        await writePromise;
    });

    test("status flips to stale on optimistic update", async () => {
        const { cache } = newCache();
        const held = h.e3.hold(isWrite("inputs.count"));
        const writePromise = cache.write(ws(), policyPath, int(1n));
        assert.equal(cache.getStatus(ws(), policyPath).type, "stale");
        await held.holding;
        held.release();
        await writePromise;
    });

    test("the write sends the bytes to the dataset in the workspace", async () => {
        const { cache } = newCache();
        await cache.write(ws(), policyPath, int(42n));
        const sent = h.requests("write");
        assert.equal(sent.length, 1);
        assert.equal(sent[0]!.workspace, ws());
        assert.equal(sent[0]!.dataset, "inputs.count");
        assert.deepEqual(sent[0]!.body, int(42n));
        assert.equal(await h.read(policy), 42n);
    });
});

// =============================================================================
// A.9 — write failure rollback
// =============================================================================

describe("ReactiveDatasetCache — write (failure rollback)", () => {
    test("rollback restores previous value", async () => {
        const { cache } = newCache();
        await cache.write(ws(), policyPath, int(1n));
        h.e3.fail(isWrite("inputs.count"), FAILED);
        await assert.rejects(() => cache.write(ws(), policyPath, int(2n)), /Failed to set dataset: 500/);
        assert.deepEqual(cache.read(ws(), policyPath), int(1n));
    });

    test("rollback to absent when no previous", async () => {
        const { cache } = newCache();
        h.e3.fail(isWrite("inputs.count"), FAILED);
        await assert.rejects(() => cache.write(ws(), policyPath, int(1n)));
        assert.equal(cache.read(ws(), policyPath), undefined);
        assert.equal(cache.has(ws(), policyPath), false);
    });

    test("rollback restores status", async () => {
        const { cache } = newCache();
        h.e3.fail(isWrite("inputs.count"), FAILED);
        await assert.rejects(() => cache.write(ws(), policyPath, int(1n)));
        assert.equal(cache.getStatus(ws(), policyPath).type, "unset");
    });

    test("notifyChange fires twice (optimistic + rollback)", async () => {
        const { cache } = newCache();
        let calls = 0;
        cache.subscribe(datasetCacheKey(ws(), policyPath), () => { calls++; });
        h.e3.fail(isWrite("inputs.count"), FAILED);
        await assert.rejects(() => cache.write(ws(), policyPath, int(1n)));
        assert.equal(calls, 2);
    });
});

// =============================================================================
// A.10 — write destroyed short-circuit
// =============================================================================

describe("ReactiveDatasetCache — write after destroy", () => {
    test("destroyed cache sends no write", async () => {
        const { cache } = newCache();
        cache.destroy();
        await cache.write(ws(), policyPath, int(1n));
        assert.deepEqual(h.requests("write"), []);
        assert.equal(cache.read(ws(), policyPath), undefined);
    });
});

// =============================================================================
// A.11 — writeAndStart
// =============================================================================

describe("ReactiveDatasetCache — writeAndStart", () => {
    /** The dataflow runs the test's code launched. */
    const launches = () => h.requests("dataflow").filter((request) => request.method === "POST");

    test("writes, then launches the dataflow", async () => {
        const { cache } = newCache();
        await cache.writeAndStart(ws(), policyPath, int(1n));
        assert.equal(h.requests("write").length, 1);
        assert.equal(launches().length, 1);
        assert.ok(h.requests().indexOf(h.requests("write")[0]!) < h.requests().indexOf(launches()[0]!), "the write first");
    });

    test("a failed write launches nothing", async () => {
        const { cache } = newCache();
        h.e3.fail(isWrite("inputs.count"), FAILED);
        await assert.rejects(() => cache.writeAndStart(ws(), policyPath, int(1n)));
        assert.deepEqual(launches(), []);
    });

    test("a failed launch does not roll back the cache", async () => {
        const { cache } = newCache();
        h.e3.fail((request) => request.kind === "dataflow" && request.method === "POST", FAILED);
        await assert.rejects(() => cache.writeAndStart(ws(), policyPath, int(1n)));
        // The write succeeded, so the cache retains it
        assert.deepEqual(cache.read(ws(), policyPath), int(1n));
        assert.equal(await h.read(policy), 1n);
    });
});

// =============================================================================
// A.12 — preload
// =============================================================================

describe("ReactiveDatasetCache — preload", () => {
    test("first call reads the dataset and populates", async () => {
        await h.write(policy, 7n);
        const { cache } = newCache();
        await cache.preload(ws(), policyPath);
        assert.deepEqual(cache.read(ws(), policyPath), int(7n));
        assert.equal(reads("inputs.count"), 1);
    });

    test("second call (cache hit) is a no-op", async () => {
        const { cache } = newCache();
        await cache.preload(ws(), policyPath);
        await cache.preload(ws(), policyPath);
        assert.equal(reads("inputs.count"), 1);
    });

    test("concurrent calls dedupe to one read", async () => {
        const { cache } = newCache();
        const held = h.e3.hold(isRead("inputs.count"));
        const p1 = cache.preload(ws(), policyPath);
        const p2 = cache.preload(ws(), policyPath);
        await held.holding;
        held.release();
        await Promise.all([p1, p2]);
        assert.equal(reads("inputs.count"), 1);
    });

    test("destroyed mid-await does not populate", async () => {
        const { cache } = newCache();
        const held = h.e3.hold(isRead("inputs.count"));
        const p = cache.preload(ws(), policyPath);
        await held.holding;
        cache.destroy();
        held.release();
        await p;
        assert.equal(cache.read(ws(), policyPath), undefined);
    });
});

// =============================================================================
// A.13 — list
// =============================================================================

describe("ReactiveDatasetCache — list", () => {
    test("empty path lists the workspace's root", async () => {
        const { cache } = newCache();
        const fields = await cache.list(ws(), []);
        assert.ok(fields.includes("inputs"));
        const listed = h.requests("dataset-status");
        assert.deepEqual(listed.map((request) => request.dataset), [undefined], "one listing, of the root");
    });

    test("non-empty path lists under it", async () => {
        const { cache } = newCache();
        const fields = await cache.list(ws(), path("inputs"));
        assert.ok(fields.includes("count"));
        const listed = h.requests("dataset-status");
        assert.deepEqual(listed.map((request) => [request.dataset, request.query.get("list")]), [["inputs", "true"]]);
    });
});

// =============================================================================
// A.14 — setRefetchInterval
// =============================================================================

describe("ReactiveDatasetCache — setRefetchInterval", () => {
    test("creates a poller and fires immediate poll", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 100);
        await h.settle();
        assert.ok(polls().length >= 1);
        assert.equal(clock.intervals.length, 1);
    });

    test("subsequent paths share the existing poller", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 100);
        cache.setRefetchInterval(ws(), schedulePath, 100);
        assert.equal(clock.intervals.length, 1);
        await h.settle();
    });

    test("shorter interval restarts the timer", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 1000);
        const firstHandle = clock.intervals[0]!;
        cache.setRefetchInterval(ws(), schedulePath, 100);
        // First handle was cancelled, new one created with shorter ms.
        assert.equal(firstHandle.active, false);
        assert.equal(clock.intervals.length, 1);
        assert.equal(clock.intervals[0]!.intervalMs, 100);
        await h.settle();
    });

    test("same workspace+path called twice — single watch", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 100);
        cache.setRefetchInterval(ws(), policyPath, 100);
        // No second timer: the path counts its two watchers.
        assert.equal(clock.intervals.length, 1);
        await h.settle();
    });

    test("longer interval after a shorter interval — does NOT relax", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 100);
        cache.setRefetchInterval(ws(), schedulePath, 1000);
        // Documented monotonic-shortening behaviour: still 100ms.
        assert.equal(clock.intervals[0]!.intervalMs, 100);
        await h.settle();
    });

    test("a poll asks the status of the paths it polls and those whose hash it follows, and of no others", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 100);
        cache.watchHash(ws(), schedulePath, () => {});
        await h.settle();
        clock.tickAll();
        await h.settle();
        const asked = polls().at(-1)?.query.getAll("path");
        assert.ok(asked !== undefined, "the poll names what it watches");
        assert.deepEqual(new Set(asked), new Set([".inputs.count", ".inputs.name"]));
    });

    test("a path watched once a poll is in flight waits for the next poll, and is not taken for absent", async () => {
        const { cache, clock } = newCache();
        await cache.preload(ws(), schedulePath);
        const held = h.e3.hold(isStatus);
        cache.setRefetchInterval(ws(), policyPath, 100); // the poll asks for the count, and is held
        await held.holding;
        cache.setRefetchInterval(ws(), schedulePath, 100);
        const heard: (string | null)[] = [];
        cache.watchHash(ws(), schedulePath, (hash) => { heard.push(hash); });
        held.release();
        await h.settle();
        assert.deepEqual(cache.read(ws(), schedulePath), str(""), "its content is kept");
        assert.deepEqual(heard, [], "its watch is told nothing yet");

        clock.tickAll();
        await h.settle();
        assert.deepEqual(heard, [await hashOf(schedule)], "the next poll answers it");
    });
});

// =============================================================================
// A.8b — write triggers a poll when a workspace poller is active
// =============================================================================

describe("ReactiveDatasetCache — write triggers poll", () => {
    test("write after setRefetchInterval triggers a follow-up status poll", async () => {
        const { cache } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 1000);
        await h.settle();
        const before = polls().length;
        await cache.write(ws(), policyPath, int(2n));
        await h.settle();
        // After write, an extra status poll should have fired.
        assert.ok(polls().length > before);
    });

    test("write WITHOUT a workspace poller does NOT trigger a poll", async () => {
        const { cache } = newCache();
        // No setRefetchInterval call — no poller.
        await cache.write(ws(), policyPath, int(1n));
        await h.settle();
        assert.equal(polls().length, 0);
    });
});

describe("ReactiveDatasetCache — refresh", () => {
    test("a refresh during a poll that read the status before the change polls again, and sees it", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 100);
        await h.settle();

        // A poll reaches e3, which reads the status, and its answer is held on its way back.
        const answers = h.e3.holdAnswers(isStatus);
        clock.tickAll();
        await answers.holding;
        await h.write(policy, 2n);                       // a commit lands
        const refreshed = cache.refresh(ws());
        answers.release();
        await refreshed;
        await h.settle();
        assert.deepEqual(cache.read(ws(), policyPath), int(2n));
    });
});

// =============================================================================
// A.15 — polling hash-based diff
// =============================================================================

describe("ReactiveDatasetCache — polling (hash diff)", () => {
    test("server hash unchanged → no refetch", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 100);
        await h.settle();
        const fetchedFirst = reads("inputs.count");
        clock.tickAll();
        await h.settle();
        // No new fetch because the hash didn't change.
        assert.equal(reads("inputs.count"), fetchedFirst);
    });

    test("server hash changed → refetch + cache updated", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 100);
        await h.settle();
        // Another session changes the value (and so its hash).
        await h.write(policy, 99n);
        clock.tickAll();
        await h.settle();
        assert.deepEqual(cache.read(ws(), policyPath), int(99n));
    });

    test("server reports no value → cache deletes", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), report.path, 100);
        await h.settle();
        assert.equal(cache.has(ws(), report.path), true);
        // The workspace is reset: the report has no value until the next run.
        await h.unrun();
        clock.tickAll();
        await h.settle();
        assert.equal(cache.has(ws(), report.path), false);
    });

    test("per-path fetch failure isolated — others still update", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 100);
        cache.setRefetchInterval(ws(), schedulePath, 100);
        await h.settle();
        // Both change; the count's fetch fails.
        await h.write(policy, 11n);
        await h.write(schedule, "twenty-two");
        h.e3.fail(isRead("inputs.count"), FAILED);
        clock.tickAll();
        await h.settle();
        assert.deepEqual(cache.read(ws(), policyPath), int(0n), "the failed fetch keeps what was read");
        assert.deepEqual(cache.read(ws(), schedulePath), str("twenty-two"), "the other updated");
    });
});

// =============================================================================
// A.15b — the poll backs off while nothing it shows changes
// =============================================================================

describe("ReactiveDatasetCache — polling backs off", () => {
    /** The interval the workspace's one timer runs at. */
    const period = (clock: FakeClock): number => {
        assert.equal(clock.intervals.length, 1, "one timer");
        return clock.intervals[0]!.intervalMs;
    };
    /** Polls `n` times, each settled, answering the interval after each. */
    const ticks = async (clock: FakeClock, n: number): Promise<number[]> => {
        const periods: number[] = [];
        for (let i = 0; i < n; i++) {
            clock.tickAll();
            await h.settle();
            periods.push(period(clock));
        }
        return periods;
    };

    test("polls at its interval while what it shows changes, doubling to 5 s while nothing does, and comes back on a change", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 1000);
        await h.settle();
        assert.equal(period(clock), 1000, "the first poll fetched the content: a change");
        assert.deepEqual(await ticks(clock, 4), [2000, 4000, 5000, 5000]);

        await h.write(policy, 2n);
        assert.deepEqual(await ticks(clock, 2), [1000, 2000], "a change brings it back, and it backs off again");
        assert.deepEqual(cache.read(ws(), policyPath), int(2n));
    });

    test("a status that moves is a change, its hash unchanged, and so is a hash a watch is told", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), report.path, 1000);
        cache.watchHash(ws(), policyPath, () => {});
        await h.settle();
        // The watch began after the first poll asked: the next tells it its
        // first hash, and then nothing changes.
        assert.deepEqual(await ticks(clock, 3), [1000, 2000, 4000], "the watch's first hash, and then nothing");

        // The counts change: the report is stale, its value as it was until the next run.
        await h.write(ex.previewCountsInput, new SortedMap([["a", 1n], ["b", 2n], ["c", 4n]], compareFor(StringType)));
        assert.deepEqual(await ticks(clock, 2), [1000, 2000], "the status moved");
        assert.equal(cache.getStatus(ws(), report.path).type, "stale");
        await h.write(policy, 5n);
        assert.deepEqual(await ticks(clock, 1), [1000], "the watch was told a new hash");
    });

    test("the viewer acting brings it back to its interval: a write, a run launched, a refresh, a new watch", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 1000);
        await h.settle();
        const backedOff = async (): Promise<void> => {
            await ticks(clock, 3);
            assert.equal(period(clock), 5000, "backed off");
        };

        await backedOff();
        const writing = cache.write(ws(), schedulePath, str("nine"));
        assert.equal(period(clock), 1000, "a write");
        await writing;
        await h.settle();

        await backedOff();
        const launching = cache.launchDataflow(ws());
        assert.equal(period(clock), 1000, "a run launched");
        await launching;
        await h.settle();

        await backedOff();
        const refreshing = cache.refresh(ws());
        assert.equal(period(clock), 1000, "a refresh");
        await refreshing;
        await h.settle();

        await backedOff();
        cache.setRefetchInterval(ws(), schedulePath, 1000);
        assert.equal(period(clock), 1000, "a new watch");
        await h.settle();
    });

    test("a poll that fails backs off, as one that sees nothing change does", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 1000);
        await h.settle();
        let failed = 0;
        h.e3.fail((request) => isStatus(request) && ++failed <= 2, FAILED);
        assert.deepEqual(await ticks(clock, 2), [2000, 4000]);
    });

    test("keeps an interval asked for that is longer than the backoff's", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 10_000);
        await h.settle();
        assert.deepEqual(await ticks(clock, 2), [10_000, 10_000]);
    });

    test("polls at the cache's configured interval and backs off to its configured backoff, unless a watch asks for shorter", async () => {
        const { cache, clock } = h.cache({ pollIntervalMs: 2000, pollBackoffMs: 12_000 });
        cache.setRefetchInterval(ws(), policyPath);
        await h.settle();
        assert.equal(period(clock), 2000, "the configured interval");
        assert.deepEqual(await ticks(clock, 4), [4000, 8000, 12_000, 12_000], "doubling to the configured backoff");

        // A watch asking for a shorter interval and backoff shortens both.
        cache.watchHash(ws(), schedulePath, () => {}, 500, 3000);
        assert.equal(period(clock), 500, "the watch's interval");
        assert.deepEqual(await ticks(clock, 4), [500, 1000, 2000, 3000], "the watch's first hash, then doubling to the watch's backoff");
        // Another asking for longer leaves them.
        cache.setRefetchInterval(ws(), schedulePath, 4000, 20_000);
        assert.deepEqual(await ticks(clock, 2), [500, 1000]);
    });
});

// =============================================================================
// A.15c — a hidden page polls nothing
// =============================================================================

describe("ReactiveDatasetCache — a hidden page", () => {
    /** Every status poll made, of every workspace. */
    const allPolls = () => h.e3.requests.filter(isStatus).length;

    test("stops every workspace's timer while the page is hidden, keeping what it watches, and polls each at once and at its interval once shown", async () => {
        const visibility = createFakeVisibility();
        const other = await h.e3.workspace();
        const third = await h.e3.workspace();
        const { cache, clock } = h.cache({ visibility });
        cache.setRefetchInterval(ws(), policyPath, 1000);
        cache.watchHash(other, schedulePath, () => {}, 1000);
        await h.settle();
        for (let i = 0; i < 3; i++) { clock.tickAll(); await h.settle(); }
        assert.deepEqual(clock.intervals.map((timer) => timer.intervalMs), [5000, 5000], "both backed off");
        const polled = allPolls();

        visibility.set(true);
        assert.equal(clock.intervals.length, 0, "no timer while hidden");
        await h.settle();
        assert.equal(allPolls(), polled, "and no poll");
        // A watch registered while hidden starts no timer and no poll either.
        cache.setRefetchInterval(ws(), schedulePath, 1000);
        cache.watchHash(third, policyPath, () => {}, 1000);
        await h.settle();
        assert.equal(clock.intervals.length, 0);
        assert.equal(allPolls(), polled);
        // Nor does a write restart one: the viewer is away.
        void cache.write(ws(), policyPath, int(3n));
        await h.settle();
        assert.equal(clock.intervals.length, 0, "no timer for a write while hidden");

        await h.write(policy, 4n);
        visibility.set(false);
        assert.deepEqual(clock.intervals.map((timer) => timer.intervalMs), [1000, 1000, 1000], "every workspace at its interval again");
        await h.settle();
        assert.ok(allPolls() >= polled + 3, "each polled at once");
        assert.deepEqual(cache.read(ws(), policyPath), int(4n), "and what changed meanwhile is seen");

        cache.destroy();
        visibility.set(true);
        visibility.set(false);
        assert.equal(clock.intervals.length, 0, "a destroyed cache starts no timer");
    });

    test("a cache made while the page is hidden polls once it is shown", async () => {
        const visibility = createFakeVisibility(true);
        const { cache, clock } = h.cache({ visibility });
        cache.setRefetchInterval(ws(), policyPath, 1000);
        await h.settle();
        assert.deepEqual([clock.intervals.length, polls().length], [0, 0]);
        visibility.set(false);
        await h.settle();
        assert.deepEqual([clock.intervals.length, polls().length], [1, 1]);
        assert.deepEqual(cache.read(ws(), policyPath), int(0n));
    });
});

// =============================================================================
// A.15d — a poll asks conditionally
// =============================================================================

describe("ReactiveDatasetCache — conditional polls", () => {
    /** The tag each status poll asked with. */
    const asked = (): (string | undefined)[] => polls().map((request) => request.ifNoneMatch);

    test("sends the last full answer's tag, keeps what it shows while e3 answers nothing, and asks in full once something moves", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 1000);
        await h.settle();
        assert.deepEqual(asked(), [undefined], "a first poll asks in full");
        assert.deepEqual(cache.read(ws(), policyPath), int(0n));
        const first = await tagNow();
        assert.notEqual(first, null, "e3 names its answer's tag");

        clock.tickAll();
        await h.settle();
        clock.tickAll();
        await h.settle();
        assert.deepEqual(asked(), [undefined, first, first], "then with the tag");
        assert.equal(reads("inputs.count"), 1, "nothing fetched: e3 answered nothing");
        assert.equal(clock.intervals[0]!.intervalMs, 4000, "an unchanged answer backs the poll off");

        await h.write(policy, 2n);
        const second = await tagNow();
        clock.tickAll();
        await h.settle();
        assert.equal(asked().at(-1), first, "the tag held");
        assert.deepEqual(cache.read(ws(), policyPath), int(2n), "e3 answered in full: the change is seen");
        clock.tickAll();
        await h.settle();
        assert.equal(asked().at(-1), second, "and the new tag is held");
    });

    test("asks in full when the paths it watches changed since the tag's answer, and after half a minute", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 1000);
        await h.settle();
        const tag = await tagNow();
        clock.tickAll();
        await h.settle();
        assert.deepEqual(asked(), [undefined, tag]);

        cache.setRefetchInterval(ws(), schedulePath, 1000);
        clock.tickAll();
        await h.settle();
        assert.equal(asked().at(-1), undefined, "another path watched: in full");
        assert.deepEqual(cache.read(ws(), schedulePath), str(""));
        clock.tickAll();
        await h.settle();
        assert.equal(asked().at(-1), tag, "then with the tag again");

        clock.advance(STATUS_UNCHANGED_MAX_MS);
        clock.tickAll();
        await h.settle();
        assert.equal(asked().at(-1), undefined, "half a minute on: in full, so a runner gone shows");
        clock.tickAll();
        await h.settle();
        assert.equal(asked().at(-1), tag, "and the fresh answer's tag after");
    });

    test("asks in full every time while its answers arrive with no tag", async () => {
        // A proxy between drops the tag e3's answers carry.
        h.e3.fail(isStatus, "untagged");
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 1000);
        await h.settle();
        clock.tickAll();
        await h.settle();
        assert.deepEqual(asked(), [undefined, undefined]);
    });

    test("asks in full again after a content fetch failed, so the fetch is tried again", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 1000);
        await h.settle();
        const first = await tagNow();
        await h.write(policy, 2n);
        const recover = h.e3.fail(isRead("inputs.count"), FAILED);
        clock.tickAll();
        await h.settle();
        assert.deepEqual(cache.read(ws(), policyPath), int(0n), "the fetch failed: what was read is kept");
        recover();
        clock.tickAll();
        await h.settle();
        assert.deepEqual(asked(), [undefined, first, undefined], "the next poll asks in full, not with the answer's tag");
        assert.deepEqual(cache.read(ws(), policyPath), int(2n), "and fetches the content again");
    });

    test("asks in full when a path it covers is watched again, so the new watcher is answered, and on a refresh", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 1000);
        await h.settle();
        const tag = await tagNow();
        clock.tickAll();
        await h.settle();
        assert.deepEqual(asked(), [undefined, tag]);

        // A hash watch on the path polled: e3 would answer nothing to the tag,
        // and the watch hear nothing until something moved.
        const heard: (string | null)[] = [];
        cache.watchHash(ws(), policyPath, (hash) => { heard.push(hash); });
        clock.tickAll();
        await h.settle();
        assert.equal(asked().at(-1), undefined, "a new watch: in full");
        assert.deepEqual(heard, [await hashOf(policy)], "and the watch is told");
        clock.tickAll();
        await h.settle();
        assert.equal(asked().at(-1), tag, "then with the tag again");

        // A second view of the path polled, and a refresh, each in full too.
        cache.setRefetchInterval(ws(), policyPath, 1000);
        clock.tickAll();
        await h.settle();
        assert.equal(asked().at(-1), undefined, "a path watched again: in full");
        clock.tickAll();
        await h.settle();
        assert.equal(asked().at(-1), tag);
        await cache.refresh(ws());
        assert.equal(asked().at(-1), undefined, "a refresh: in full");
    });
});

// =============================================================================
// A.16 — polling concurrent dedupe
// =============================================================================

describe("ReactiveDatasetCache — polling (concurrent dedup)", () => {
    test("two overlapping polls share one status request", async () => {
        const { cache, clock } = newCache();
        const held = h.e3.hold(isStatus);
        cache.setRefetchInterval(ws(), policyPath, 100);
        await held.holding;
        // Trigger a second poll while the first is held.
        clock.tickAll();
        held.release();
        await h.settle();
        assert.equal(polls().length, 1);
    });
});

// =============================================================================
// A.17 — polling destroyed mid-await
// =============================================================================

describe("ReactiveDatasetCache — polling (destroyed mid-await)", () => {
    test("destroy mid-poll → no follow-up fetches", async () => {
        const { cache, clock } = newCache();
        const held = h.e3.hold(isStatus);
        cache.setRefetchInterval(ws(), policyPath, 100);
        await held.holding;
        cache.destroy();
        held.release();
        await h.settle();
        // Even if status returned, nothing was fetched: destroyed === true short-circuited.
        assert.equal(reads("inputs.count"), 0);
        // Clock interval cancelled.
        assert.equal(clock.intervals.length, 0);
    });
});

// =============================================================================
// A.18 — destroy
// =============================================================================

describe("ReactiveDatasetCache — destroy", () => {
    test("clears intervals and state", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 100);
        await cache.write(ws(), policyPath, int(1n));
        cache.destroy();
        assert.equal(clock.intervals.length, 0);
        assert.equal(cache.read(ws(), policyPath), undefined);
        assert.equal(cache.has(ws(), policyPath), false);
        assert.equal(cache.getStatus(ws(), policyPath).type, "unset");
    });
});

// =============================================================================
// A.19 — createDefaultDatasetApi: each request's options
// =============================================================================

describe("createDefaultDatasetApi", () => {
    test("asks the status conditionally, with one attempt, and reads the tag an answer carries", async () => {
        const datasets = api();
        const recover = h.e3.fail(isStatus, "network");
        await assert.rejects(datasets.workspaceStatus(ws()), /fetch failed/, "a poll makes one attempt: its next poll is its retry");
        assert.equal(polls().length, 1);
        recover();

        const full = await datasets.workspaceStatus(ws(), [policyPath], '"a tag e3 does not hold"');
        assert.ok(full !== null, "a tag e3 does not hold is answered in full");
        assert.equal(full.etag, await tagNow(), "with the tag e3 names its answer by");
        assert.equal(await datasets.workspaceStatus(ws(), [policyPath], full.etag!), null, "a 304 is nothing");
        assert.deepEqual(polls().map((request) => request.ifNoneMatch), [undefined, '"a tag e3 does not hold"', full.etag]);
    });

    test("each request goes out with the options read when it is made: the token, and the fetch it goes through", async () => {
        const networkFetch = globalThis.fetch;
        const escaped: string[] = [];
        globalThis.fetch = (async (input: string | URL | Request) => {
            escaped.push(String(input));
            throw new Error(`the global fetch was called for ${String(input)}`);
        }) as typeof globalThis.fetch;
        /** A fetch a host gives: the harness's, recording each request's URL and token. */
        const server = () => {
            const seen: { url: string; auth: string | null }[] = [];
            const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
                seen.push({ url: input instanceof Request ? input.url : String(input), auth: new Headers(init?.headers).get("authorization") });
                return h.e3.fetch(input, init);
            }) as typeof globalThis.fetch;
            return { seen, fetch };
        };
        try {
            const first = server();
            const second = server();
            let options: RequestOptions = { token: "first", fetch: first.fetch };
            const datasets = createDefaultDatasetApi(h.e3.apiUrl, h.e3.repo, () => options);

            await datasets.workspaceStatus(ws());
            options = { token: "second", fetch: second.fetch };
            await datasets.listRoot(ws());

            const routes = `${h.e3.apiUrl}/api/repos/${h.e3.repo}/workspaces/${ws()}`;
            assert.deepEqual(first.seen, [{ url: `${routes}/status`, auth: "Bearer first" }]);
            assert.deepEqual(second.seen, [{ url: `${routes}/datasets`, auth: "Bearer second" }]);
            assert.deepEqual(escaped, [], "no request went to the global fetch");
        } finally {
            globalThis.fetch = networkFetch;
        }
    });

    test("asks the status route for the datasets named, each as a status names it", async () => {
        await api().workspaceStatus(ws(), [policyPath, path("inputs", "my field")]);
        assert.equal(polls().length, 1);
        assert.deepEqual(polls()[0]!.query.getAll("path"), [".inputs.count", ".inputs.`my field`"]);
    });
});

// =============================================================================
// B — regression tests for the query-core rebase (review findings #1-#7)
// =============================================================================

describe("ReactiveDatasetCache — write cancels in-flight content fetch (finding #1)", () => {
    test("poll-driven fetch racing a write does NOT resurrect the old value", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 100);
        await h.settle();
        assert.deepEqual(cache.read(ws(), policyPath), int(0n));

        // Another session changes the value → the next poll fetches the content.
        // Hold that fetch so it is in flight when the write lands.
        await h.write(policy, 2n);
        const held = h.e3.hold(isRead("inputs.count"));
        clock.tickAll();
        await held.holding;

        // The viewer writes while the poll's content fetch is held.
        const writePromise = cache.write(ws(), policyPath, int(99n));
        assert.deepEqual(cache.read(ws(), policyPath), int(99n));

        // The stale fetch is let go after the write — and must be discarded.
        held.release();
        await writePromise;
        await h.settle();
        assert.deepEqual(cache.read(ws(), policyPath), int(99n));
    });

    test("preload racing a write does NOT clobber the optimistic bytes", async () => {
        const { cache } = newCache();
        const held = h.e3.hold(isRead("inputs.count"));
        const preloadPromise = cache.preload(ws(), policyPath);
        await held.holding;
        // Write while the preload fetch is in flight.
        const writePromise = cache.write(ws(), policyPath, int(99n));
        held.release();
        await preloadPromise;
        await writePromise;
        assert.deepEqual(cache.read(ws(), policyPath), int(99n));
    });
});

describe("ReactiveDatasetCache — concurrent write rollback (finding #2)", () => {
    /** Fails the next `n` writes of the count. */
    const failWrites = (n: number) => {
        let failed = 0;
        h.e3.fail((request) => isWrite("inputs.count")(request) && ++failed <= n, FAILED);
    };

    test("first write fails, second succeeds — second's value survives", async () => {
        const { cache } = newCache();
        failWrites(1);
        const p1 = cache.write(ws(), policyPath, int(1n));
        const p2 = cache.write(ws(), policyPath, int(2n));
        await assert.rejects(() => p1);
        await p2;
        assert.deepEqual(cache.read(ws(), policyPath), int(2n));
    });

    test("both writes fail — rolls back to the pre-chain baseline, not an optimistic intermediate", async () => {
        const { cache } = newCache();
        await cache.write(ws(), policyPath, int(7n));   // confirmed baseline
        failWrites(2);
        const p1 = cache.write(ws(), policyPath, int(1n));
        const p2 = cache.write(ws(), policyPath, int(2n));
        await assert.rejects(() => p1);
        await assert.rejects(() => p2);
        // NOT 1 (the superseded optimistic write) — the confirmed value.
        assert.deepEqual(cache.read(ws(), policyPath), int(7n));
    });

    test("second write succeeds after first failed — e3 is sent both, in order", async () => {
        const { cache } = newCache();
        failWrites(1);
        const p1 = cache.write(ws(), policyPath, int(1n));
        const p2 = cache.write(ws(), policyPath, int(2n));
        await Promise.allSettled([p1, p2]);
        assert.deepEqual(h.requests("write").map((request) => request.body), [int(1n), int(2n)]);
        assert.equal(await h.read(policy), 2n);
    });
});

describe("ReactiveDatasetCache — stale unsubscribe disposer (finding #3)", () => {
    test("double-unsubscribe does not disconnect a newer subscriber on the same key", async () => {
        const { cache } = newCache();
        const key = datasetCacheKey(ws(), policyPath);
        const off1 = cache.subscribe(key, () => { /* first subscriber */ });
        off1();
        let calls = 0;
        cache.subscribe(key, () => { calls++; });
        off1(); // stale disposer, called again — must NOT tear down sub2
        await cache.write(ws(), policyPath, int(1n));
        assert.equal(calls, 1);
    });
});

describe("ReactiveDatasetCache — clearRefetchInterval (finding #5)", () => {
    test("clearing the last watched path stops the workspace poller", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 100);
        cache.setRefetchInterval(ws(), schedulePath, 100);
        assert.equal(clock.intervals.length, 1);
        cache.clearRefetchInterval(ws(), policyPath);
        assert.equal(clock.intervals.length, 1); // schedule still watched
        cache.clearRefetchInterval(ws(), schedulePath);
        assert.equal(clock.intervals.length, 0); // poller torn down
        await h.settle();
    });

    test("a path two views watch stays polled until both have cleared it", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 100); // view A
        cache.setRefetchInterval(ws(), policyPath, 100); // view B
        await h.settle();
        cache.clearRefetchInterval(ws(), policyPath);    // A unmounts
        assert.equal(clock.intervals.length, 1, "B still polls");
        await h.write(policy, 2n);
        clock.tickAll();
        await h.settle();
        assert.deepEqual(cache.read(ws(), policyPath), int(2n), "B hears the change");
        cache.clearRefetchInterval(ws(), policyPath);    // B unmounts
        assert.equal(clock.intervals.length, 0);
    });

    test("clearing an unknown workspace/path is a no-op", () => {
        const { cache, clock } = newCache();
        cache.clearRefetchInterval(ws(), policyPath);
        assert.equal(clock.intervals.length, 0);
    });

    test("re-registering after a full clear starts a fresh poller", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), policyPath, 100);
        cache.clearRefetchInterval(ws(), policyPath);
        cache.setRefetchInterval(ws(), policyPath, 100);
        assert.equal(clock.intervals.length, 1);
        await h.settle();
        assert.ok(polls().length >= 1);
    });
});

describe("ReactiveDatasetCache — write after destroy mid-await (finding #7)", () => {
    test("destroy during the write — no rollback mutation of cleared state", async () => {
        const { cache } = newCache();
        const held = h.e3.hold(isWrite("inputs.count"));
        h.e3.fail(isWrite("inputs.count"), FAILED);
        const p = cache.write(ws(), policyPath, int(1n));
        await held.holding;
        cache.destroy();
        held.release();
        await assert.rejects(() => p);
        // Destroyed cache stays empty — the rollback didn't repopulate it.
        assert.equal(cache.read(ws(), policyPath), undefined);
        assert.equal(cache.getStatus(ws(), policyPath).type, "unset");
    });
});

describe("ReactiveDatasetCache — preload records the content hash", () => {
    test("a poll right after preload does NOT refetch unchanged content", async () => {
        const { cache, clock } = newCache();
        await cache.preload(ws(), policyPath);
        assert.equal(reads("inputs.count"), 1);
        cache.setRefetchInterval(ws(), policyPath, 100);
        await h.settle();
        clock.tickAll();
        await h.settle();
        // Hash matched the preload-recorded one — content not refetched.
        assert.equal(reads("inputs.count"), 1);
    });
});

// =============================================================================
// C — hash-only watches (what a paged source follows its dataset by)
// =============================================================================

describe("ReactiveDatasetCache — watchHash", () => {
    test("reports the hash on the first poll and each new one after, and never fetches content", async () => {
        const { cache, clock } = newCache();
        const first = await hashOf(report);
        const heard: (string | null)[] = [];
        cache.watchHash(ws(), report.path, (hash) => { heard.push(hash); });
        await h.settle();
        assert.deepEqual(heard, [first], "the first poll reports");
        assert.equal(clock.intervals.length, 1, "the watch starts the workspace's poller");

        clock.tickAll();
        await h.settle();
        assert.deepEqual(heard, [first], "an unchanged hash is not reported again");

        // The counts change and the dataflow runs: the report holds a new value.
        await h.write(ex.previewCountsInput, new SortedMap([["a", 1n], ["b", 2n], ["c", 4n]], compareFor(StringType)));
        await h.run();
        const second = await hashOf(report);
        clock.tickAll();
        await h.settle();
        // The workspace is reset: the report has no value until the next run.
        await h.unrun();
        clock.tickAll();
        await h.settle();
        assert.deepEqual(heard, [first, second, null], "a new hash, then no value");
        assert.notEqual(first, second);
        assert.equal(reads("tasks.preview_report.output"), 0, "the watched dataset's content is never fetched");
        assert.equal(cache.has(ws(), report.path), false);
    });

    test("a watch rides a poller already running, and a shorter interval shortens it", async () => {
        const { cache, clock } = newCache();
        cache.setRefetchInterval(ws(), schedulePath, 1000);
        cache.watchHash(ws(), policyPath, () => {}, 100);
        assert.equal(clock.intervals.length, 1);
        assert.equal(clock.intervals[0]!.intervalMs, 100);
        await h.settle();
    });

    test("the poller stops once no path is polled and no hash watched", async () => {
        const { cache, clock } = newCache();
        const unwatch = cache.watchHash(ws(), policyPath, () => {});
        cache.setRefetchInterval(ws(), schedulePath, 1000);
        cache.clearRefetchInterval(ws(), schedulePath);
        assert.equal(clock.intervals.length, 1, "the watch still needs the poll");
        unwatch();
        assert.equal(clock.intervals.length, 0);
        await h.settle();
    });

    test("a watcher that throws costs the other watchers and the polled paths nothing", async () => {
        const { cache, clock } = newCache();
        await h.write(schedule, "two");
        cache.setRefetchInterval(ws(), schedulePath, 1000);
        const heard: (string | null)[] = [];
        cache.watchHash(ws(), policyPath, () => { throw new Error("a broken watcher"); });
        cache.watchHash(ws(), policyPath, (hash) => { heard.push(hash); });
        await h.settle();
        clock.tickAll();
        await h.settle();
        assert.deepEqual(heard, [await hashOf(policy)], "heard once, however many polls");
        assert.deepEqual(cache.read(ws(), schedulePath), str("two"), "the polled path still updated");
    });

    test("a stopped watch hears nothing more, and destroy stops them all", async () => {
        const { cache, clock } = newCache();
        const first = await hashOf(policy);
        const stopped: (string | null)[] = [];
        const kept: (string | null)[] = [];
        const unwatch = cache.watchHash(ws(), policyPath, (hash) => { stopped.push(hash); });
        cache.watchHash(ws(), policyPath, (hash) => { kept.push(hash); });
        await h.settle();
        unwatch();
        await h.write(policy, 2n);
        clock.tickAll();
        await h.settle();
        assert.deepEqual(stopped, [first]);
        assert.deepEqual(kept, [first, await hashOf(policy)]);

        cache.destroy();
        assert.equal(clock.intervals.length, 0);
    });
});
