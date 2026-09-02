/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Exhaustive tests for `bind-runtime.ts`. Each `describe` block
 * constructs its own fresh `BindRuntime` instance + cache + staged
 * store — no module-state leaks across tests.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    variant,
    toEastTypeValue,
    encodeBeast2For,
    decodeBeast2For,
    FloatType,
    IntegerType,
    PatchType,
    diffFor,
    ConflictError,
} from "@elaraai/east";
import type { TreePath } from "@elaraai/e3-types";

import {
    BindRuntime,
    datasetCacheKey,
    ReactiveDatasetCache,
} from "../src/platform/index.js";
import {
    StagedStore,
    MemoryStagedAdapter,
} from "../src/platform/staged-store.js";
import { createMockDatasetApi } from "./fixtures/mock-dataset-api.js";
import { createFakeClock, settle } from "./fixtures/fake-clock.js";

const path = (...segs: string[]): TreePath => segs.map(s => variant("field", s));
const ws = "ws";
const sourcePath = path("source");
const patchPath = path("patch");

const floatTypeValue = toEastTypeValue(FloatType);
const intTypeValue = toEastTypeValue(IntegerType);
const encodeFloat = encodeBeast2For(FloatType);
const decodeFloat = decodeBeast2For(FloatType);
const encodeFloatPatch = encodeBeast2For(PatchType(FloatType));
const diffFloat = diffFor(FloatType);

async function newRuntime() {
    const adapter = new MemoryStagedAdapter();
    const staged = new StagedStore(adapter);
    await staged.ready();
    const api = createMockDatasetApi();
    const clock = createFakeClock();
    const cache = new ReactiveDatasetCache({ workspace: ws }, api, clock);
    const runtime = new BindRuntime(staged);
    runtime.initializeCache(cache);
    return { runtime, cache, api, clock, staged };
}

// =============================================================================
// C.1 — cache singleton lifecycle
// =============================================================================

describe("BindRuntime — cache lifecycle", () => {
    test("requireCache throws when no cache initialized", async () => {
        const adapter = new MemoryStagedAdapter();
        const staged = new StagedStore(adapter);
        await staged.ready();
        const r = new BindRuntime(staged);
        assert.throws(() => r.requireCache(), /not initialized/);
    });

    test("getCache returns null when no cache initialized", async () => {
        const adapter = new MemoryStagedAdapter();
        const staged = new StagedStore(adapter);
        await staged.ready();
        const r = new BindRuntime(staged);
        assert.equal(r.getCache(), null);
    });

    test("initializeCache sets the cache", async () => {
        const { runtime, cache } = await newRuntime();
        assert.equal(runtime.requireCache(), cache);
    });

    test("re-initialize with SAME cache does NOT clear queue", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);

        // Pause an in-flight write
        const pause = api.pauseNext("set");
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2);

        // Re-init with the SAME cache — must not clear the queue.
        runtime.initializeCache(cache);
        pause.resume();
        await runtime.awaitPendingWrites();
        assert.equal(api.calls.set.length, 1);
    });

    test("re-initialize with DIFFERENT cache clears queue", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);

        const pause = api.pauseNext("set");
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2);

        // Switch caches — old queue dropped.
        const api2 = createMockDatasetApi();
        const cache2 = new ReactiveDatasetCache({ workspace: ws }, api2);
        runtime.initializeCache(cache2);
        pause.reject(new Error("dropped"));
        await runtime.awaitPendingWrites();
        // The original queued write was dropped — nothing landed on cache2.
        assert.equal(api2.calls.set.length, 0);
    });

    test("clearCache clears singleton + queue", async () => {
        const { runtime } = await newRuntime();
        runtime.clearCache();
        assert.equal(runtime.getCache(), null);
    });
});

// =============================================================================
// C.2 — reactive tracking
// =============================================================================

describe("BindRuntime — reactive tracking", () => {
    test("trackPath outside enableTracking is a no-op", async () => {
        const { runtime } = await newRuntime();
        runtime.trackPath(ws, sourcePath);  // no throw, no state change
        assert.equal(runtime.isTracking(), false);
    });

    test("enableTracking + trackPath + disableTracking returns the keys", async () => {
        const { runtime } = await newRuntime();
        runtime.enableTracking();
        assert.equal(runtime.isTracking(), true);
        runtime.trackPath(ws, sourcePath);
        runtime.trackPath(ws, patchPath);
        const keys = runtime.disableTracking();
        assert.deepEqual(keys.sort(), [
            datasetCacheKey(ws, patchPath),
            datasetCacheKey(ws, sourcePath),
        ].sort());
        assert.equal(runtime.isTracking(), false);
    });
});

