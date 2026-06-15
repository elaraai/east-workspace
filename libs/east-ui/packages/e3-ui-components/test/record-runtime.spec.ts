/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for `RecordRuntime` — the `Record.bind` platform runtime. The WRITE
 * side (mutate channel) uses a hand-rolled `RecordApi` stub with pause/fail
 * gates; the READ side uses a fake dataset cache (the same seam `Data.bind`
 * reads through). Terminal states are awaited by polling the registry.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    IntegerType,
    StringType,
    encodeBeast2For,
    decodeBeast2For,
    toEastTypeValue,
    variant,
    none,
    type EastType,
    type EastTypeValue,
} from "@elaraai/east";
import { RecordBindHandleType } from "@elaraai/e3-ui/internal";
import type { MutationResult, RecordSignature, RecordHistoryResult } from "@elaraai/e3-api-client";
import { datasetCacheKey, type ReactiveDatasetCacheInterface } from "../src/platform/dataset-store.js";
import type { TreePath } from "@elaraai/e3-types";
import {
    RecordRuntime,
    recordChannelKey,
    signatureOfHandleType,
    createInMemoryRecordApi,
    type RecordApi,
    type RecordMutateArgs,
} from "../src/platform/record-runtime.js";

const ws = "test-workspace";
const counterPath: TreePath = [variant("field", "records"), variant("field", "counter")];

// =============================================================================
// Helpers
// =============================================================================

function committed(commitHash = "c1"): MutationResult {
    return { outcome: variant("committed", { commitHash, stateHash: "s1" }) } as MutationResult;
}

function recordSig(name: string, mutations: { name: string; argTypes: EastType[] }[]): RecordSignature {
    return {
        name,
        mutations: mutations.map(m => ({ name: m.name, argTypes: m.argTypes.map(t => toEastTypeValue(t)) })),
    } as unknown as RecordSignature;
}

/** A fake dataset cache — only the methods the record runtime reads through. */
interface FakeCache extends ReactiveDatasetCacheInterface {
    readonly store: Map<string, Uint8Array>;
    readonly refreshes: string[];
    readonly launches: string[];
    seed(path: TreePath, bytes: Uint8Array): void;
}

function createFakeCache(): FakeCache {
    const store = new Map<string, Uint8Array>();
    const refreshes: string[] = [];
    const launches: string[] = [];
    const cache = {
        store,
        refreshes,
        launches,
        seed(path: TreePath, bytes: Uint8Array) { store.set(datasetCacheKey(ws, path), bytes); },
        read(workspace: string, path: TreePath) { return store.get(datasetCacheKey(workspace, path)); },
        getStatus() { return variant("up-to-date", null); },
        async write(workspace: string, path: TreePath, value: Uint8Array) { store.set(datasetCacheKey(workspace, path), value); },
        async refresh(workspace: string) { refreshes.push(workspace); },
        async launchDataflow(workspace: string) { launches.push(workspace); },
    };
    return cache as unknown as FakeCache;
}

interface StubApi extends RecordApi {
    readonly mutateCalls: { record: string; mutation: string; req: RecordMutateArgs }[];
    readonly describeCalls: number;
    readonly historyCalls: number;
    respond(result: MutationResult): void;
    failNext(error: Error): void;
    pauseNext(): { resume(result: MutationResult): void };
    setHistory(commits: RecordHistoryResult["commits"]): void;
    /** Make every `history()` call throw until cleared with `failHistory(null)`. */
    failHistory(error: Error | null): void;
}

