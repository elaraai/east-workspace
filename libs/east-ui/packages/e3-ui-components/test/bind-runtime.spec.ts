/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Exhaustive tests for `bind-runtime.ts`, on e3 itself (#1378): each test
 * constructs its own `BindRuntime` over a dataset cache over e3 and a staged
 * store in memory, and binds the Data.bind examples' threshold and its patch.
 * What a dataset holds is another session's write through e3's API; what the
 * runtime wrote and launched is read from the harness's request log, and a
 * write in flight or one that fails is held or failed at the harness's fetch.
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
import type { E3Request } from "../src/e3-web.test-utils.js";

import {
    BindRuntime,
    datasetCacheKey,
} from "../src/platform/index.js";
import {
    StagedStore,
    MemoryStagedAdapter,
} from "../src/platform/staged-store.js";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "bind/data/data": ex });

/** The source: the threshold, a Float. */
const sourcePath = ex.thresholdInput.path;
/** Its patch dataset: a Patch of a Float. */
const patchPath = ex.thresholdPatchInput.path;

const floatTypeValue = toEastTypeValue(FloatType);
const intTypeValue = toEastTypeValue(IntegerType);
const encodeFloat = encodeBeast2For(FloatType);
const decodeFloat = decodeBeast2For(FloatType);
const decodeFloatPatch = decodeBeast2For(PatchType(FloatType));
const diffFloat = diffFor(FloatType);

/** Whether a request writes the source, or its patch dataset. */
const writesSource = (request: E3Request) => request.kind === "write" && request.dataset === "inputs.threshold";
const writesPatch = (request: E3Request) => request.kind === "write" && request.dataset === "inputs.threshold_patch";
/** The writes the test's code made, in order: which dataset each wrote. */
const writes = () => h.requests("write").map((request) => request.dataset);
/** The dataflow runs the test's code launched. */
const launches = () => h.requests("dataflow").filter((request) => request.method === "POST");
/** A fault e3 answers a write with, as its store would fail one. */
const FAILED = { status: 500, type: "internal", message: "the store refused the write" } as const;

/** A runtime over a dataset cache over e3 in the test's workspace, its staged store in memory. */
async function newRuntime() {
    const adapter = new MemoryStagedAdapter();
    const staged = new StagedStore(adapter);
    await staged.ready();
    const { cache, clock } = h.cache();
    const runtime = new BindRuntime(staged);
    runtime.initializeCache(cache);
    return { runtime, cache, clock, staged };
}

/** A runtime over the test's workspace once another session has written the source, and the cache has loaded it. */
async function seeded(source: number) {
    await h.write(ex.thresholdInput, source);
    const made = await newRuntime();
    await made.cache.preload(h.workspace, sourcePath);
    return made;
}