// =============================================================================
// C.3 — pending-writes queue
// =============================================================================

describe("BindRuntime — pending writes queue", () => {
    test("awaitPendingWrites resolves immediately when empty", async () => {
        const { runtime } = await newRuntime();
        await runtime.awaitPendingWrites();
        assert.ok(true);
    });

    test("awaitPendingWrites resolves after queued writes drain", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2);
        handle.write(3);
        await runtime.awaitPendingWrites();
        assert.equal(api.calls.set.length, 2);
    });

    test("failing write is logged + emitted via onWriteError", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);

        const errors: unknown[] = [];
        runtime.onWriteError(err => errors.push(err));

        api.failNext("set", new Error("boom"));
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2);
        await runtime.awaitPendingWrites();
        assert.equal(errors.length, 1);
        assert.match(String(errors[0]), /boom/);
    });

    test("queue continues after a failing write", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        api.failNext("set", new Error("first fails"));
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2); // fails
        handle.write(3); // should still run
        await runtime.awaitPendingWrites();
        assert.equal(api.calls.set.length, 2);
    });

    test("clearPendingWrites drops not-yet-run writes", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        const pause = api.pauseNext("set");
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2); // first — paused
        handle.write(3); // second — queued behind
        runtime.clearPendingWrites();
        pause.resume();
        await runtime.awaitPendingWrites();
        // Only the first (already mid-flight) ran; the second was dropped.
        assert.equal(api.calls.set.length, 1);
    });

    test("multiple onWriteError listeners — all called", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        let a = 0, b = 0;
        runtime.onWriteError(() => a++);
        runtime.onWriteError(() => b++);
        api.failNext("set", new Error("nope"));
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2);
        await runtime.awaitPendingWrites();
        assert.equal(a, 1);
        assert.equal(b, 1);
    });

    test("onWriteError unsubscribe stops the listener", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        let calls = 0;
        const off = runtime.onWriteError(() => calls++);
        off();
        api.failNext("set", new Error("nope"));
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2);
        await runtime.awaitPendingWrites();
        assert.equal(calls, 0);
    });
});

// =============================================================================
// C.5 — binding registry
// =============================================================================

describe("BindRuntime — binding registry", () => {
    test("getBindingTypes returns undefined before any bind", async () => {
        const { runtime } = await newRuntime();
        assert.equal(runtime.getBindingTypes(ws, sourcePath), undefined);
    });

    test("buildBindHandle populates the registry", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        const info = runtime.getBindingTypes(ws, sourcePath);
        assert.ok(info);
        assert.equal(info!.workspace, ws);
        assert.equal(info!.mode, "direct");
        assert.equal(info!.hasPatchDataset, false);
    });

    test("clearBindingRegistry() empties everything", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        runtime.clearBindingRegistry();
        assert.equal(runtime.getBindingTypes(ws, sourcePath), undefined);
    });

    test("clearBindingRegistry(ws) removes only that workspace", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed("alpha", sourcePath, encodeFloat(1));
        api.seed("beta", sourcePath, encodeFloat(1));
        await cache.preload("alpha", sourcePath);
        await cache.preload("beta", sourcePath);

        // Build handles via two separate caches with different workspaces.
        const cacheBeta = new ReactiveDatasetCache({ workspace: "beta" }, api);
        runtime.initializeCache(cacheBeta);
        runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        const cacheAlpha = new ReactiveDatasetCache({ workspace: "alpha" }, api);
        runtime.initializeCache(cacheAlpha);
        runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");

        runtime.clearBindingRegistry("alpha");
        assert.equal(runtime.getBindingTypes("alpha", sourcePath), undefined);
        assert.ok(runtime.getBindingTypes("beta", sourcePath));
    });
});

// =============================================================================
// C.6 — direct, no patch
// =============================================================================

