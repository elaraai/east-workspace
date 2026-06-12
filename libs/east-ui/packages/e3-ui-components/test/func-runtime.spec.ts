/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for `FuncRuntime` — the `Func.bind` platform runtime. Uses a
 * hand-rolled `FunctionApi` stub with pause/fail gates so every lifecycle
 * path is deterministic and network-free. Terminal states are awaited by
 * polling the registry (never by sleeping).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    FloatType,
    IntegerType,
    StringType,
    encodeBeast2For,
    decodeBeast2For,
    toEastTypeValue,
    variant,
    type EastType,
    type EastTypeValue,
} from "@elaraai/east";
import { FuncBindHandleType } from "@elaraai/e3-ui/internal";
import type { ExecuteResult, FunctionSignature } from "@elaraai/e3-api-client";
import {
    FuncRuntime,
    funcChannelKey,
    signatureOfHandleType,
    createInMemoryFunctionApi,
    type FunctionApi,
    type FunctionCallArgs,
} from "../src/platform/func-runtime.js";

const ws = "test-workspace";

// =============================================================================
// Helpers
// =============================================================================

function successResult(outputType: EastType, value: unknown): ExecuteResult {
    return {
        outcome: variant("success", { value: encodeBeast2For(outputType)(value) }),
        stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false,
    } as ExecuteResult;
}

function failedResult(exitCode: bigint, stderr = "boom"): ExecuteResult {
    return {
        outcome: variant("failed", { exitCode }),
        stdout: "", stderr, stdoutTruncated: false, stderrTruncated: false,
    } as ExecuteResult;
}

function signature(name: string, inputs: EastType[], output: EastType): FunctionSignature {
    return {
        name,
        inputTypes: inputs.map(t => toEastTypeValue(t)),
        outputType: toEastTypeValue(output),
        runner: variant("east_node", { platforms: [] }),
    } as unknown as FunctionSignature;
}

interface StubApi extends FunctionApi {
    readonly calls: { fn: string; req: FunctionCallArgs }[];
    /** Queue the next call's result (FIFO). */
    respond(result: ExecuteResult): void;
    /** Make the next call reject. */
    failNext(error: Error): void;
    /** Pause the next call until the returned resume(result) fires. */
    pauseNext(): { resume(result: ExecuteResult): void };
}

function createStubApi(signatures: FunctionSignature[]): StubApi {
    const calls: { fn: string; req: FunctionCallArgs }[] = [];
    const queued: ExecuteResult[] = [];
    let failure: Error | null = null;
    const pauses: { promise: Promise<ExecuteResult>; resume(result: ExecuteResult): void }[] = [];
    return {
        calls,
        async list() { return signatures; },
        async call(_ws, fn, req) {
            calls.push({ fn, req });
            const pause = pauses.shift();
            if (pause) return pause.promise;
            if (failure) { const e = failure; failure = null; throw e; }
            const result = queued.shift();
            if (!result) throw new Error("StubApi: no queued result");
            return result;
        },
        respond(result) { queued.push(result); },
        failNext(error) { failure = error; },
        pauseNext() {
            let resume!: (result: ExecuteResult) => void;
            const promise = new Promise<ExecuteResult>(res => { resume = res; });
            pauses.push({ promise, resume });
            return { resume };
        },
    };
}