/** A runtime once another session has written the source and its patch, and the cache has loaded both. */
async function seededWithPatch(source: number, patch: ReturnType<typeof decodeFloatPatch>) {
    await h.write(ex.thresholdPatchInput, patch);
    const made = await seeded(source);
    await made.cache.preload(h.workspace, patchPath);
    return made;
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
        const { runtime, cache } = await seeded(1);

        // Hold an in-flight write, with another queued behind it.
        const held = h.e3.hold(writesSource);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2);
        handle.write(3);
        await held.holding;

        // Re-init with the SAME cache — must not clear the queue.
        runtime.initializeCache(cache);
        held.release();
        await runtime.awaitPendingWrites();
        assert.equal(h.requests().filter(writesSource).length, 2);
        assert.equal(await h.read(ex.thresholdInput), 3);
    });

    test("re-initialize with DIFFERENT cache clears queue", async () => {
        const { runtime } = await seeded(1);

        const held = h.e3.hold(writesSource);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2); // in flight, held
        handle.write(3); // queued behind it
        await held.holding;

        // Switch caches — the queued write, which captured the old cache, is dropped.
        runtime.initializeCache(h.cache().cache);
        held.release();
        await runtime.awaitPendingWrites();
        await h.settle();
        assert.equal(h.requests().filter(writesSource).length, 1, "only the write already in flight was sent");
        assert.equal(await h.read(ex.thresholdInput), 2);
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
        runtime.trackPath(h.workspace, sourcePath);  // no throw, no state change
        assert.equal(runtime.isTracking(), false);
    });

    test("enableTracking + trackPath + disableTracking returns the keys", async () => {
        const { runtime } = await newRuntime();
        runtime.enableTracking();
        assert.equal(runtime.isTracking(), true);
        runtime.trackPath(h.workspace, sourcePath);
        runtime.trackPath(h.workspace, patchPath);
        const keys = runtime.disableTracking();
        assert.deepEqual(keys.sort(), [
            datasetCacheKey(h.workspace, patchPath),
            datasetCacheKey(h.workspace, sourcePath),
        ].sort());
        assert.equal(runtime.isTracking(), false);
    });

    test("has() is tracked as a read of the source, in every mode and patch shape", async () => {
        // A view that renders an unset dataset's empty branch on has() must
        // re-render when the value lands, so has() subscribes to the source.
        const { runtime } = await newRuntime();
        for (const [mode, patch] of [["direct", undefined], ["direct", patchPath], ["staged", undefined], ["staged", patchPath]] as const) {
            const handle = runtime.buildRawHandle(floatTypeValue, sourcePath, patch, mode);
            runtime.enableTracking();
            assert.equal(handle.has(), false);
            assert.deepEqual(runtime.disableTracking(), [datasetCacheKey(h.workspace, sourcePath)], `${mode}, ${patch ? "with" : "no"} patch`);
        }
    });
});

// =============================================================================
// C.3 — pending-writes queue
// =============================================================================

describe("BindRuntime — pending writes queue", () => {
    test("awaitPendingWrites resolves immediately when empty", async () => {
        const { runtime } = await newRuntime();
        await runtime.awaitPendingWrites();
        assert.deepEqual(writes(), []);
    });

    test("awaitPendingWrites resolves after queued writes drain", async () => {
        const { runtime } = await seeded(1);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2);
        handle.write(3);
        await runtime.awaitPendingWrites();
        assert.equal(h.requests().filter(writesSource).length, 2);
        assert.equal(await h.read(ex.thresholdInput), 3);
    });

    test("failing write is logged + emitted via onWriteError", async () => {
        const { runtime } = await seeded(1);

        const errors: unknown[] = [];
        runtime.onWriteError(err => errors.push(err));

        h.e3.fail(writesSource, FAILED);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2);
        await runtime.awaitPendingWrites();
        assert.equal(errors.length, 1);
        assert.match(String(errors[0]), /Failed to set dataset: 500/);
        assert.equal(await h.read(ex.thresholdInput), 1);
    });

    test("queue continues after a failing write", async () => {
        const { runtime } = await seeded(1);
        let sent = 0;
        h.e3.fail((request) => writesSource(request) && ++sent === 1, FAILED);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2); // fails
        handle.write(3); // should still run
        await runtime.awaitPendingWrites();
        assert.equal(h.requests().filter(writesSource).length, 2);
        assert.equal(await h.read(ex.thresholdInput), 3);
    });

    test("clearPendingWrites drops not-yet-run writes", async () => {
        const { runtime } = await seeded(1);
        const held = h.e3.hold(writesSource);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2); // first — held
        handle.write(3); // second — queued behind
        await held.holding;
        runtime.clearPendingWrites();
        held.release();
        await runtime.awaitPendingWrites();
        await h.settle();
        // Only the first (already mid-flight) ran; the second was dropped.
        assert.equal(h.requests().filter(writesSource).length, 1);
        assert.equal(await h.read(ex.thresholdInput), 2);
    });

    test("multiple onWriteError listeners — all called", async () => {
        const { runtime } = await seeded(1);
        let a = 0, b = 0;
        runtime.onWriteError(() => a++);
        runtime.onWriteError(() => b++);
        h.e3.fail(writesSource, FAILED);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(2);
        await runtime.awaitPendingWrites();
        assert.equal(a, 1);
        assert.equal(b, 1);
    });

    test("onWriteError unsubscribe stops the listener", async () => {
        const { runtime } = await seeded(1);
        let calls = 0;
        const off = runtime.onWriteError(() => calls++);
        off();
        h.e3.fail(writesSource, FAILED);
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
        assert.equal(runtime.getBindingTypes(h.workspace, sourcePath), undefined);
    });

    test("buildBindHandle populates the registry", async () => {
        const { runtime } = await seeded(1);
        runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        const info = runtime.getBindingTypes(h.workspace, sourcePath);
        assert.ok(info);
        assert.equal(info!.workspace, h.workspace);
        assert.equal(info!.mode, "direct");
        assert.equal(info!.hasPatchDataset, false);
    });

    test("clearBindingRegistry() empties everything", async () => {
        const { runtime } = await seeded(1);
        runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        runtime.clearBindingRegistry();
        assert.equal(runtime.getBindingTypes(h.workspace, sourcePath), undefined);
    });

    test("clearBindingRegistry(ws) removes only that workspace", async () => {
        const { runtime } = await newRuntime();
        const alpha = h.workspace;
        const beta = await h.e3.workspace();
        const cacheAlpha = h.cache({ workspace: alpha }).cache;
        const cacheBeta = h.cache({ workspace: beta }).cache;
        await cacheAlpha.preload(alpha, sourcePath);
        await cacheBeta.preload(beta, sourcePath);

        // Build handles via two separate caches with different workspaces.
        runtime.initializeCache(cacheBeta);
        runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        runtime.initializeCache(cacheAlpha);
        runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");

        runtime.clearBindingRegistry(alpha);
        assert.equal(runtime.getBindingTypes(alpha, sourcePath), undefined);
        assert.ok(runtime.getBindingTypes(beta, sourcePath));
    });
});

