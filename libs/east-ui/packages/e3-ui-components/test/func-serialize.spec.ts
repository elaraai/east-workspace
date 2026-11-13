/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Regression tests for issue #106 — a `Func.bind` handle (and any callback that
 * captures one) must survive beast2 encode → decode and re-bind to the DECODER's
 * runtime.
 *
 * The fix makes the handle methods IR-bearing `East.function`s over `function_*`
 * primitives, capturing only the plain-data name (arg/return types ride as
 * type-args; the variadic `call` bundles its args into one `ArgsStruct`).
 *
 * A handle of a function that lists `drafts` (#1620) is held to the same: its
 * call carries the drafts it was given to the decoder's runtime, after the
 * arguments; `drafted()` re-binds as `read()` does; and its `binding` names
 * the records the function lists. What e3 does with a call's drafts is
 * `func-runtime.spec.ts`'s, on e3 itself: here the API is one that records
 * what a handle sends it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    East, ArrayType, FloatType, IntegerType, StringType, StructType, FunctionType, NullType,
    encodeBeast2For, decodeBeast2For, equalFor, printFor, toEastTypeValue, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { FuncBindDraftsHandleType, FuncBindHandleType, FuncBindingType, FuncDraftType, FuncDraftedType } from "@elaraai/e3-ui/internal";
import type { ExecuteResult, FunctionSignature } from "@elaraai/e3-api-client";
import {
    FuncRuntime, createScopedFuncPlatform, funcChannelKey,
    type FuncDraft, type FuncDrafted, type FunctionApi, type FunctionCallArgs,
} from "../src/platform/func-runtime.js";

const ws = "test-workspace";

function signature(name: string, inputs: EastType[], output: EastType): FunctionSignature {
    return {
        name,
        inputs: [],
        drafts: [],
        argTypes: inputs.map(t => toEastTypeValue(t)),
        outputType: toEastTypeValue(output),
        runner: variant("east_node", { platforms: [], decode: variant("lazy", null) }),
    } as unknown as FunctionSignature;
}

/** What a recording API was sent: the function, its arguments and the call's drafts. */
interface Received { fn: string; args: Uint8Array[]; drafts: FuncDraft[] }

/**
 * A FunctionApi that records every call and returns `result` for success.
 *
 * @param received - Where each call is recorded
 * @param result - What every call answers
 * @param drafted - The records each call says it drafted, read as it answers
 */
function recordingApi(received: Received[], result: number, drafted: () => FuncDrafted[] = () => []) {
    return {
        async list() { return [signature("forecast", [IntegerType, FloatType], FloatType)]; },
        async call(_ws: string, fn: string, req: FunctionCallArgs) {
            received.push({ fn, args: req.args, drafts: req.drafts });
            return {
                outcome: variant("success", { value: encodeBeast2For(FloatType)(result) }),
                stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false, inputs: [], drafts: drafted(),
            } as ExecuteResult;
        },
    } as unknown as FunctionApi;
}

function newRuntime(received: Received[] = [], result = 0, drafted?: () => FuncDrafted[]): FuncRuntime {
    const runtime = new FuncRuntime();
    runtime.initialize(recordingApi(received, result, drafted), ws);
    return runtime;
}

const HandleType = FuncBindHandleType([IntegerType, FloatType], FloatType);
const handleTypeValue = toEastTypeValue(HandleType);

/** The handle of the same function, were it to list `drafts`: its call takes them last. */
const DraftsHandleType = FuncBindDraftsHandleType([IntegerType, FloatType], FloatType);
const draftsHandleTypeValue = toEastTypeValue(DraftsHandleType);
type DraftsHandle = ValueTypeOf<typeof DraftsHandleType>;

const DraftsType = ArrayType(FuncDraftType);
const draftsEqual = equalFor(DraftsType);
const printDrafts = printFor(DraftsType);

/** Two drafts of two records: a call's drafts are one list, whatever records they are of. */
const drafts: FuncDraft[] = [
    { record: "jobs", mutation: "patch", args: [encodeBeast2For(IntegerType)(7n)] },
    { record: "presses", mutation: "retire", args: [encodeBeast2For(StringType)("P2"), encodeBeast2For(FloatType)(0.5)] },
];

async function waitFor(cond: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 1000; i++) {
        if (cond()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error(`waitFor timed out: ${what}`);
}

test("#106 — a Func.bind handle ENCODES (its methods carry IR)", () => {
    const handle = newRuntime().buildHandle(handleTypeValue, "forecast", []);
    // Today (pre-fix): throws "Cannot serialize function: no IR attached".
    assert.doesNotThrow(() => encodeBeast2For(HandleType)(handle as never));
});

test("#106 — a captured Func.bind handle round-trips and re-binds to the DECODER's runtime", async () => {
    // Encode a payload whose onRun callback captures handle.call.
    const PayloadType = StructType({ onRun: FunctionType([IntegerType, FloatType], NullType) });
    const handleEnc = newRuntime().buildHandle(handleTypeValue, "forecast", []);
    const bytes = encodeBeast2For(PayloadType)({ onRun: handleEnc.call } as never);

    // Decode against a FRESH runtime — the call must reach THAT runtime's api.
    const receivedDec: Received[] = [];
    const runtimeDec = newRuntime(receivedDec, 42.0);
    const decoded = decodeBeast2For(PayloadType, { platform: runtimeDec.buildPrimitives() })(bytes) as {
        onRun: (a: bigint, b: number) => null;
    };

    decoded.onRun(12n, 1.05);
    await waitFor(() => receivedDec.length > 0, "decoder runtime api received the call");
    assert.equal(receivedDec[0]!.fn, "forecast");
    assert.equal(decodeBeast2For(IntegerType)(receivedDec[0]!.args[0]!), 12n, "arg0 bundled + re-bound");
    assert.equal(decodeBeast2For(FloatType)(receivedDec[0]!.args[1]!), 1.05, "arg1 bundled + re-bound");
    // A handle of a function that lists no drafts sends none: the function reads the workspace as saved
    assert.ok(draftsEqual(receivedDec[0]!.drafts, []), printDrafts(receivedDec[0]!.drafts));
});

test("#106 — after decode, read()/status() are defensive (none/idle) on a fresh runtime", () => {
    const handleEnc = newRuntime().buildHandle(handleTypeValue, "forecast", []);
    const bytes = encodeBeast2For(HandleType)(handleEnc as never);

    const runtimeDec = newRuntime();
    const decoded = decodeBeast2For(HandleType, { platform: runtimeDec.buildPrimitives() })(bytes) as {
        read: () => { type: string }; status: () => { type: string };
    };
    assert.equal(decoded.status().type, "idle", "status() idle before any call on the decoder runtime");
    assert.equal(decoded.read().type, "none", "read() none before any successful call");
});

test("#106 — createScopedFuncPlatform ships the backing primitives (e3 ui() task decode path)", () => {
    // The trap: e3 ui() tasks render through createScoped*() arrays, NOT the
    // registry. The function_* primitives must be in the scoped platform or a
    // serialized handle decodes to "Platform function 'function_call' is not available".
    const names = new Set(createScopedFuncPlatform(["forecast"]).map(p => p.name));
    for (const name of [
        "function_bind", "function_call", "function_read", "function_drafted",
        "function_status", "function_error", "function_pending", "function_cancel",
    ]) {
        assert.ok(names.has(name), `scoped Func platform must include '${name}'`);
    }
});

test("#1620 — a handle of a function that lists drafts encodes whole and decodes on another runtime: its binding names the records listed, and drafted() is empty before any call", () => {
    const handleEnc = newRuntime().buildHandle(draftsHandleTypeValue, "forecast", ["jobs", "presses"]);
    const bytes = encodeBeast2For(DraftsHandleType)(handleEnc as never);

    const runtimeDec = newRuntime();
    const decoded = decodeBeast2For(DraftsHandleType, { platform: runtimeDec.buildPrimitives() })(bytes);
    assert.ok(
        equalFor(FuncBindingType)(decoded.binding, { name: "forecast", drafts: ["jobs", "presses"] }),
        printFor(FuncBindingType)(decoded.binding),
    );
    assert.ok(equalFor(ArrayType(FuncDraftedType))(decoded.drafted(), []), "drafted() answers for a result, and there is none yet");
    assert.equal(decoded.status().type, "idle");
    assert.equal(decoded.read().type, "none");
});

test("#1620 — a captured call with drafts round-trips and re-binds: the drafts it is given reach the decoder's runtime after the arguments, as given", async () => {
    const PayloadType = StructType({ onRun: FunctionType([IntegerType, FloatType, DraftsType], NullType) });
    const handleEnc = newRuntime().buildHandle(draftsHandleTypeValue, "forecast", ["jobs", "presses"]);
    const bytes = encodeBeast2For(PayloadType)({ onRun: handleEnc.call } as never);

    const receivedDec: Received[] = [];
    const runtimeDec = newRuntime(receivedDec, 42.0);
    const decoded = decodeBeast2For(PayloadType, { platform: runtimeDec.buildPrimitives() })(bytes);

    decoded.onRun(12n, 1.05, drafts);
    await waitFor(() => receivedDec.length > 0, "decoder runtime api received the call");
    assert.equal(receivedDec[0]!.fn, "forecast");
    assert.deepEqual(receivedDec[0]!.args.length, 2, "the function's arguments alone: the drafts are no argument of it");
    assert.equal(decodeBeast2For(IntegerType)(receivedDec[0]!.args[0]!), 12n);
    assert.equal(decodeBeast2For(FloatType)(receivedDec[0]!.args[1]!), 1.05);
    assert.ok(draftsEqual(receivedDec[0]!.drafts, drafts), printDrafts(receivedDec[0]!.drafts));

    // An empty Array is a call as saved
    decoded.onRun(13n, 2.0, []);
    await waitFor(() => receivedDec.length > 1, "the second call");
    assert.ok(draftsEqual(receivedDec[1]!.drafts, []), printDrafts(receivedDec[1]!.drafts));
});

test("#1620 — drafted() answers for the result read() gives: empty until a call succeeds, then the records that call drafted and the commit each stood at; reading it reads the function's channel", async () => {
    const draftedEqual = equalFor(ArrayType(FuncDraftedType));
    const printDrafted = printFor(ArrayType(FuncDraftedType));
    let stood: FuncDrafted[] = [{ record: "jobs", commit: "c1" }, { record: "presses", commit: "p4" }];
    const runtime = newRuntime([], 42.0, () => stood);
    const handle = runtime.buildHandle(draftsHandleTypeValue, "forecast", ["jobs", "presses"]) as DraftsHandle;
    const succeeded = async (result: number): Promise<void> => {
        await waitFor(() => handle.status().type === "succeeded" && handle.read().value === result, "the call's success");
    };

    // drafted() is read as read() is: tracked on the function's channel
    const key = funcChannelKey(ws, "forecast");
    runtime.enableTracking();
    assert.ok(draftedEqual(handle.drafted(), []), "nothing before a call has succeeded");
    assert.deepEqual([...runtime.disableTracking().keys()], [key], "a reader of drafted() reads the channel");

    handle.call(1n, 2.0, drafts);
    assert.ok(draftedEqual(handle.drafted(), []), "nothing while the first call runs");
    await succeeded(42.0);
    assert.ok(draftedEqual(handle.drafted(), stood), printDrafted(handle.drafted()));

    // Another page saved the jobs between the two calls: the next result's drafts were laid over the newer commit
    const first = stood;
    stood = [{ record: "jobs", commit: "c2" }, { record: "presses", commit: "p4" }];
    handle.call(1n, 2.0, drafts);
    assert.ok(draftedEqual(handle.drafted(), first), "the last result's, while the next call runs: read() still answers that result");
    await waitFor(() => draftedEqual(handle.drafted(), stood), "the second call's drafted records");
    assert.equal(handle.status().type, "succeeded");

    // The answer is the caller's own: changing it changes nothing the channel keeps
    handle.drafted().pop();
    assert.ok(draftedEqual(handle.drafted(), stood), printDrafted(handle.drafted()));
});

test("#1620 — a handle is its binding's and its form's: one name bound as a function that lists drafts and as one that lists none is two handles, and each is built once", () => {
    const runtime = newRuntime();
    const plain = runtime.buildHandle(handleTypeValue, "forecast", []);
    const drafted = runtime.buildHandle(draftsHandleTypeValue, "forecast", ["jobs"]);
    assert.notEqual(plain, drafted);
    assert.deepEqual([Object.hasOwn(plain, "drafted"), Object.hasOwn(drafted, "drafted")], [false, true], "a handle has what its type names");
    assert.equal(runtime.buildHandle(handleTypeValue, "forecast", []), plain, "built once");
    assert.equal(runtime.buildHandle(draftsHandleTypeValue, "forecast", ["jobs"]), drafted, "built once");

    // A function that lists other records is another binding
    const wider = runtime.buildHandle(draftsHandleTypeValue, "forecast", ["jobs", "presses"]);
    assert.notEqual(wider, drafted);
    assert.ok(equalFor(FuncBindingType)(wider.binding as ValueTypeOf<typeof FuncBindingType>, { name: "forecast", drafts: ["jobs", "presses"] }));
    assert.ok(equalFor(FuncBindingType)(drafted.binding as ValueTypeOf<typeof FuncBindingType>, { name: "forecast", drafts: ["jobs"] }));
    assert.ok(equalFor(FuncBindingType)(plain.binding as ValueTypeOf<typeof FuncBindingType>, { name: "forecast", drafts: [] }));
});

test("#1620 — a page exported before Func.bind named the records a function lists is refused as it is checked: its bind passes the name alone", () => {
    // What an earlier SDK wrote into a page's IR: `function_bind` of the name, and nothing else
    const before = East.genericPlatform("function_bind", ["H"], [StringType], "H", { optional: true });
    const page = East.function([], HandleType, ($) => {
        $.return(before([HandleType], East.value("forecast", StringType)));
    });
    const runtime = newRuntime();
    assert.throws(
        () => East.compile(page, [runtime.buildPlatform(null), ...runtime.buildPrimitives()]),
        /Platform function 'function_bind' expects 2 arguments but got 1/,
    );
});