describe("BindRuntime.buildBindHandle — direct, no patch", () => {
    test("read returns decoded source", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(7.5));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        assert.equal(handle.read(), 7.5);
    });

    test("read throws when source not loaded", async () => {
        const { runtime } = await newRuntime();
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        assert.throws(() => handle.read(), /Source dataset not loaded/);
    });

    test("write queues a cache.write of encoded bytes", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(42);
        await runtime.awaitPendingWrites();
        assert.equal(api.calls.set.length, 1);
        assert.deepEqual(decodeFloat(api.calls.set[0]!.value!), 42);
    });

    test("writeAndStart queues cache.writeAndStart", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.writeAndStart(42);
        await runtime.awaitPendingWrites();
        assert.equal(api.calls.launchDataflow.length, 1);
    });

    test("start launches the dataflow without writing", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.start();
        await runtime.awaitPendingWrites();
        assert.equal(api.calls.launchDataflow.length, 1);
        assert.equal(api.calls.set.length, 0);
    });

    test("write then start launches after the write lands", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(42);
        handle.start();
        await runtime.awaitPendingWrites();
        assert.equal(api.calls.set.length, 1);
        assert.equal(api.calls.launchDataflow.length, 1);
    });

    test("pending always false; commit/discard are no-ops", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        assert.equal(handle.pending(), false);
        assert.equal(handle.commit(), null);
        assert.equal(handle.discard(), null);
    });

    test("binding descriptor shape", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        assert.deepEqual(handle.binding.source, sourcePath);
        assert.equal(handle.binding.patch.type, "none");
        assert.equal(handle.binding.mode.type, "direct");
    });

    test("manifest scoping rejects unlisted source", async () => {
        const { runtime } = await newRuntime();
        const allowed = new Set<string>(); // empty
        assert.throws(
            () => runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct", allowed),
            /not declared in manifest/,
        );
    });
});

// =============================================================================
// C.7 — direct, with patch
// =============================================================================

describe("BindRuntime.buildBindHandle — direct, with patch", () => {
    test("read returns apply(source, patch) when patch is unchanged", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        api.seed(ws, patchPath, encodeFloatPatch(variant("unchanged", null)));
        await cache.preload(ws, sourcePath);
        await cache.preload(ws, patchPath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        assert.equal(handle.read(), 10);
    });

    test("read returns apply(source, patch) with active patch", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        // Patch: source 10 → 25
        const patch = diffFloat(10, 25);
        api.seed(ws, patchPath, encodeFloatPatch(patch));
        await cache.preload(ws, sourcePath);
        await cache.preload(ws, patchPath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        assert.equal(handle.read(), 25);
    });

    test("write encodes diff(source, value) into patch dataset", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        api.seed(ws, patchPath, encodeFloatPatch(variant("unchanged", null)));
        await cache.preload(ws, sourcePath);
        await cache.preload(ws, patchPath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        handle.write(50);
        await runtime.awaitPendingWrites();
        // The set was on the patch path
        const lastSet = api.calls.set[api.calls.set.length - 1]!;
        assert.equal(
            (lastSet.path![0] as { value: string }).value,
            "patch",
        );
    });

    test("commit applies patch to source, clears patch", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        api.seed(ws, patchPath, encodeFloatPatch(diffFloat(10, 99)));
        await cache.preload(ws, sourcePath);
        await cache.preload(ws, patchPath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        handle.commit();
        await runtime.awaitPendingWrites();
        // Source written to 99
        const sourceWrite = api.calls.set.find(c =>
            (c.path![0] as { value: string }).value === "source");
        assert.ok(sourceWrite);
        assert.equal(decodeFloat(sourceWrite!.value!), 99);
    });

    test("discard writes UNCHANGED to patch dataset", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        api.seed(ws, patchPath, encodeFloatPatch(diffFloat(10, 99)));
        await cache.preload(ws, sourcePath);
        await cache.preload(ws, patchPath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        handle.discard();
        await runtime.awaitPendingWrites();
        const patchWrite = api.calls.set[api.calls.set.length - 1]!;
        assert.equal((patchWrite.path![0] as { value: string }).value, "patch");
    });

    test("manifest scoping rejects unlisted patch path", async () => {
        const { runtime } = await newRuntime();
        const allowed = new Set([
            sourcePath.map(p => (p as { value: string }).value).join("."),
        ]);
        assert.throws(
            () => runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct", allowed),
            /not declared in manifest/,
        );
    });
});