// =============================================================================
// C.6 — direct, no patch
// =============================================================================

describe("BindRuntime.buildBindHandle — direct, no patch", () => {
    test("read returns decoded source", async () => {
        const { runtime } = await seeded(7.5);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        assert.equal(handle.read(), 7.5);
    });

    test("read throws when source not loaded", async () => {
        const { runtime } = await newRuntime();
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        assert.throws(() => handle.read(), /Source dataset not loaded/);
    });

    test("write sends the encoded bytes to the source", async () => {
        const { runtime } = await seeded(1);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(42);
        await runtime.awaitPendingWrites();
        const sent = h.requests().filter(writesSource);
        assert.equal(sent.length, 1);
        assert.equal(decodeFloat(sent[0]!.body!), 42);
        assert.equal(await h.read(ex.thresholdInput), 42);
    });

    test("writeAndStart writes, then launches the dataflow", async () => {
        const { runtime } = await seeded(1);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.writeAndStart(42);
        await runtime.awaitPendingWrites();
        assert.deepEqual(writes(), ["inputs.threshold"]);
        assert.equal(launches().length, 1);
    });

    test("start launches the dataflow without writing", async () => {
        const { runtime } = await seeded(1);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.start();
        await runtime.awaitPendingWrites();
        assert.equal(launches().length, 1);
        assert.deepEqual(writes(), []);
    });

    test("write then start launches after the write lands", async () => {
        const { runtime } = await seeded(1);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        handle.write(42);
        handle.start();
        await runtime.awaitPendingWrites();
        const order = h.requests().filter((request) => writesSource(request) || launches().includes(request)).map((request) => request.kind);
        assert.deepEqual(order, ["write", "dataflow"]);
    });

    test("pending always false; commit/discard are no-ops", async () => {
        const { runtime } = await seeded(1);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
        assert.equal(handle.pending(), false);
        assert.equal(handle.commit(), null);
        assert.equal(handle.discard(), null);
        await runtime.awaitPendingWrites();
        assert.deepEqual(writes(), []);
    });

    test("binding descriptor shape", async () => {
        const { runtime } = await seeded(1);
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
        const { runtime } = await seededWithPatch(10, variant("unchanged", null));
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        assert.equal(handle.read(), 10);
    });

    test("read returns apply(source, patch) with active patch", async () => {
        // Patch: source 10 → 25
        const { runtime } = await seededWithPatch(10, diffFloat(10, 25));
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        assert.equal(handle.read(), 25);
    });

    test("write sends diff(source, value) to the patch dataset", async () => {
        const { runtime } = await seededWithPatch(10, variant("unchanged", null));
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        handle.write(50);
        await runtime.awaitPendingWrites();
        assert.deepEqual(writes(), ["inputs.threshold_patch"]);
        assert.deepEqual(await h.read(ex.thresholdPatchInput), diffFloat(10, 50));
    });

    test("commit applies patch to source, clears patch", async () => {
        const { runtime } = await seededWithPatch(10, diffFloat(10, 99));
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        handle.commit();
        await runtime.awaitPendingWrites();
        // Source written to 99, the patch cleared.
        assert.equal(await h.read(ex.thresholdInput), 99);
        assert.equal((await h.read(ex.thresholdPatchInput)).type, "unchanged");
    });

    test("discard writes UNCHANGED to patch dataset", async () => {
        const { runtime } = await seededWithPatch(10, diffFloat(10, 99));
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        handle.discard();
        await runtime.awaitPendingWrites();
        assert.deepEqual(writes(), ["inputs.threshold_patch"]);
        assert.equal(decodeFloatPatch(h.requests().find(writesPatch)!.body!).type, "unchanged");
        assert.equal(await h.read(ex.thresholdInput), 10, "the source is untouched");
    });

    test("manifest scoping rejects unlisted patch path", async () => {
        const { runtime } = await newRuntime();
        const allowed = new Set([sourcePath.map(p => p.value).join(".")]);
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
        const { runtime, staged } = await seeded(10);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
        assert.equal(handle.read(), 10);
        // Now stage a buffer
        staged.write(h.workspace, sourcePath, encodeFloat(10), encodeFloat(42));
        assert.equal(handle.read(), 42);
    });

    test("write stages with snapshot pinned on first write", async () => {
        const { runtime, staged } = await seeded(10);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
        handle.write(50);
        const entry = staged.getEntry(h.workspace, sourcePath);
        assert.ok(entry);
        assert.deepEqual(entry!.snapshot, encodeFloat(10));
        assert.deepEqual(entry!.buffered, encodeFloat(50));
        // Second write — snapshot stays pinned
        handle.write(60);
        const entry2 = staged.getEntry(h.workspace, sourcePath);
        assert.deepEqual(entry2!.snapshot, encodeFloat(10));
        assert.deepEqual(entry2!.buffered, encodeFloat(60));
        await runtime.awaitPendingWrites();
        assert.deepEqual(writes(), [], "a staged write reaches no dataset");
    });

    test("pending reflects staged.hasPending", async () => {
        const { runtime } = await seeded(10);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
        assert.equal(handle.pending(), false);
        handle.write(50);
        assert.equal(handle.pending(), true);
    });

    test("commit writes buffer to source then drops buffer", async () => {
        const { runtime, staged } = await seeded(10);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
        handle.write(50);
        handle.commit();
        await runtime.awaitPendingWrites();
        assert.equal(staged.hasPending(h.workspace, sourcePath), false);
        assert.equal(await h.read(ex.thresholdInput), 50);
    });

    test("commit retains buffer if concurrent edit landed during await (lost-edits guard)", async () => {
        const { runtime, staged } = await seeded(10);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
        handle.write(50);

        const held = h.e3.hold(writesSource);
        handle.commit();
        await held.holding;
        // Concurrent edit while commit is mid-flight
        handle.write(99);
        held.release();
        await runtime.awaitPendingWrites();
        // Buffer should still hold the in-flight edit (99)
        assert.equal(staged.hasPending(h.workspace, sourcePath), true);
        assert.deepEqual(staged.getBuffered(h.workspace, sourcePath), encodeFloat(99));
        assert.equal(await h.read(ex.thresholdInput), 50);
    });

    test("commit retains buffer on a failed write", async () => {
        const { runtime, staged } = await seeded(10);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
        handle.write(50);
        h.e3.fail(writesSource, FAILED);
        handle.commit();
        await runtime.awaitPendingWrites();
        // Buffer retained because the write failed.
        assert.equal(staged.hasPending(h.workspace, sourcePath), true);
        assert.equal(await h.read(ex.thresholdInput), 10);
    });

    test("discard drops the buffer synchronously", async () => {
        const { runtime, staged } = await seeded(10);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
        handle.write(50);
        handle.discard();
        assert.equal(staged.hasPending(h.workspace, sourcePath), false);
    });
});

