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
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { variant, toEastTypeValue, encodeBeast2For, decodeBeast2For, FloatType } from "@elaraai/east";
import type { TreePath } from "@elaraai/e3-types";
import { DataBindHandleType, type DataManifest } from "@elaraai/e3-ui/internal";
import { BindRuntime, ReactiveDatasetCache } from "../src/platform/index.js";
import { createScopedBindPlatform } from "../src/platform/bind-runtime.js";
import { StagedStore, MemoryStagedAdapter } from "../src/platform/staged-store.js";
import { createMockDatasetApi } from "./fixtures/mock-dataset-api.js";
import { createFakeClock, settle } from "./fixtures/fake-clock.js";

const pathOf = (...segs: string[]): TreePath => segs.map(s => variant("field", s));
const ws = "ws";
const sourcePath = pathOf("source");
const floatTypeValue = toEastTypeValue(FloatType);
const encodeFloat = encodeBeast2For(FloatType);
const HandleType = DataBindHandleType(FloatType);

async function newRuntime() {
    const staged = new StagedStore(new MemoryStagedAdapter());
    await staged.ready();
    const api = createMockDatasetApi();
    const clock = createFakeClock();
    const cache = new ReactiveDatasetCache({ workspace: ws }, api, clock);
    const runtime = new BindRuntime(staged);
    runtime.initializeCache(cache);
    return { runtime, cache, api, clock, staged };
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

    const dec = await newRuntime();
    dec.api.seed(ws, sourcePath, encodeFloat(7));
    await dec.cache.preload(ws, sourcePath);
    const decoded = decodeBeast2For(HandleType, { platform: dec.runtime.buildPrimitives() })(bytes) as unknown as { read: () => number };
    assert.equal(decoded.read(), 7);
});

test("#106 — write() round-trips and re-binds to the DECODER's api", async () => {
    const enc = await newRuntime();
    const bytes = encodeBeast2For(HandleType)(
        enc.runtime.buildBindHandle(floatTypeValue, sourcePath, undefined, "direct") as never);

    const dec = await newRuntime();
    dec.api.seed(ws, sourcePath, encodeFloat(1));
    await dec.cache.preload(ws, sourcePath);
    const decoded = decodeBeast2For(HandleType, { platform: dec.runtime.buildPrimitives() })(bytes) as unknown as { write: (v: number) => null };
    decoded.write(5);
    await settle();
    assert.equal(dec.api.calls.set.length, 1, "write reached the decoder api");
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