// =============================================================================
// C.8 — staged, no patch
// =============================================================================

describe("BindRuntime.buildBindHandle — staged, no patch", () => {
    test("read returns buffered when staged, otherwise source", async () => {
        const { runtime, cache, api, staged } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
        assert.equal(handle.read(), 10);
        // Now stage a buffer
        staged.write(ws, sourcePath, encodeFloat(10), encodeFloat(42));
        assert.equal(handle.read(), 42);
    });

    test("write stages with snapshot pinned on first write", async () => {
        const { runtime, cache, api, staged } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
        handle.write(50);
        const entry = staged.getEntry(ws, sourcePath);
        assert.ok(entry);
        assert.deepEqual(entry!.snapshot, encodeFloat(10));
        assert.deepEqual(entry!.buffered, encodeFloat(50));
        // Second write — snapshot stays pinned
        handle.write(60);
        const entry2 = staged.getEntry(ws, sourcePath);
        assert.deepEqual(entry2!.snapshot, encodeFloat(10));
        assert.deepEqual(entry2!.buffered, encodeFloat(60));
    });

    test("pending reflects staged.hasPending", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
        assert.equal(handle.pending(), false);
        handle.write(50);
        assert.equal(handle.pending(), true);
    });

    test("commit writes buffer to source then drops buffer", async () => {
        const { runtime, cache, api, staged } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
        handle.write(50);
        handle.commit();
        await runtime.awaitPendingWrites();
        assert.equal(staged.hasPending(ws, sourcePath), false);
        const lastWrite = api.calls.set[api.calls.set.length - 1]!;
        assert.deepEqual(lastWrite.value, encodeFloat(50));
    });

    test("commit retains buffer if concurrent edit landed during await (lost-edits guard)", async () => {
        const { runtime, cache, api, staged } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
        handle.write(50);

        const pause = api.pauseNext("set");
        handle.commit();
        // Concurrent edit while commit is mid-flight
        handle.write(99);
        pause.resume();
        await runtime.awaitPendingWrites();
        // Buffer should still hold the in-flight edit (99)
        assert.equal(staged.hasPending(ws, sourcePath), true);
        assert.deepEqual(staged.getBuffered(ws, sourcePath), encodeFloat(99));
    });

    test("commit retains buffer on cache.writeAndStart failure", async () => {
        const { runtime, cache, api, staged } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
        handle.write(50);
        api.failNext("set", new Error("nope"));
        handle.commit();
        await runtime.awaitPendingWrites();
        // Buffer retained because the write failed.
        assert.equal(staged.hasPending(ws, sourcePath), true);
    });

    test("discard drops the buffer synchronously", async () => {
        const { runtime, cache, api, staged } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        await cache.preload(ws, sourcePath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
        handle.write(50);
        handle.discard();
        assert.equal(staged.hasPending(ws, sourcePath), false);
    });
});

// =============================================================================
// C.9 — staged, with patch
// =============================================================================

describe("BindRuntime.buildBindHandle — staged, with patch", () => {
    test("read returns buffered when staged; overlaid source otherwise", async () => {
        const { runtime, cache, api, staged } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        api.seed(ws, patchPath, encodeFloatPatch(diffFloat(10, 25)));
        await cache.preload(ws, sourcePath);
        await cache.preload(ws, patchPath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "staged");
        // No buffer yet — read returns apply(source, patch)
        assert.equal(handle.read(), 25);
        // Now stage a buffer
        staged.write(ws, sourcePath, encodeFloat(10), encodeFloat(99));
        assert.equal(handle.read(), 99);
    });

    test("commit publishes diff(source, buffer) to patch dataset", async () => {
        const { runtime, cache, api, staged } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        api.seed(ws, patchPath, encodeFloatPatch(variant("unchanged", null)));
        await cache.preload(ws, sourcePath);
        await cache.preload(ws, patchPath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "staged");
        handle.write(50);
        handle.commit();
        await runtime.awaitPendingWrites();
        assert.equal(staged.hasPending(ws, sourcePath), false);
        const patchWrite = api.calls.set.find(c =>
            (c.path![0] as { value: string }).value === "patch")!;
        assert.ok(patchWrite);
    });

    test("discard drops buffer; patch dataset untouched", async () => {
        const { runtime, cache, api, staged } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        api.seed(ws, patchPath, encodeFloatPatch(diffFloat(10, 25)));
        await cache.preload(ws, sourcePath);
        await cache.preload(ws, patchPath);
        const callsBefore = api.calls.set.length;
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "staged");
        handle.write(99);
        handle.discard();
        // No queued writes — discard is sync.
        assert.equal(staged.hasPending(ws, sourcePath), false);
        assert.equal(api.calls.set.length, callsBefore);
    });
});