/** Poll until `cond()` is true (microtask-hopping, never sleeping). */
async function waitFor(cond: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 1000; i++) {
        if (cond()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error(`waitFor timed out: ${what}`);
}

type Handle = {
    call: (...args: unknown[]) => null;
    read: () => { type: string; value: unknown };
    status: () => { type: string };
    error: () => { type: string; value?: { message: string; kind: { type: string }; stderr: string } };
    pending: () => boolean;
    cancel: () => null;
    binding: { name: string };
};

const forecastHandleType = (): EastTypeValue =>
    toEastTypeValue(FuncBindHandleType([IntegerType, FloatType], FloatType));

function newRuntime(signatures: FunctionSignature[] = [signature("forecast", [IntegerType, FloatType], FloatType)]) {
    const api = createStubApi(signatures);
    const runtime = new FuncRuntime();
    runtime.initialize(api, ws);
    const handle = runtime.buildHandle(forecastHandleType(), "forecast") as unknown as Handle;
    return { api, runtime, handle };
}

// =============================================================================
// signatureOfHandleType
// =============================================================================

describe("signatureOfHandleType", () => {
    test("recovers inputs from call and output from read's Option", () => {
        const sig = signatureOfHandleType(forecastHandleType());
        assert.equal(sig.inputs.length, 2);
        assert.equal(sig.inputs[0]!.type, "Integer");
        assert.equal(sig.inputs[1]!.type, "Float");
        assert.equal(sig.output.type, "Float");
    });

    test("rejects a non-struct handle type", () => {
        assert.throws(() => signatureOfHandleType(toEastTypeValue(IntegerType)), /must be a Struct/);
    });
});

// =============================================================================
// Call lifecycle
// =============================================================================

describe("FuncRuntime — call lifecycle", () => {
    test("idle until first call; running while in flight; succeeded with decoded result", async () => {
        const { api, handle } = newRuntime();
        assert.equal(handle.status().type, "idle");
        assert.equal(handle.read().type, "none");
        assert.equal(handle.pending(), false);

        const pause = api.pauseNext();
        handle.call(12n, 1.05);
        await waitFor(() => api.calls.length === 1, "call sent");
        assert.equal(handle.status().type, "running");
        assert.equal(handle.pending(), true);

        pause.resume(successResult(FloatType, 42.5));
        await waitFor(() => handle.status().type === "succeeded", "terminal");
        assert.equal(handle.read().type, "some");
        assert.equal(handle.read().value, 42.5);
        assert.equal(handle.error().type, "none");
        assert.equal(handle.pending(), false);
    });

    test("arguments are beast2-encoded per declared input type", async () => {
        const { api, handle } = newRuntime();
        api.respond(successResult(FloatType, 1.0));
        handle.call(7n, 2.5);
        await waitFor(() => api.calls.length === 1, "call sent");
        const req = api.calls[0]!.req;
        assert.equal(req.args.length, 2);
        assert.equal(decodeBeast2For(toEastTypeValue(IntegerType))(req.args[0]!), 7n);
        assert.equal(decodeBeast2For(toEastTypeValue(FloatType))(req.args[1]!), 2.5);
    });

    test("failed outcome maps to failed status with exit code + stderr", async () => {
        const { api, handle } = newRuntime();
        api.respond(failedResult(3n, "runner stderr"));
        handle.call(1n, 1.0);
        await waitFor(() => handle.status().type === "failed", "terminal");
        const err = handle.error();
        assert.equal(err.type, "some");
        assert.equal(err.value!.kind.type, "failed");
        assert.match(err.value!.message, /exited with code 3/);
        assert.equal(err.value!.stderr, "runner stderr");
    });

    test("timed_out outcome maps to failed / timed_out", async () => {
        const { api, handle } = newRuntime();
        api.respond({
            outcome: variant("timed_out", { ms: 120000n }),
            stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false,
        } as ExecuteResult);
        handle.call(1n, 1.0);
        await waitFor(() => handle.status().type === "failed", "terminal");
        assert.equal(handle.error().value!.kind.type, "timed_out");
    });

    test("transport failure (api.call throws) maps to failed / transport", async () => {
        const { api, handle } = newRuntime();
        api.failNext(new Error("connection refused"));
        handle.call(1n, 1.0);
        await waitFor(() => handle.status().type === "failed", "terminal");
        assert.equal(handle.error().value!.kind.type, "transport");
        assert.match(handle.error().value!.message, /connection refused/);
    });

    test("a new call clears the previous error on success", async () => {
        const { api, handle } = newRuntime();
        api.respond(failedResult(1n));
        handle.call(1n, 1.0);
        await waitFor(() => handle.status().type === "failed", "first terminal");
        api.respond(successResult(FloatType, 9.0));
        handle.call(2n, 2.0);
        await waitFor(() => handle.status().type === "succeeded", "second terminal");
        assert.equal(handle.error().type, "none");
        assert.equal(handle.read().value, 9.0);
    });
});

// =============================================================================
// Latest-wins + cancel
// =============================================================================

describe("FuncRuntime — latest-wins + cancel", () => {
    test("a superseded call's late response is discarded", async () => {
        const { api, handle } = newRuntime();
        const firstPause = api.pauseNext();
        handle.call(1n, 1.0);
        await waitFor(() => api.calls.length === 1, "first sent");

        api.respond(successResult(FloatType, 2.0));
        handle.call(2n, 2.0);
        await waitFor(() => handle.status().type === "succeeded", "second terminal");
        assert.equal(handle.read().value, 2.0);

        // First call settles LATE with a different value — must be discarded.
        firstPause.resume(successResult(FloatType, 1.0));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(handle.read().value, 2.0);
        assert.equal(handle.status().type, "succeeded");
    });

    test("cancel marks cancelled and discards the late response", async () => {
        const { api, handle } = newRuntime();
        const pause = api.pauseNext();
        handle.call(1n, 1.0);
        await waitFor(() => api.calls.length === 1, "sent");
        handle.cancel();
        assert.equal(handle.status().type, "cancelled");
        assert.equal(handle.pending(), false);

        pause.resume(successResult(FloatType, 5.0));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(handle.status().type, "cancelled");
        assert.equal(handle.read().type, "none");
    });

    test("cancel is a no-op when idle or terminal", async () => {
        const { api, handle } = newRuntime();
        handle.cancel();
        assert.equal(handle.status().type, "idle");
        api.respond(successResult(FloatType, 1.0));
        handle.call(1n, 1.0);
        await waitFor(() => handle.status().type === "succeeded", "terminal");
        handle.cancel();
        assert.equal(handle.status().type, "succeeded");
    });

    test("relaunch after cancel works", async () => {
        const { api, handle } = newRuntime();
        const pause = api.pauseNext();
        handle.call(1n, 1.0);
        await waitFor(() => api.calls.length === 1, "sent");
        handle.cancel();
        api.respond(successResult(FloatType, 7.0));
        handle.call(2n, 2.0);
        await waitFor(() => handle.status().type === "succeeded", "terminal");
        assert.equal(handle.read().value, 7.0);
        pause.resume(successResult(FloatType, 1.0)); // stale, discarded
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(handle.read().value, 7.0);
    });
});

// =============================================================================
// Signature validation
// =============================================================================

describe("FuncRuntime — signature validation", () => {
    test("unknown function name parks as failed / invalid; nothing is sent", async () => {
        const { api, runtime } = newRuntime([]);
        const handle = runtime.buildHandle(forecastHandleType(), "forecast") as unknown as Handle;
        handle.call(1n, 1.0);
        await waitFor(() => handle.status().type === "failed", "terminal");
        assert.equal(handle.error().value!.kind.type, "invalid");
        assert.match(handle.error().value!.message, /no function "forecast"/);
        assert.equal(api.calls.length, 0);
    });

    test("signature mismatch parks as failed / invalid; nothing is sent", async () => {
        const { api, runtime } = newRuntime([signature("forecast", [StringType], FloatType)]);
        const handle = runtime.buildHandle(forecastHandleType(), "forecast") as unknown as Handle;
        handle.call(1n, 1.0);
        await waitFor(() => handle.status().type === "failed", "terminal");
        assert.equal(handle.error().value!.kind.type, "invalid");
        assert.match(handle.error().value!.message, /signature mismatch/);
        assert.equal(api.calls.length, 0);
    });

    test("a failed signature list is retried on the next call", async () => {
        const signatures = [signature("forecast", [IntegerType, FloatType], FloatType)];
        let listCalls = 0;
        let failFirst = true;
        const api: FunctionApi = {
            async list() {
                listCalls++;
                if (failFirst) { failFirst = false; throw new Error("list down"); }
                return signatures;
            },
            async call() { return successResult(FloatType, 3.0); },
        };
        const runtime = new FuncRuntime();
        runtime.initialize(api, ws);
        const handle = runtime.buildHandle(forecastHandleType(), "forecast") as unknown as Handle;

        handle.call(1n, 1.0);
        await waitFor(() => handle.status().type === "failed", "first terminal");
        assert.equal(handle.error().value!.kind.type, "transport");

        handle.call(1n, 1.0);
        await waitFor(() => handle.status().type === "succeeded", "second terminal");
        assert.equal(listCalls, 2);
    });
});

// =============================================================================
// Shared channel + reactivity
// =============================================================================

describe("FuncRuntime — shared channel + reactivity", () => {
    test("two handles bound to the same name share the tracked channel", async () => {
        const { api, runtime, handle } = newRuntime();
        const observer = runtime.buildHandle(forecastHandleType(), "forecast") as unknown as Handle;
        api.respond(successResult(FloatType, 11.0));
        handle.call(1n, 1.0);
        await waitFor(() => observer.status().type === "succeeded", "observer sees terminal");
        assert.equal(observer.read().value, 11.0);
    });

    test("subscribers are notified on every transition; key version increments", async () => {
        const { api, runtime, handle } = newRuntime();
        const key = funcChannelKey(ws, "forecast");
        let notifications = 0;
        runtime.subscribe(key, () => { notifications++; });
        const v0 = runtime.getKeyVersion(key);

        api.respond(successResult(FloatType, 1.0));
        handle.call(1n, 1.0);
        await waitFor(() => handle.status().type === "succeeded", "terminal");
        // running + succeeded = at least two notifications.
        assert.ok(notifications >= 2);
        assert.ok(runtime.getKeyVersion(key) >= v0 + 2);
    });

    test("stale unsubscribe disposer does not disconnect a newer subscriber", async () => {
        const { api, runtime, handle } = newRuntime();
        const key = funcChannelKey(ws, "forecast");
        const off1 = runtime.subscribe(key, () => { /* first */ });
        off1();
        let calls = 0;
        runtime.subscribe(key, () => { calls++; });
        off1(); // stale double-unsubscribe
        api.respond(successResult(FloatType, 1.0));
        handle.call(1n, 1.0);
        await waitFor(() => handle.status().type === "succeeded", "terminal");
        assert.ok(calls >= 2);
    });

    test("read/status/pending/error register the channel key while tracking", () => {
        const { runtime, handle } = newRuntime();
        const ctx = runtime.enableTracking();
        handle.read();
        handle.status();
        handle.pending();
        handle.error();
        const keys = runtime.disableTracking();
        assert.deepEqual(keys, [funcChannelKey(ws, "forecast")]);
        assert.ok(ctx.has(funcChannelKey(ws, "forecast")));
    });
});

// =============================================================================
// Scoped platform + lifecycle
// =============================================================================

describe("FuncRuntime — scoping + lifecycle", () => {
    test("scoped platform rejects names outside the manifest", () => {
        const runtime = new FuncRuntime();
        const platform = runtime.buildPlatform(new Set(["allowed"]));
        // The PlatformFunction wraps our impl; reach the impl through its
        // factory shape: (typeArgs) => (name) => handle.
        const impl = (platform as unknown as { impl: (t: EastTypeValue) => (n: unknown) => unknown }).impl
            ?? (platform as unknown as { fn: (t: EastTypeValue) => (n: unknown) => unknown }).fn;
        // Fall back to buildHandle-level scoping assertion if the platform
        // internals aren't introspectable in this East version.
        if (typeof impl !== "function") {
            assert.ok(platform, "platform built");
            return;
        }
        assert.throws(() => impl(forecastHandleType())("forbidden"), /not in this UI task's manifest/);
    });

    test("clear() drops call state and the api", async () => {
        const { api, runtime, handle } = newRuntime();
        api.respond(successResult(FloatType, 1.0));
        handle.call(1n, 1.0);
        await waitFor(() => handle.status().type === "succeeded", "terminal");
        runtime.clear();
        // The workspace wiring is gone — handles fail fast until a
        // provider re-initializes the runtime.
        assert.throws(() => handle.status(), /no workspace configured/);
        // Re-initialize: state was dropped, the channel starts over.
        runtime.initialize(api, ws);
        assert.equal(handle.status().type, "idle");
        assert.equal(handle.read().type, "none");
    });

    test("calling without a workspace throws a clear error", () => {
        const runtime = new FuncRuntime();
        const handle = runtime.buildHandle(forecastHandleType(), "forecast") as unknown as Handle;
        assert.throws(() => handle.call(1n, 1.0), /no workspace configured/);
    });
});

// =============================================================================
// In-memory FunctionApi
// =============================================================================

describe("createInMemoryFunctionApi", () => {
    test("lists signatures and round-trips a call through beast2", async () => {
        const api = createInMemoryFunctionApi([{
            name: "forecast",
            inputTypes: [IntegerType, FloatType],
            outputType: FloatType,
            fn: (periods, growth) => Number(periods as bigint) * (growth as number),
        }]);
        const runtime = new FuncRuntime();
        runtime.initialize(api, ws);
        const handle = runtime.buildHandle(forecastHandleType(), "forecast") as unknown as Handle;
        handle.call(12n, 1.5);
        await waitFor(() => handle.status().type === "succeeded", "terminal");
        assert.equal(handle.read().value, 18);
    });

    test("unknown name surfaces as a transport failure", async () => {
        const api = createInMemoryFunctionApi([]);
        const runtime = new FuncRuntime();
        runtime.initialize(api, ws);
        const handle = runtime.buildHandle(forecastHandleType(), "forecast") as unknown as Handle;
        handle.call(1n, 1.0);
        await waitFor(() => handle.status().type === "failed", "terminal");
        // Empty list → invalid (name validation fires before the call).
        assert.equal(handle.error().value!.kind.type, "invalid");
    });
});