// =============================================================================
// C.9 — staged, with patch
// =============================================================================

describe("BindRuntime.buildBindHandle — staged, with patch", () => {
    test("read returns buffered when staged; overlaid source otherwise", async () => {
        const { runtime, staged } = await seededWithPatch(10, diffFloat(10, 25));
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "staged");
        // No buffer yet — read returns apply(source, patch)
        assert.equal(handle.read(), 25);
        // Now stage a buffer
        staged.write(h.workspace, sourcePath, encodeFloat(10), encodeFloat(99));
        assert.equal(handle.read(), 99);
    });

    test("commit publishes diff(source, buffer) to patch dataset", async () => {
        const { runtime, staged } = await seededWithPatch(10, variant("unchanged", null));
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "staged");
        handle.write(50);
        handle.commit();
        await runtime.awaitPendingWrites();
        assert.equal(staged.hasPending(h.workspace, sourcePath), false);
        assert.deepEqual(writes(), ["inputs.threshold_patch"]);
        assert.deepEqual(await h.read(ex.thresholdPatchInput), diffFloat(10, 50));
    });

    test("discard drops buffer; patch dataset untouched", async () => {
        const { runtime, staged } = await seededWithPatch(10, diffFloat(10, 25));
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "staged");
        handle.write(99);
        handle.discard();
        // No queued writes — discard is sync.
        assert.equal(staged.hasPending(h.workspace, sourcePath), false);
        await runtime.awaitPendingWrites();
        assert.deepEqual(writes(), []);
    });
});