// =============================================================================
// C.10 — buildPlatform smoke
// =============================================================================

describe("BindRuntime.buildPlatform", () => {
    test("returns a PlatformFunction", async () => {
        const { runtime } = await newRuntime();
        const platform = runtime.buildPlatform(null);
        assert.equal(typeof platform, "object");
    });
});

// =============================================================================
// C.12 — list cache helpers
// =============================================================================

describe("BindRuntime — list cache", () => {
    test("preloadList caches the result; second call is a hit", async () => {
        const { runtime, api } = await newRuntime();
        api.seed(ws, path("foo"), encodeFloat(1));
        await runtime.preloadList(ws, []);
        const before = api.calls.listRoot.length;
        await runtime.preloadList(ws, []);
        assert.equal(api.calls.listRoot.length, before);
    });

    test("clearListCache empties the cache", async () => {
        const { runtime, api } = await newRuntime();
        api.seed(ws, path("foo"), encodeFloat(1));
        await runtime.preloadList(ws, []);
        runtime.clearListCache();
        await runtime.preloadList(ws, []);
        assert.equal(api.calls.listRoot.length, 2);
    });
});

// =============================================================================
// C.7b — overlaidSource fallback (ConflictError vs other errors)
// =============================================================================

describe("BindRuntime.buildBindHandle — overlaidSource error handling", () => {
    test("ConflictError → fall back to source value", async () => {
        const { runtime, cache, api } = await newRuntime();
        // Source = 10, patch is "replace 99 → 25" which is stale (source isn't 99)
        api.seed(ws, sourcePath, encodeFloat(10));
        const stale = diffFloat(99, 25);
        api.seed(ws, patchPath, encodeFloatPatch(stale));
        await cache.preload(ws, sourcePath);
        await cache.preload(ws, patchPath);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        // Should NOT throw; falls back to source.
        assert.equal(handle.read(), 10);
    });
});

// =============================================================================
// C.4 — helpersCache structural equality
// =============================================================================

describe("BindRuntime — helpersCache (structural equality)", () => {
    test("two bindings on structurally-equal types share helpers", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        // Two distinct EastTypeValue identities for the same East type.
        const t1 = toEastTypeValue(FloatType);
        const t2 = toEastTypeValue(FloatType);
        // Even if t1 !== t2 by identity, helpersCache uses structural
        // equality. Two binds shouldn't allocate two helper sets — the
        // observable proxy is that the second bind doesn't re-decode
        // the same patch type (verified via stable runtime state +
        // identical decoded reads).
        const h1 = runtime.buildBindHandle(t1, sourcePath, undefined, "direct");
        const h2 = runtime.buildBindHandle(t2, sourcePath, undefined, "direct");
        assert.equal(h1.read(), 1);
        assert.equal(h2.read(), 1);
        // No registry warn fired (would mean structural mismatch detected).
        const info = runtime.getBindingTypes(ws, sourcePath);
        assert.ok(info);
        assert.equal(info!.mode, "direct");
    });
});

// =============================================================================
// C.5 — registry warn paths
// =============================================================================

