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
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    FloatType, IntegerType, StructType, FunctionType, NullType,
    encodeBeast2For, decodeBeast2For, toEastTypeValue, variant,
    type EastType,
} from "@elaraai/east";
import { FuncBindHandleType } from "@elaraai/e3-ui/internal";
import type { ExecuteResult, FunctionSignature } from "@elaraai/e3-api-client";
import { FuncRuntime, createScopedFuncPlatform, type FunctionApi } from "../src/platform/func-runtime.js";

const ws = "test-workspace";

function signature(name: string, inputs: EastType[], output: EastType): FunctionSignature {
    return {
        name,
        inputTypes: inputs.map(t => toEastTypeValue(t)),
        outputType: toEastTypeValue(output),
        runner: variant("east_node", { platforms: [] }),
    } as unknown as FunctionSignature;
}

/** A FunctionApi that records every call and returns `result` for success. */
function recordingApi(received: { fn: string; args: Uint8Array[] }[], result: number) {
    return {
        async list() { return [signature("forecast", [IntegerType, FloatType], FloatType)]; },
        async call(_ws: string, fn: string, req: { args: Uint8Array[] }) {
            received.push({ fn, args: req.args });
            return {
                outcome: variant("success", { value: encodeBeast2For(FloatType)(result) }),
                stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false,
            } as ExecuteResult;
        },
    } as unknown as FunctionApi;
}

function newRuntime(received: { fn: string; args: Uint8Array[] }[] = [], result = 0): FuncRuntime {
    const runtime = new FuncRuntime();
    runtime.initialize(recordingApi(received, result), ws);
    return runtime;
}

const HandleType = FuncBindHandleType([IntegerType, FloatType], FloatType);
const handleTypeValue = toEastTypeValue(HandleType);

async function waitFor(cond: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 1000; i++) {
        if (cond()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error(`waitFor timed out: ${what}`);
}

test("#106 — a Func.bind handle ENCODES (its methods carry IR)", () => {
    const handle = newRuntime().buildHandle(handleTypeValue, "forecast");
    // Today (pre-fix): throws "Cannot serialize function: no IR attached".
    assert.doesNotThrow(() => encodeBeast2For(HandleType)(handle as never));
});

test("#106 — a captured Func.bind handle round-trips and re-binds to the DECODER's runtime", async () => {
    // Encode a payload whose onRun callback captures handle.call.
    const PayloadType = StructType({ onRun: FunctionType([IntegerType, FloatType], NullType) });
    const handleEnc = newRuntime().buildHandle(handleTypeValue, "forecast");
    const bytes = encodeBeast2For(PayloadType)({ onRun: handleEnc.call } as never);

    // Decode against a FRESH runtime — the call must reach THAT runtime's api.
    const receivedDec: { fn: string; args: Uint8Array[] }[] = [];
    const runtimeDec = newRuntime(receivedDec, 42.0);
    const decoded = decodeBeast2For(PayloadType, { platform: runtimeDec.buildPrimitives() })(bytes) as {
        onRun: (a: bigint, b: number) => null;
    };

    decoded.onRun(12n, 1.05);
    await waitFor(() => receivedDec.length > 0, "decoder runtime api received the call");
    assert.equal(receivedDec[0]!.fn, "forecast");
    assert.equal(decodeBeast2For(IntegerType)(receivedDec[0]!.args[0]!), 12n, "arg0 bundled + re-bound");
    assert.equal(decodeBeast2For(FloatType)(receivedDec[0]!.args[1]!), 1.05, "arg1 bundled + re-bound");
});

test("#106 — after decode, read()/status() are defensive (none/idle) on a fresh runtime", () => {
    const handleEnc = newRuntime().buildHandle(handleTypeValue, "forecast");
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
        "function_bind", "function_call", "function_read",
        "function_status", "function_error", "function_pending", "function_cancel",
    ]) {
        assert.ok(names.has(name), `scoped Func platform must include '${name}'`);
    }
});