function createStubApi(signatures: RecordSignature[]): StubApi {
    const mutateCalls: { record: string; mutation: string; req: RecordMutateArgs }[] = [];
    const queued: MutationResult[] = [];
    let failure: Error | null = null;
    let historyFailure: Error | null = null;
    const pauses: { promise: Promise<MutationResult>; resume(result: MutationResult): void }[] = [];
    let historyCommits: RecordHistoryResult["commits"] = [];
    const counters = { describe: 0, history: 0 };
    const api = {
        mutateCalls,
        get describeCalls() { return counters.describe; },
        get historyCalls() { return counters.history; },
        async describe(_ws: string, record: string) {
            counters.describe += 1;
            const sig = signatures.find(s => s.name === record);
            if (!sig) throw new Error(`no record "${record}"`);
            return sig;
        },
        async mutate(_ws: string, record: string, mutation: string, req: RecordMutateArgs) {
            mutateCalls.push({ record, mutation, req });
            const pause = pauses.shift();
            if (pause) return pause.promise;
            if (failure) { const e = failure; failure = null; throw e; }
            const result = queued.shift();
            if (!result) throw new Error("StubApi: no queued result");
            return result;
        },
        async history(_ws: string, _record: string) {
            counters.history += 1;
            if (historyFailure) throw historyFailure;
            return { commits: historyCommits } as RecordHistoryResult;
        },
        respond(result: MutationResult) { queued.push(result); },
        failNext(error: Error) { failure = error; },
        failHistory(error: Error | null) { historyFailure = error; },
        pauseNext() {
            let resume!: (result: MutationResult) => void;
            const promise = new Promise<MutationResult>(res => { resume = res; });
            pauses.push({ promise, resume });
            return { resume };
        },
        setHistory(commits: RecordHistoryResult["commits"]) { historyCommits = commits; },
    };
    return api as unknown as StubApi;
}

