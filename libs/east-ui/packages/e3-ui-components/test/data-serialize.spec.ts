/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Regression tests for issue #106 — a `Data.bind` handle (and any callback that
 * captures one) must survive beast2 encode → decode and re-bind to the DECODER's
 * dataset cache / api.
 *
 * The fix makes every handle method an IR-bearing `East.function` over `data_*`
 * primitives, capturing only the plain-data `{source, patch, mode}` descriptor
 * (the source type rides as a type-arg). The host work (the mode×patch matrix +
 * async write queue) stays in the primitive impls, which resolve cache/workspace
 * live — so a decoded handle re-binds to the decoder's cache.
 *
 * On e3 itself (#1378): the source is the Data.bind examples' threshold, and
 * the encoder and the decoder each read a workspace of their own, so what a
 * decoded handle reads and writes is the decoder's workspace's.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { toEastTypeValue, encodeBeast2For, decodeBeast2For, FloatType } from "@elaraai/east";
import { DataBindHandleType, type DataManifest } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { readDataset, writeDataset } from "../src/e3-web.test-utils.js";
import { BindRuntime } from "../src/platform/index.js";
import { createScopedBindPlatform } from "../src/platform/bind-runtime.js";
import { StagedStore, MemoryStagedAdapter } from "../src/platform/staged-store.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "bind/data/data": ex });

const sourcePath = ex.thresholdInput.path;
const floatTypeValue = toEastTypeValue(FloatType);
const HandleType = DataBindHandleType(FloatType);

/**
 * A bind runtime over a dataset cache over e3, its staged buffers in memory.
 *
 * @param workspace - The workspace it reads; the test's own unless given
 */
async function newRuntime(workspace?: string) {
    const staged = new StagedStore(new MemoryStagedAdapter());
    await staged.ready();
    const { cache } = h.cache(workspace === undefined ? {} : { workspace });
    const runtime = new BindRuntime(staged);
    runtime.initializeCache(cache);
    return { runtime, cache, staged };
}

test("#106 — a Data.bind handle ENCODES (its methods carry IR)", async () => {
    const { runtime } = await newRuntime();
    const handle = runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct");
    // Today: throws "Cannot serialize function: no IR attached".
    assert.doesNotThrow(() => encodeBeast2For(HandleType)(handle as never));
});

test("#106 — read() round-trips and re-binds to the DECODER's cache", async () => {
    const enc = await newRuntime();
    const bytes = encodeBeast2For(HandleType)(
        enc.runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct") as never);

    const other = await h.e3.workspace();
    await writeDataset(h.e3, other, ex.thresholdInput, 7);
    const dec = await newRuntime(other);
    await dec.cache.preload(other, sourcePath);
    const decoded = decodeBeast2For(HandleType, { platform: dec.runtime.buildPrimitives() })(bytes) as unknown as { read: () => number };
    assert.equal(decoded.read(), 7, "the decoder's workspace's value, not the encoder's 50");
});

test("#106 — write() round-trips and re-binds to the DECODER's api", async () => {
    const enc = await newRuntime();
    const bytes = encodeBeast2For(HandleType)(
        enc.runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct") as never);

    const other = await h.e3.workspace();
    const dec = await newRuntime(other);
    await dec.cache.preload(other, sourcePath);
    const decoded = decodeBeast2For(HandleType, { platform: dec.runtime.buildPrimitives() })(bytes) as unknown as { write: (v: number) => null };
    decoded.write(5);
    await dec.runtime.awaitPendingWrites();
    assert.deepEqual(h.e3.requests.filter((request) => request.kind === "write").map((request) => request.workspace), [other],
        "the write reached the decoder's workspace");
    assert.equal(await readDataset(h.e3, other, ex.thresholdInput), 5);
    assert.equal(await h.read(ex.thresholdInput), 50, "the encoder's workspace is untouched");
});

test("#106 — createScopedBindPlatform ships the backing primitives (e3 ui() task decode path)", () => {
    const manifest = { paths: [sourcePath], functions: [], records: [], pages: [] } as unknown as DataManifest;
    const names = new Set(createScopedBindPlatform(manifest).map(p => p.name));
    for (const name of [
        "data_bind", "data_read", "data_source", "data_write", "data_write_and_start",
        "data_start", "data_pending", "data_commit", "data_discard", "data_has", "data_status",
    ]) {
        assert.ok(names.has(name), `scoped Data platform must include '${name}'`);
    }
});