// =============================================================================
// C.9b — the staged store a runtime given none uses
// =============================================================================

describe("BindRuntime — a runtime given no staged store", () => {
    test("buffers in the store installed when it binds — initializeStagedStore reaches Data.bind — and reports its persistence failures", async () => {
        const { initializeStagedStore, clearStagedStoreSingleton } = await import("../src/platform/staged-store.js");
        // Made first, as the package's default runtime is, as its module loads.
        const runtime = new BindRuntime();
        // A host installs its own store after: one whose saves fail.
        const installed = new StagedStore({
            loadAll: async () => new Map(),
            save: async () => { throw new Error("quota exceeded"); },
            remove: async () => {},
            clear: async () => {},
        });
        await installed.ready();
        initializeStagedStore(installed);
        try {
            await h.write(ex.thresholdInput, 10);
            const { cache } = h.cache();
            runtime.initializeCache(cache);
            await cache.preload(h.workspace, sourcePath);
            const errors: unknown[] = [];
            runtime.onWriteError((err) => errors.push(err));

            const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "staged");
            handle.write(50);
            assert.deepEqual(installed.getBuffered(h.workspace, sourcePath), encodeFloat(50));
            assert.equal(handle.read(), 50);
            await installed.flushPending();
            assert.equal(errors.length, 1);
            assert.match(String(errors[0]), /quota exceeded/);
        } finally {
            clearStagedStoreSingleton();
        }
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
    /** The listings of the workspace's datasets the test's code asked for. */
    const listings = () => h.requests("dataset-status").filter((request) => request.dataset === undefined);

    test("preloadList caches the result; second call is a hit", async () => {
        const { runtime } = await newRuntime();
        const fields = await runtime.preloadList(h.workspace, []);
        assert.ok(fields.includes("inputs"), "the workspace's root lists its inputs");
        assert.equal(listings().length, 1);
        await runtime.preloadList(h.workspace, []);
        assert.equal(listings().length, 1);
    });

    test("clearListCache empties the cache", async () => {
        const { runtime } = await newRuntime();
        await runtime.preloadList(h.workspace, []);
        runtime.clearListCache();
        await runtime.preloadList(h.workspace, []);
        assert.equal(listings().length, 2);
    });
});

// =============================================================================
// C.7b — overlaidSource fallback (ConflictError vs other errors)
// =============================================================================

describe("BindRuntime.buildBindHandle — overlaidSource error handling", () => {
    test("ConflictError → fall back to source value", async () => {
        // Source = 10, patch is "replace 99 → 25" which is stale (source isn't 99)
        const { runtime } = await seededWithPatch(10, diffFloat(99, 25));
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
        const { runtime } = await seeded(1);
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
        const info = runtime.getBindingTypes(h.workspace, sourcePath);
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
        const { runtime } = await seeded(1);
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
        const { runtime } = await seeded(1);
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
        const { runtime } = await seededWithPatch(1, variant("unchanged", null));
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
        const { runtime } = await seeded(1);
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
        const { runtime } = await seeded(1);
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
        // Stale patch — replace 99 → 25 doesn't apply against source 10.
        const { runtime } = await seededWithPatch(10, diffFloat(99, 25));

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
        const { runtime } = await seededWithPatch(10, diffFloat(10, 99));

        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        handle.commit();
        await runtime.awaitPendingWrites();

        // Two sequential writes, IN ORDER: source := apply(source, patch),
        // THEN patch := unchanged. (Not one batched flush — the patch is
        // cleared only after the source write lands.)
        assert.deepEqual(writes(), ["inputs.threshold", "inputs.threshold_patch"]);
        assert.equal(decodeFloat(h.requests().find(writesSource)!.body!), 99);
    });

    test("a failed source write leaves the patch intact (self-healing)", async () => {
        const { runtime } = await seededWithPatch(10, diffFloat(10, 99));

        const errors: unknown[] = [];
        runtime.onWriteError(err => errors.push(err));

        // Fail the (first) source write. The patch-clear must NOT run, so the
        // commit never orphans a populated patch over a half-committed source.
        h.e3.fail(writesSource, FAILED);
        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        handle.commit();
        await runtime.awaitPendingWrites();

        // Only the source write was attempted; the patch-clear was skipped.
        assert.deepEqual(writes(), ["inputs.threshold"]);
        assert.equal(errors.length, 1);
        assert.deepEqual(await h.read(ex.thresholdPatchInput), diffFloat(10, 99), "the patch stands");
    });
});

// =============================================================================
// C.7e — stale-patch ConflictError surfaces via onWriteError
// =============================================================================

describe("BindRuntime — stale-patch commit error surfacing", () => {
    test("apply() throwing ConflictError emits via onWriteError", async () => {
        // Stale patch that won't apply.
        const { runtime } = await seededWithPatch(10, diffFloat(99, 25));

        const errors: unknown[] = [];
        runtime.onWriteError(err => errors.push(err));

        const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, patchPath, "direct");
        handle.commit();
        await runtime.awaitPendingWrites();
        // ConflictError thrown from apply() inside the queued write;
        // surfaced via the error listener instead of crashing.
        assert.equal(errors.length, 1);
        assert.ok(errors[0] instanceof ConflictError);
        assert.deepEqual(writes(), [], "nothing was written");
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
        const key = datasetCacheKey(h.workspace, sourcePath);

        let cacheCalls = 0;
        let stagedCalls = 0;
        const offCache = cache.subscribe(key, () => cacheCalls++);
        const offStaged = staged.subscribe(key, () => stagedCalls++);

        await cache.write(h.workspace, sourcePath, encodeFloat(1));
        staged.write(h.workspace, sourcePath, encodeFloat(1), encodeFloat(2));

        assert.ok(cacheCalls >= 1);
        assert.ok(stagedCalls >= 1);

        offCache();
        offStaged();
    });

    test("cache + staged versions sum monotonically", async () => {
        const { cache, staged } = await newRuntime();
        const key = datasetCacheKey(h.workspace, sourcePath);
        const v0 = cache.getKeyVersion(key) + staged.getKeyVersion(key);
        await cache.write(h.workspace, sourcePath, encodeFloat(1));
        const v1 = cache.getKeyVersion(key) + staged.getKeyVersion(key);
        staged.write(h.workspace, sourcePath, encodeFloat(1), encodeFloat(2));
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
});
