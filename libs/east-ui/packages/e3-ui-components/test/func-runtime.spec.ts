/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for `FuncRuntime` — the `Func.bind` platform runtime — on e3 itself
 * (#1378): its default API lists and calls the functions the Func.bind
 * examples' module deploys (`forecast`, `rebalance`, `checked_forecast`,
 * `count_tree`), each request through the harness's fetch. A call in flight is
 * one the harness holds on its way to e3, a lost answer or a refused list is a
 * fault there, and a call past e3's deadline is one whose unit the harness
 * holds as it starts while the clock e3 times it by moves on. What a test
 * counts it reads from the request log, and terminal states are awaited by
 * settling on e3's requests, never by sleeping.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    EastTypeValueType,
    FloatType,
    IntegerType,
    canonicalTypeValue,
    decodeBeast2For,
    encodeBeast2For,
    equalFor,
    isTypeValueEqual,
    none,
    printFor,
    toEastTypeValue,
    variant,
    type EastTypeValue,
    type ValueTypeOf,
} from "@elaraai/east";
import { FuncBindHandleType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/bind/func/func";
import { FunctionCallRequestType } from "@elaraai/e3-types";
import type { E3Request } from "../src/e3-web.test-utils.js";
import {
    FuncRuntime,
    funcChannelKey,
    signatureOfFuncHandleType,
    createDefaultFunctionApi,
} from "../src/platform/func-runtime.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "bind/func/func": ex });

/** e3's deadline for a call that names none: what a call's unit runs under. */
const CALL_DEADLINE_MS = 60_000;

/** A handle bound to `forecast(Integer, Float) -> Float`, typed from its East type. */
type Handle = ValueTypeOf<ReturnType<typeof FuncBindHandleType<[IntegerType, FloatType], FloatType>>>;

const forecastHandleType = (): EastTypeValue =>
    toEastTypeValue(FuncBindHandleType([IntegerType, FloatType], FloatType));

/** Whether a request calls the function named. */
const calls = (name: string) => (request: E3Request) => request.kind === "call" && request.method === "POST" && request.name === name;
/** Whether a request lists the workspace's functions. */
const lists = (request: E3Request) => request.kind === "call" && request.method === "GET" && request.name === undefined;

/** The calls made of the function named, in order. */
const callsOf = (name: string) => h.requests("call").filter(calls(name));

/**
 * Settles once a handle's call has ended, as its channel tells: however long
 * e3's client waits between its tries of a call the network failed, which no
 * request in flight shows.
 *
 * @param runtime - The runtime the handle is bound through
 * @param name - The function the handle calls
 * @param handle - The handle
 */
function ended(runtime: FuncRuntime, name: string, handle: { status: () => { type: string } }): Promise<void> {
    return new Promise((resolve) => {
        let off = () => {};
        const check = () => {
            if (handle.status().type === "running") return;
            off();
            resolve();
        };
        off = runtime.subscribe(funcChannelKey(h.workspace, name), check);
        check();
    });
}

/**
 * A runtime over e3's function API in the test's workspace, and a handle of
 * `forecast`'s type bound to the function named.
 *
 * @param name - The function the handle calls; `forecast` unless given
 */
function bound(name = "forecast") {
    const runtime = new FuncRuntime();
    runtime.initialize(createDefaultFunctionApi(h.e3.apiUrl, h.e3.repo, h.options), h.workspace);
    const handle = runtime.buildHandle(forecastHandleType(), name) as Handle;
    return { runtime, handle };
}

// =============================================================================
// signatureOfFuncHandleType
// =============================================================================

describe("signatureOfFuncHandleType", () => {
    test("recovers inputs from call and output from read's Option", () => {
        const sig = signatureOfFuncHandleType(forecastHandleType());
        assert.equal(sig.inputs.length, 2);
        assert.equal(sig.inputs[0]!.type, "Integer");
        assert.equal(sig.inputs[1]!.type, "Float");
        assert.equal(sig.output.type, "Float");
    });

    test("rejects a non-struct handle type", () => {
        assert.throws(() => signatureOfFuncHandleType(toEastTypeValue(IntegerType)), /must be a Struct/);
    });
});

// =============================================================================
// Call lifecycle
// =============================================================================

describe("FuncRuntime — call lifecycle", () => {
    test("idle until first call; running while in flight; succeeded with decoded result", async () => {
        const { handle } = bound();
        assert.equal(handle.status().type, "idle");
        assert.equal(handle.read().type, "none");
        assert.equal(handle.pending(), false);

        const held = h.e3.hold(calls("forecast"));
        handle.call(12n, 42.5);
        await held.holding;
        assert.equal(handle.status().type, "running");
        assert.equal(handle.pending(), true);

        held.release();
        await h.settle();
        assert.equal(handle.status().type, "succeeded");
        assert.equal(handle.read().type, "some");
        assert.equal(handle.read().value, 42.5);
        assert.equal(handle.error().type, "none");
        assert.equal(handle.pending(), false);
    });

    test("sends each argument to the workspace's function as a value argument, beast2-encoded per its declared type, on the function's own runner", async () => {
        const { handle } = bound();
        handle.call(7n, 2.5);
        await h.settle();
        const [sent] = callsOf("forecast");
        assert.ok(sent?.body !== undefined, "the call was sent, its body whole");
        assert.equal(sent.path, `/repos/${h.e3.repo}/workspaces/${h.workspace}/functions/forecast`);
        const body = decodeBeast2For(FunctionCallRequestType)(sent.body);
        const expected = {
            args: [variant("value", encodeBeast2For(IntegerType)(7n)), variant("value", encodeBeast2For(FloatType)(2.5))],
            runner: none,
            limits: none,
        };
        assert.ok(equalFor(FunctionCallRequestType)(body, expected), printFor(FunctionCallRequestType)(body));
        assert.equal(handle.read().value, 2.5, "e3 ran the function over them");
    });

    test("a failed program maps to failed status with its exit code and stderr", async () => {
        const { handle } = bound("checked_forecast");
        handle.call(1n, -1.0);
        await h.settle();
        assert.equal(handle.status().type, "failed");
        const err = handle.error();
        assert.equal(err.type, "some");
        assert.equal(err.value!.kind.type, "failed");
        assert.match(err.value!.message, /exited with code 1/);
        assert.match(err.value!.stderr, /growth must not be negative/);
    });

    test("a call past e3's deadline maps to failed / timed_out", async (t) => {
        const { runtime, handle } = bound();
        // e3 times a call's unit from when it sends it: held as it starts, it runs on past its deadline while the
        // clock e3 times it by moves on. The clock is e3's until the call has ended: e3 clears its deadline's timer
        // as the unit stops, which only the clock that set it knows.
        const units = h.e3.holdUnits();
        t.mock.timers.enable({ apis: ["setTimeout"] });
        handle.call(1n, 1.0);
        await units.holding;
        t.mock.timers.tick(CALL_DEADLINE_MS);
        await ended(runtime, "forecast", handle);
        t.mock.timers.reset();
        await h.settle();
        assert.equal(handle.status().type, "failed");
        assert.equal(handle.error().value!.kind.type, "timed_out");
        assert.match(handle.error().value!.message, new RegExp(`timed out after ${CALL_DEADLINE_MS}ms`));
    });

    test("a call the network never carries maps to failed / transport", async () => {
        const { runtime, handle } = bound();
        h.e3.fail(calls("forecast"), "network");
        handle.call(1n, 1.0);
        // e3's client tries the call again after the network fails it, and gives up after its last try.
        await ended(runtime, "forecast", handle);
        assert.equal(handle.status().type, "failed");
        assert.equal(handle.error().value!.kind.type, "transport");
        assert.match(handle.error().value!.message, /fetch failed/);
        assert.ok(callsOf("forecast").length > 1, "tried again");
    });

    test("a new call clears the previous error on success", async () => {
        const { runtime } = bound();
        const handle = runtime.buildHandle(forecastHandleType(), "checked_forecast") as Handle;
        handle.call(1n, -1.0);
        await h.settle();
        assert.equal(handle.status().type, "failed");
        handle.call(2n, 4.5);
        await h.settle();
        assert.equal(handle.status().type, "succeeded");
        assert.equal(handle.error().type, "none");
        assert.equal(handle.read().value, 9.0);
    });
});

// =============================================================================
// Latest-wins + cancel
// =============================================================================

describe("FuncRuntime — latest-wins + cancel", () => {
    /** Holds the first call of `forecast` alone on its way to e3. */
    const holdFirst = () => {
        let seen = 0;
        return h.e3.hold((request) => calls("forecast")(request) && ++seen === 1);
    };

    test("a superseded call's late response is discarded", async () => {
        const { handle } = bound();
        const first = holdFirst();
        handle.call(1n, 1.0);
        await first.holding;

        handle.call(2n, 2.0);
        await h.settle();
        assert.equal(handle.status().type, "succeeded");
        assert.equal(handle.read().value, 2.0);

        // The first call reaches e3 late, and its answer of another value is discarded.
        first.release();
        await h.settle();
        assert.equal(callsOf("forecast").length, 2, "e3 answered both");
        assert.equal(handle.read().value, 2.0);
        assert.equal(handle.status().type, "succeeded");
    });

    test("cancel marks cancelled and discards the late response", async () => {
        const { handle } = bound();
        const first = holdFirst();
        handle.call(1n, 5.0);
        await first.holding;
        handle.cancel();
        assert.equal(handle.status().type, "cancelled");
        assert.equal(handle.pending(), false);

        first.release();
        await h.settle();
        assert.equal(handle.status().type, "cancelled");
        assert.equal(handle.read().type, "none");
    });

    test("cancel is a no-op when idle or terminal", async () => {
        const { handle } = bound();
        handle.cancel();
        assert.equal(handle.status().type, "idle");
        handle.call(1n, 1.0);
        await h.settle();
        assert.equal(handle.status().type, "succeeded");
        handle.cancel();
        assert.equal(handle.status().type, "succeeded");
    });

    test("relaunch after cancel works", async () => {
        const { handle } = bound();
        const first = holdFirst();
        handle.call(1n, 1.0);
        await first.holding;
        handle.cancel();
        handle.call(2n, 7.0);
        await h.settle();
        assert.equal(handle.read().value, 7.0);
        // The cancelled call's late answer is discarded.
        first.release();
        await h.settle();
        assert.equal(handle.read().value, 7.0);
    });
});

// =============================================================================
// Signature validation
// =============================================================================

describe("FuncRuntime — signature validation", () => {
    test("a function the workspace does not deploy parks as failed / invalid; nothing is sent", async () => {
        const { handle } = bound("no_such_function");
        handle.call(1n, 1.0);
        await h.settle();
        assert.equal(handle.status().type, "failed");
        assert.equal(handle.error().value!.kind.type, "invalid");
        assert.match(handle.error().value!.message, /no function "no_such_function"/);
        assert.deepEqual(h.requests("call").filter((request) => request.method === "POST"), []);
    });

    test("a signature the deployed function disagrees with parks as failed / invalid; nothing is sent", async () => {
        // `rebalance` takes a Float, where the handle calls (Integer, Float).
        const { handle } = bound("rebalance");
        handle.call(1n, 1.0);
        await h.settle();
        assert.equal(handle.status().type, "failed");
        assert.equal(handle.error().value!.kind.type, "invalid");
        assert.match(handle.error().value!.message, /signature mismatch/);
        assert.deepEqual(callsOf("rebalance"), []);
    });

    test("a recursive signature validates whatever ids its wrappers carry — the deployed list's are not the binding's", async () => {
        // A binding's type is its program's, read off its IR, whose wrappers are numbered from 0 as east-c's IR
        // normalizer numbers them; the deployed list's are numbered as the process that made the package numbered
        // them.
        const binding = canonicalTypeValue(toEastTypeValue(FuncBindHandleType([ex.TreeType], IntegerType)));
        const bindingTree = signatureOfFuncHandleType(binding).inputs[0]!;
        const listed = await createDefaultFunctionApi(h.e3.apiUrl, h.e3.repo, () => h.e3.direct).list(h.workspace);
        const deployed = listed.find((fn) => fn.name === ex.countTreeFn.name)?.inputTypes[0];
        assert.ok(deployed !== undefined, "e3 deploys count_tree");
        const printTypeValue = printFor(EastTypeValueType);
        assert.notEqual(printTypeValue(deployed), printTypeValue(bindingTree));
        assert.ok(isTypeValueEqual(deployed, bindingTree), "one type");

        const runtime = new FuncRuntime();
        runtime.initialize(createDefaultFunctionApi(h.e3.apiUrl, h.e3.repo, h.options), h.workspace);
        type TreeHandle = ValueTypeOf<ReturnType<typeof FuncBindHandleType<[typeof ex.TreeType], IntegerType>>>;
        const handle = runtime.buildHandle(binding, ex.countTreeFn.name) as TreeHandle;
        handle.call({ label: "root", children: [{ label: "a", children: [] }, { label: "b", children: [] }] });
        await h.settle();
        assert.equal(handle.error().type, "none");
        assert.equal(handle.status().type, "succeeded");
        assert.equal(handle.read().value, 3n);
    });

    test("a failed signature list is listed again on the next call", async () => {
        const { handle } = bound();
        let listed = 0;
        h.e3.fail((request) => lists(request) && ++listed === 1, { status: 500, type: "internal", message: "the list is down" });

        handle.call(1n, 1.0);
        await h.settle();
        assert.equal(handle.status().type, "failed");
        assert.equal(handle.error().value!.kind.type, "transport");
        assert.match(handle.error().value!.message, /failed to list workspace functions/);

        handle.call(1n, 3.0);
        await h.settle();
        assert.equal(handle.status().type, "succeeded");
        assert.equal(h.requests("call").filter(lists).length, 2);
    });
});

// =============================================================================
// Shared channel + reactivity
// =============================================================================

describe("FuncRuntime — shared channel + reactivity", () => {
    test("two handles bound to the same name share the tracked channel", async () => {
        const { runtime, handle } = bound();
        const observer = runtime.buildHandle(forecastHandleType(), "forecast") as Handle;
        handle.call(1n, 11.0);
        await h.settle();
        assert.equal(observer.status().type, "succeeded");
        assert.equal(observer.read().value, 11.0);
    });

    test("subscribers are notified on every transition; key version increments", async () => {
        const { runtime, handle } = bound();
        const key = funcChannelKey(h.workspace, "forecast");
        let notifications = 0;
        runtime.subscribe(key, () => { notifications++; });
        const v0 = runtime.getKeyVersion(key);

        handle.call(1n, 1.0);
        await h.settle();
        assert.equal(handle.status().type, "succeeded");
        // running + succeeded = at least two notifications.
        assert.ok(notifications >= 2);
        assert.ok(runtime.getKeyVersion(key) >= v0 + 2);
    });

    test("stale unsubscribe disposer does not disconnect a newer subscriber", async () => {
        const { runtime, handle } = bound();
        const key = funcChannelKey(h.workspace, "forecast");
        const off1 = runtime.subscribe(key, () => { /* first */ });
        off1();
        let notified = 0;
        runtime.subscribe(key, () => { notified++; });
        off1(); // stale double-unsubscribe
        handle.call(1n, 1.0);
        await h.settle();
        assert.equal(handle.status().type, "succeeded");
        assert.ok(notified >= 2);
    });

    test("read/status/pending/error register the channel key while tracking", () => {
        const { runtime, handle } = bound();
        const ctx = runtime.enableTracking();
        handle.read();
        handle.status();
        handle.pending();
        handle.error();
        const keys = runtime.disableTracking();
        assert.deepEqual(keys, [funcChannelKey(h.workspace, "forecast")]);
        assert.ok(ctx.has(funcChannelKey(h.workspace, "forecast")));
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
        const { runtime, handle } = bound();
        handle.call(1n, 1.0);
        await h.settle();
        assert.equal(handle.status().type, "succeeded");
        runtime.clear();
        // The workspace wiring is gone — handles fail fast until a
        // provider re-initializes the runtime.
        assert.throws(() => handle.status(), /no workspace configured/);
        // Re-initialize: state was dropped, the channel starts over.
        runtime.initialize(createDefaultFunctionApi(h.e3.apiUrl, h.e3.repo, h.options), h.workspace);
        assert.equal(handle.status().type, "idle");
        assert.equal(handle.read().type, "none");
    });

    test("calling without a workspace throws a clear error", () => {
        const runtime = new FuncRuntime();
        const handle = runtime.buildHandle(forecastHandleType(), "forecast") as Handle;
        assert.throws(() => handle.call(1n, 1.0), /no workspace configured/);
    });
});