async function waitFor(cond: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 1000; i++) {
        if (cond()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error(`waitFor timed out: ${what}`);
}

type Handle = {
    read: () => bigint;
    status: () => { type: string };
    history: () => { type: string; value?: unknown[] };
    mutate: {
        increment: (by: bigint) => null;
        pending: () => boolean;
        status: () => { type: string };
        error: () => { type: string; value?: { message: string; kind: { type: string }; stderr: string } };
        cancel: () => null;
    };
    start: () => null;
    binding: { name: string; mutations: string[] };
};

const counterHandleType = (): EastTypeValue =>
    toEastTypeValue(RecordBindHandleType(IntegerType, { increment: [IntegerType] }));

const encInt = encodeBeast2For(IntegerType);

function newRuntime(signatures: RecordSignature[] = [recordSig("counter", [{ name: "increment", argTypes: [IntegerType] }])]) {
    const api = createStubApi(signatures);
    const cache = createFakeCache();
    cache.seed(counterPath, encInt(0n));
    const runtime = new RecordRuntime();
    runtime.initialize(api, cache, ws);
    const handle = runtime.buildHandle(counterHandleType(), "counter") as unknown as Handle;
    return { api, cache, runtime, handle };
}

// =============================================================================
// signatureOfHandleType
// =============================================================================

describe("signatureOfHandleType (record)", () => {
    test("recovers the state type and per-mutation arg types", () => {
        const sig = signatureOfHandleType(toEastTypeValue(RecordBindHandleType(IntegerType, { increment: [IntegerType], add: [IntegerType, StringType] })));
        assert.equal(sig.stateType.type, "Integer");
        assert.equal(sig.mutations.get("increment")!.length, 1);
        assert.equal(sig.mutations.get("increment")![0]!.type, "Integer");
        assert.equal(sig.mutations.get("add")!.length, 2);
        assert.equal(sig.mutations.get("add")![1]!.type, "String");
    });

    test("rejects a non-struct handle type", () => {
        assert.throws(() => signatureOfHandleType(toEastTypeValue(IntegerType)), /must be a Struct/);
    });
});

// =============================================================================
// Read side (via cache)
// =============================================================================

describe("RecordRuntime — read side", () => {
    test("read() decodes the seeded state from the cache", () => {
        const { handle } = newRuntime();
        assert.equal(handle.read(), 0n);
    });

    test("read() throws when the record is not preloaded", () => {
        const { runtime, cache } = newRuntime();
        cache.store.clear();
        const handle = runtime.buildHandle(counterHandleType(), "counter") as unknown as Handle;
        assert.throws(() => handle.read(), /not loaded/);
    });

    test("binding lists the record name + mutation names from the handle type", () => {
        const { handle } = newRuntime();
        assert.equal(handle.binding.name, "counter");
        assert.deepEqual(handle.binding.mutations, ["increment"]);
    });
});

// =============================================================================
// Mutation lifecycle
// =============================================================================

describe("RecordRuntime — mutation lifecycle", () => {
    test("idle until first mutation; running while in flight; committed on success", async () => {
        const { api, handle } = newRuntime();
        assert.equal(handle.mutate.status().type, "idle");
        assert.equal(handle.mutate.pending(), false);

        const pause = api.pauseNext();
        handle.mutate.increment(5n);
        await waitFor(() => api.mutateCalls.length === 1, "mutate sent");
        assert.equal(handle.mutate.status().type, "running");
        assert.equal(handle.mutate.pending(), true);

        pause.resume(committed());
        await waitFor(() => handle.mutate.status().type === "committed", "terminal");
        assert.equal(handle.mutate.error().type, "none");
        assert.equal(handle.mutate.pending(), false);
    });

    test("args are beast2-encoded per the mutation's declared types", async () => {
        const { api, handle } = newRuntime();
        api.respond(committed());
        handle.mutate.increment(7n);
        await waitFor(() => api.mutateCalls.length === 1, "sent");
        const req = api.mutateCalls[0]!.req;
        assert.equal(req.args.length, 1);
        assert.equal(decodeBeast2For(toEastTypeValue(IntegerType))(req.args[0]!), 7n);
    });

    test("a committed mutation refreshes the dataset cache exactly once", async () => {
        const { api, cache, handle } = newRuntime();
        api.respond(committed());
        handle.mutate.increment(1n);
        await waitFor(() => handle.mutate.status().type === "committed", "terminal");
        assert.deepEqual(cache.refreshes, [ws]);
    });

    test("conflict / failed / too_large / timed_out map onto RecordError arms", async () => {
        const cases: { outcome: MutationResult; kind: string }[] = [
            { outcome: { outcome: variant("conflict", { attempts: 5n }) } as MutationResult, kind: "conflict" },
            { outcome: { outcome: variant("failed", { exitCode: 3n, stderr: "boom" }) } as MutationResult, kind: "failed" },
            { outcome: { outcome: variant("too_large", { bytes: 99n, limit: 10n, stderr: "" }) } as MutationResult, kind: "too_large" },
            { outcome: { outcome: variant("timed_out", { ms: 60000n, stderr: "" }) } as MutationResult, kind: "timed_out" },
        ];
        for (const c of cases) {
            const { api, handle } = newRuntime();
            api.respond(c.outcome);
            handle.mutate.increment(1n);
            await waitFor(() => handle.mutate.status().type === "failed", `terminal ${c.kind}`);
            assert.equal(handle.mutate.error().value!.kind.type, c.kind);
        }
    });

    test("transport failure (api throws) maps to failed / transport; no refresh", async () => {
        const { api, cache, handle } = newRuntime();
        api.failNext(new Error("connection refused"));
        handle.mutate.increment(1n);
        await waitFor(() => handle.mutate.status().type === "failed", "terminal");
        assert.equal(handle.mutate.error().value!.kind.type, "transport");
        assert.deepEqual(cache.refreshes, []);
    });
});

// =============================================================================
// start() — launch the workspace dataflow
// =============================================================================

describe("RecordRuntime — start", () => {
    test("start launches the workspace dataflow", async () => {
        const { cache, handle } = newRuntime();
        handle.start();
        await waitFor(() => cache.launches.length > 0, "launch");
        assert.deepEqual(cache.launches, [ws]);
    });

    test("start with no mutation in flight launches immediately", async () => {
        const { cache, handle } = newRuntime();
        // No mutation has run, so there is nothing to drain — it still launches.
        handle.start();
        await waitFor(() => cache.launches.length > 0, "launch");
        assert.equal(cache.launches.length, 1);
    });

    test("start drains an in-flight mutation before launching", async () => {
        const { api, cache, handle } = newRuntime();
        const pause = api.pauseNext();
        handle.mutate.increment(1n);
        await waitFor(() => handle.mutate.status().type === "running", "running");
        // Request the launch while the mutation is still in flight.
        handle.start();
        // It must not fire until the mutation settles.
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(cache.launches, []);
        pause.resume(committed());
        await waitFor(() => cache.launches.length > 0, "launch after commit");
        assert.deepEqual(cache.launches, [ws]);
    });
});

// =============================================================================
// Validation
// =============================================================================

describe("RecordRuntime — validation", () => {
    test("unknown mutation parks failed/invalid; nothing is sent", async () => {
        const { api, runtime } = newRuntime([recordSig("counter", [])]);
        const handle = runtime.buildHandle(counterHandleType(), "counter") as unknown as Handle;
        handle.mutate.increment(1n);
        await waitFor(() => handle.mutate.status().type === "failed", "terminal");
        assert.equal(handle.mutate.error().value!.kind.type, "invalid");
        assert.equal(api.mutateCalls.length, 0);
    });

    test("arity mismatch parks failed/invalid; nothing is sent", async () => {
        const { api, runtime } = newRuntime([recordSig("counter", [{ name: "increment", argTypes: [IntegerType, IntegerType] }])]);
        const handle = runtime.buildHandle(counterHandleType(), "counter") as unknown as Handle;
        handle.mutate.increment(1n);
        await waitFor(() => handle.mutate.status().type === "failed", "terminal");
        assert.match(handle.mutate.error().value!.message, /signature mismatch/);
        assert.equal(api.mutateCalls.length, 0);
    });

    test("describe is fetched once across many mutations", async () => {
        const { api, handle } = newRuntime();
        api.respond(committed()); api.respond(committed());
        handle.mutate.increment(1n);
        await waitFor(() => handle.mutate.status().type === "committed", "first");
        handle.mutate.increment(1n);
        await waitFor(() => api.mutateCalls.length === 2, "second sent");
        assert.equal(api.describeCalls, 1);
    });
});

// =============================================================================
// Latest-wins + cancel
// =============================================================================

describe("RecordRuntime — latest-wins + cancel", () => {
    test("a superseded mutation's late response is discarded", async () => {
        const { api, handle } = newRuntime();
        const firstPause = api.pauseNext();
        handle.mutate.increment(1n);
        await waitFor(() => api.mutateCalls.length === 1, "first sent");

        api.respond(committed("c2"));
        handle.mutate.increment(2n);
        await waitFor(() => handle.mutate.status().type === "committed", "second terminal");

        firstPause.resume({ outcome: variant("failed", { exitCode: 1n, stderr: "" }) } as MutationResult);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(handle.mutate.status().type, "committed"); // not clobbered by the stale failure
    });

    test("cancel marks cancelled and discards the late response", async () => {
        const { api, handle } = newRuntime();
        const pause = api.pauseNext();
        handle.mutate.increment(1n);
        await waitFor(() => api.mutateCalls.length === 1, "sent");
        handle.mutate.cancel();
        assert.equal(handle.mutate.status().type, "cancelled");

        pause.resume(committed());
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(handle.mutate.status().type, "cancelled");
    });
});

// =============================================================================
// History
// =============================================================================

describe("RecordRuntime — history", () => {
    test("history() fetches once (none until loaded), then returns the chain", async () => {
        const { api, runtime, handle } = newRuntime();
        api.setHistory([{ hash: "h0", parent: none, state: "s", mutation: "$init", actor: "x", at: new Date(0) }] as RecordHistoryResult["commits"]);
        const key = recordChannelKey(ws, "counter");
        assert.equal(handle.history().type, "none");
        await waitFor(() => runtime.getKeyVersion(key) > 0, "history loaded");
        assert.equal(handle.history().type, "some");
        assert.equal(handle.history().value!.length, 1);
        assert.equal(api.historyCalls, 1);
        // A second history() does not refetch.
        handle.history();
        assert.equal(api.historyCalls, 1);
    });

    test("a committed mutation drops the history cache so the next history() refetches", async () => {
        const { api, runtime, handle } = newRuntime();
        api.setHistory([] as RecordHistoryResult["commits"]);
        const key = recordChannelKey(ws, "counter");
        handle.history();
        await waitFor(() => runtime.getKeyVersion(key) > 0, "first load");
        assert.equal(api.historyCalls, 1);

        api.respond(committed());
        handle.mutate.increment(1n);
        await waitFor(() => handle.mutate.status().type === "committed", "committed");
        // history cache dropped → next history() refetches.
        assert.equal(handle.history().type, "none");
        await waitFor(() => api.historyCalls === 2, "refetched");
    });
});

// =============================================================================
// Tracking + scoping + lifecycle
// =============================================================================

describe("RecordRuntime — tracking, scoping, lifecycle", () => {
    test("mutate.* register the channel key while tracking", () => {
        const { runtime, handle } = newRuntime();
        runtime.enableTracking();
        handle.mutate.pending();
        handle.mutate.status();
        handle.mutate.error();
        const keys = runtime.disableTracking();
        assert.deepEqual(keys, [recordChannelKey(ws, "counter")]);
    });

    test("clear() drops state and the api; status throws until re-init", async () => {
        const { api, cache, runtime, handle } = newRuntime();
        api.respond(committed());
        handle.mutate.increment(1n);
        await waitFor(() => handle.mutate.status().type === "committed", "terminal");
        runtime.clear();
        assert.throws(() => handle.mutate.status(), /no workspace configured/);
        runtime.initialize(api, cache, ws);
        assert.equal(handle.mutate.status().type, "idle");
    });

    test("calling a mutation without a workspace throws a clear error", () => {
        const runtime = new RecordRuntime();
        const handle = runtime.buildHandle(counterHandleType(), "counter") as unknown as Handle;
        assert.throws(() => handle.mutate.increment(1n), /no workspace configured/);
    });
});

// =============================================================================
// In-memory RecordApi
// =============================================================================

describe("createInMemoryRecordApi", () => {
    test("seeds the cache, reduces on mutate, and read() reflects the new state", async () => {
        const cache = createFakeCache();
        const api = createInMemoryRecordApi(cache, ws, [{
            name: "counter",
            stateType: IntegerType,
            initial: 0n,
            mutations: [{ name: "increment", argTypes: [IntegerType], reduce: (state, by) => (state as bigint) + (by as bigint) }],
        }]);
        const runtime = new RecordRuntime();
        runtime.initialize(api, cache, ws);
        const handle = runtime.buildHandle(counterHandleType(), "counter") as unknown as Handle;

        assert.equal(handle.read(), 0n);
        handle.mutate.increment(5n);
        await waitFor(() => handle.mutate.status().type === "committed", "committed");
        assert.equal(handle.read(), 5n);
    });
});

// =============================================================================
// history() — failed-fetch retry guard
// =============================================================================

describe("RecordRuntime — history retry guard", () => {
    test("a failing history fetch is not re-issued on every render", async () => {
        const { api, handle } = newRuntime();
        api.failHistory(new Error("history endpoint down"));
        // First read triggers a fetch that fails.
        assert.equal(handle.history().type, "none");
        await waitFor(() => api.historyCalls === 1, "first history fetch");
        // Subsequent reads must NOT re-issue while the failure stands.
        handle.history();
        handle.history();
        handle.history();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(api.historyCalls, 1);
    });

    test("a commit clears the failed flag so history retries", async () => {
        const { api, handle } = newRuntime();
        api.failHistory(new Error("down"));
        handle.history();
        await waitFor(() => api.historyCalls === 1, "first fetch");
        // Recover, then commit a mutation — the commit drops the failed flag.
        api.failHistory(null);
        api.respond(committed());
        handle.mutate.increment(1n);
        await waitFor(() => handle.mutate.status().type === "committed", "committed");
        // Next read retries the now-recovered fetch.
        handle.history();
        await waitFor(() => api.historyCalls === 2, "retry after commit");
        assert.equal(api.historyCalls, 2);
    });
});

// =============================================================================
// cancel() — clears the in-flight handle so start() doesn't drain it
// =============================================================================

describe("RecordRuntime — cancel clears inflight", () => {
    test("start() after cancel() launches without waiting on the cancelled mutation", async () => {
        const { api, cache, handle } = newRuntime();
        // Hold a mutation in flight, then cancel it (orphaned, never resumed).
        api.pauseNext();
        handle.mutate.increment(1n);
        await waitFor(() => handle.mutate.status().type === "running", "running");
        handle.mutate.cancel();
        // start() must launch immediately — if it still awaited the cancelled
        // mutation's inflight promise it would hang (the pause never resumes).
        handle.start();
        await waitFor(() => cache.launches.length > 0, "launch after cancel");
        assert.deepEqual(cache.launches, [ws]);
    });
});
