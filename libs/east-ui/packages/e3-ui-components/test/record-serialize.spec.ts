/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Regression tests for issue #106 — a `Record.bind` handle (and any callback
 * that captures one) must survive beast2 encode → decode and re-bind to the
 * DECODER's runtime, including its NESTED `mutate.*` struct.
 *
 * The fix makes every handle method (top-level AND nested `mutate.*`) an
 * IR-bearing `East.function` over `record_*` primitives, capturing only the
 * plain-data record name (+ per-mutation name; arg/state types ride as
 * type-args; the dynamic `mutate.<name>` bundles its args into one `ArgsStruct`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    IntegerType, encodeBeast2For, decodeBeast2For, toEastTypeValue, variant,
    type EastType,
} from "@elaraai/east";
import { RecordBindHandleType } from "@elaraai/e3-ui/internal";
import type { MutationResult, RecordSignature } from "@elaraai/e3-api-client";
import { RecordRuntime, createScopedRecordPlatform, type RecordApi } from "../src/platform/record-runtime.js";
import { datasetCacheKey, type ReactiveDatasetCacheInterface } from "../src/platform/dataset-store.js";
import type { TreePath } from "@elaraai/e3-types";

const ws = "test-workspace";
const counterPath: TreePath = [variant("field", "records"), variant("field", "counter")];
const encInt = encodeBeast2For(IntegerType);

function recordSig(name: string, mutations: { name: string; argTypes: EastType[] }[]): RecordSignature {
    return {
        name,
        mutations: mutations.map(m => ({ name: m.name, argTypes: m.argTypes.map(t => toEastTypeValue(t)) })),
    } as unknown as RecordSignature;
}

function committed(): MutationResult {
    return { outcome: variant("committed", { commitHash: "c1", stateHash: "s1" }) } as unknown as MutationResult;
}

function fakeCache(seedValue?: bigint): ReactiveDatasetCacheInterface {
    const store = new Map<string, Uint8Array>();
    if (seedValue !== undefined) store.set(datasetCacheKey(ws, counterPath), encInt(seedValue));
    return {
        read: (w: string, p: TreePath) => store.get(datasetCacheKey(w, p)),
        getStatus: () => variant("up-to-date", null),
        async write(w: string, p: TreePath, v: Uint8Array) { store.set(datasetCacheKey(w, p), v); },
        async refresh() { /* no-op */ },
        async launchDataflow() { /* no-op */ },
    } as unknown as ReactiveDatasetCacheInterface;
}

function recordingApi(mutateCalls: { record: string; mutation: string; args: Uint8Array[] }[]): RecordApi {
    return {
        async describe(_w: string, record: string) {
            return recordSig(record, [{ name: "increment", argTypes: [IntegerType] }]);
        },
        async mutate(_w: string, record: string, mutation: string, req: { args: Uint8Array[] }) {
            mutateCalls.push({ record, mutation, args: req.args });
            return committed();
        },
        async history() { return { commits: [] }; },
    } as unknown as RecordApi;
}

const HandleType = RecordBindHandleType(IntegerType, { increment: [IntegerType] });
const handleTypeValue = toEastTypeValue(HandleType);

function newRuntime(opts: { seed?: bigint; mutateCalls?: { record: string; mutation: string; args: Uint8Array[] }[] } = {}): RecordRuntime {
    const runtime = new RecordRuntime();
    runtime.initialize(recordingApi(opts.mutateCalls ?? []), fakeCache(opts.seed), ws);
    return runtime;
}

async function waitFor(cond: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 1000; i++) { if (cond()) return; await new Promise(r => setImmediate(r)); }
    throw new Error(`waitFor timed out: ${what}`);
}

test("#106 — a Record.bind handle ENCODES (top-level + nested mutate.* carry IR)", () => {
    const handle = newRuntime({ seed: 0n }).buildHandle(handleTypeValue, "counter");
    // Today: throws "Cannot serialize function: no IR attached" (top-level AND nested mutate.*).
    assert.doesNotThrow(() => encodeBeast2For(HandleType)(handle as never));
});

test("#106 — read() round-trips and re-binds to the DECODER's cache", () => {
    const bytes = encodeBeast2For(HandleType)(newRuntime({ seed: 0n }).buildHandle(handleTypeValue, "counter") as never);
    const runtimeDec = newRuntime({ seed: 7n }); // decoder cache seeded with 7
    const decoded = decodeBeast2For(HandleType, { platform: runtimeDec.buildPrimitives() })(bytes) as unknown as { read: () => bigint };
    assert.equal(decoded.read(), 7n);
});

test("#106 — mutate.<name> round-trips and re-binds to the DECODER's api", async () => {
    const bytes = encodeBeast2For(HandleType)(newRuntime({ seed: 0n }).buildHandle(handleTypeValue, "counter") as never);
    const mutateCalls: { record: string; mutation: string; args: Uint8Array[] }[] = [];
    const runtimeDec = newRuntime({ seed: 0n, mutateCalls });
    const decoded = decodeBeast2For(HandleType, { platform: runtimeDec.buildPrimitives() })(bytes) as unknown as { mutate: { increment: (n: bigint) => null } };

    decoded.mutate.increment(3n);
    await waitFor(() => mutateCalls.length > 0, "decoder api received the mutation");
    assert.equal(mutateCalls[0]!.record, "counter");
    assert.equal(mutateCalls[0]!.mutation, "increment");
    assert.equal(decodeBeast2For(IntegerType)(mutateCalls[0]!.args[0]!), 3n, "arg bundled + re-bound");
});

test("#106 — nested mutate.* lifecycle survives decode (idle on a fresh runtime)", () => {
    const bytes = encodeBeast2For(HandleType)(newRuntime({ seed: 0n }).buildHandle(handleTypeValue, "counter") as never);
    const runtimeDec = newRuntime({ seed: 0n });
    const decoded = decodeBeast2For(HandleType, { platform: runtimeDec.buildPrimitives() })(bytes) as unknown as {
        mutate: { pending: () => boolean; status: () => { type: string } };
    };
    assert.equal(decoded.mutate.pending(), false);
    assert.equal(decoded.mutate.status().type, "idle");
});

test("#106 — createScopedRecordPlatform ships the backing primitives (e3 ui() task decode path)", () => {
    const names = new Set(createScopedRecordPlatform(["counter"]).map(p => p.name));
    for (const name of [
        "record_bind", "record_read", "record_status", "record_history", "record_start",
        "record_mutate_pending", "record_mutate_status", "record_mutate_error", "record_mutate_cancel", "record_mutate",
    ]) {
        assert.ok(names.has(name), `scoped Record platform must include '${name}'`);
    }
});