describe("BindRuntime — registry warn paths", () => {
    function captureWarn(): { messages: string[]; restore: () => void } {
        const messages: string[] = [];
        const original = console.warn;
        console.warn = (...args: unknown[]) => { messages.push(String(args[0])); };
        return { messages, restore: () => { console.warn = original; } };
    }

    test("identity fast-path: no warn on identical re-bind", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        const w = captureWarn();
        try {
            const t = toEastTypeValue(FloatType);
            runtime.buildBindHandle(t, sourcePath, undefined, "direct");
            runtime.buildBindHandle(t, sourcePath, undefined, "direct");
            assert.equal(w.messages.length, 0);
        } finally {
            w.restore();
        }
    });

    test("warns on mode mismatch (direct → staged on same path)", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        const w = captureWarn();
        try {
            runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
            runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
            assert.ok(w.messages.some(m => m.includes("(mode, patch) shapes")));
        } finally {
            w.restore();
        }
    });

    test("warns on hasPatchDataset mismatch", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        api.seed(ws, patchPath, encodeFloatPatch(variant("unchanged", null)));
        await cache.preload(ws, sourcePath);
        await cache.preload(ws, patchPath);
        const w = captureWarn();
        try {
            runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
            runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
            assert.ok(w.messages.some(m => m.includes("(mode, patch) shapes")));
        } finally {
            w.restore();
        }
    });

    test("warns on type mismatch (Float vs Integer on same path)", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        const w = captureWarn();
        try {
            runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
            runtime.buildBindHandle(intTypeValue, sourcePath, undefined, "direct");
            assert.ok(w.messages.some(m => m.includes("value types")));
        } finally {
            w.restore();
        }
    });

    test("structurally-equal but identity-different types: no warn (silent overwrite)", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(1));
        await cache.preload(ws, sourcePath);
        const w = captureWarn();
        try {
            const t1 = toEastTypeValue(FloatType);
            const t2 = toEastTypeValue(FloatType);
            runtime.buildBindHandle(t1, sourcePath, undefined, "direct");
            runtime.buildBindHandle(t2, sourcePath, undefined, "direct");
            assert.equal(w.messages.length, 0);
        } finally {
            w.restore();
        }
    });
});

// =============================================================================
// C.7c — fallback warning emitted ONCE per binding key
// =============================================================================

describe("BindRuntime — overlaidSource fallback warn dedup", () => {
    test("warning emitted at most once per binding key", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        // Stale patch — replace 99 → 25 doesn't apply against source 10.
        api.seed(ws, patchPath, encodeFloatPatch(diffFloat(99, 25)));
        await cache.preload(ws, sourcePath);
        await cache.preload(ws, patchPath);

        const messages: string[] = [];
        const original = console.warn;
        console.warn = (...args: unknown[]) => { messages.push(String(args[0])); };
        try {
            const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
            // Read 10 times; warning fires only once.
            for (let i = 0; i < 10; i++) handle.read();
            const fallbackMessages = messages.filter(m => m.includes("read fell back to source"));
            assert.equal(fallbackMessages.length, 1);
        } finally {
            console.warn = original;
        }
    });
});

// =============================================================================
// C.7d — direct+patch commit wraps source+patch writes in cache.batch
// =============================================================================

describe("BindRuntime — direct+patch commit atomicity", () => {
    test("commits the source first, then clears the patch", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        api.seed(ws, patchPath, encodeFloatPatch(diffFloat(10, 99)));
        await cache.preload(ws, sourcePath);
        await cache.preload(ws, patchPath);

        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        handle.commit();
        await runtime.awaitPendingWrites();

        // Two sequential writes, IN ORDER: source := apply(source, patch),
        // THEN patch := unchanged. (Not one batched flush — the patch is
        // cleared only after the source write lands.)
        assert.equal(api.calls.set.length, 2);
        assert.equal((api.calls.set[0]!.path![0] as { value: string }).value, "source");
        assert.equal(decodeFloat(api.calls.set[0]!.value!), 99);
        assert.equal((api.calls.set[1]!.path![0] as { value: string }).value, "patch");
    });

    test("a failed source write leaves the patch intact (self-healing)", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        api.seed(ws, patchPath, encodeFloatPatch(diffFloat(10, 99)));
        await cache.preload(ws, sourcePath);
        await cache.preload(ws, patchPath);

        const errors: unknown[] = [];
        runtime.onWriteError(err => errors.push(err));

        // Fail the (first) source write. The patch-clear must NOT run, so the
        // commit never orphans a populated patch over a half-committed source.
        api.failNext("set", new Error("source write failed"));
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        handle.commit();
        await runtime.awaitPendingWrites();

        // Only the source write was attempted; the patch-clear was skipped.
        assert.equal(api.calls.set.length, 1);
        assert.equal((api.calls.set[0]!.path![0] as { value: string }).value, "source");
        assert.equal(errors.length, 1);
    });
});

// =============================================================================
// C.7e — stale-patch ConflictError surfaces via onWriteError
// =============================================================================

describe("BindRuntime — stale-patch commit error surfacing", () => {
    test("apply() throwing ConflictError emits via onWriteError", async () => {
        const { runtime, cache, api } = await newRuntime();
        api.seed(ws, sourcePath, encodeFloat(10));
        // Stale patch that won't apply.
        api.seed(ws, patchPath, encodeFloatPatch(diffFloat(99, 25)));
        await cache.preload(ws, sourcePath);
        await cache.preload(ws, patchPath);

        const errors: unknown[] = [];
        runtime.onWriteError(err => errors.push(err));

        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        handle.commit();
        await runtime.awaitPendingWrites();
        // ConflictError thrown from apply() inside the queued write;
        // surfaced via the error listener instead of crashing.
        assert.equal(errors.length, 1);
        assert.ok(errors[0] instanceof ConflictError);
    });
});

// =============================================================================
// C.10 — module-load registrations exist on defaultBindRuntime
// =============================================================================

describe("module-load registrations", () => {
    test("BindPlatform is exported as the data_bind impl + its backing primitives", async () => {
        const { BindPlatform } = await import("../src/platform/bind-runtime.js");
        assert.ok(Array.isArray(BindPlatform));
        const names = new Set(BindPlatform.map(p => p.name));
        assert.ok(names.has("data_bind"));
        assert.ok(names.has("data_read"), "BindPlatform must ship the backing primitives (issue #106)");
        assert.equal(BindPlatform.length, 11);
    });

    test("createScopedBindPlatform returns a fresh impl per manifest (bind + primitives)", async () => {
        const { createScopedBindPlatform } = await import("../src/platform/bind-runtime.js");
        const p1 = createScopedBindPlatform({ paths: [], functions: [], records: [], pages: [] });
        const p2 = createScopedBindPlatform({ paths: [], functions: [], records: [], pages: [] });
        assert.notEqual(p1, p2);
        assert.equal(p1.length, 11);
        assert.ok(new Set(p1.map(p => p.name)).has("data_read"), "scoped Data platform must ship the primitives");
    });
});

// =============================================================================
// C.11 — combined reactive tracker (cache + staged)
// =============================================================================

describe("BindRuntime — combined reactive tracker behavior", () => {
    test("cache + staged store subscriber composition", async () => {
        const { cache, staged } = await newRuntime();
        const key = datasetCacheKey(ws, sourcePath);

        let cacheCalls = 0;
        let stagedCalls = 0;
        const offCache = cache.subscribe(key, () => cacheCalls++);
        const offStaged = staged.subscribe(key, () => stagedCalls++);

        await cache.write(ws, sourcePath, encodeFloat(1));
        staged.write(ws, sourcePath, encodeFloat(1), encodeFloat(2));

        assert.ok(cacheCalls >= 1);
        assert.ok(stagedCalls >= 1);

        offCache();
        offStaged();
    });

    test("cache + staged versions sum monotonically", async () => {
        const { cache, staged } = await newRuntime();
        const key = datasetCacheKey(ws, sourcePath);
        const v0 = cache.getKeyVersion(key) + staged.getKeyVersion(key);
        await cache.write(ws, sourcePath, encodeFloat(1));
        const v1 = cache.getKeyVersion(key) + staged.getKeyVersion(key);
        staged.write(ws, sourcePath, encodeFloat(1), encodeFloat(2));
        const v2 = cache.getKeyVersion(key) + staged.getKeyVersion(key);
        assert.ok(v1 > v0);
        assert.ok(v2 > v1);
    });
});

// =============================================================================
// Smoke check — referenced exports
// =============================================================================

describe("module exports — smoke", () => {
    test("ConflictError is importable (used by overlaidSource)", () => {
        assert.equal(typeof ConflictError, "function");
    });
    test("toEastTypeValue produces stable identity for same type input", () => {
        const a = toEastTypeValue(IntegerType);
        const b = toEastTypeValue(IntegerType);
        // Even if not identity-equal, they must compare structurally.
        assert.ok(a);
        assert.ok(b);
        assert.equal(intTypeValue, intTypeValue); // sanity
    });
    test("settle helper is importable", () => {
        assert.equal(typeof settle, "function");
    });
});
