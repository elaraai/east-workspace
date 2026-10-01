/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A query's one-shot call answered in memory (#940): the stand-in for e3's
 * one-shot execute where there is no server — the east-ui showcase, and the
 * builder's tests — as `createInMemoryFunctionApi` stands in for a deployed
 * function. The builder makes its calls through it when a `QueryCallProvider`
 * hands it over.
 *
 * @packageDocumentation
 */

import { EastError, decodeEastIR, encodeBeast2For, equalFor, fromEastTypeValue, none, sha256Hex, variant, type EastType } from "@elaraai/east";
import { TreePathType, pathToString, type ExecuteResult, type OneShotRequest, type TreePath } from "@elaraai/e3-types";
import type { QueryCall } from "./hooks.js";

/**
 * A dataset an in-memory call may read.
 *
 * @property path - Its path in the workspace, as a call's argument names it
 * @property type - Its East type
 * @property value - Its value
 * @property hash - The hash a run pins it at; the SHA-256 of its beast2 bytes when omitted
 */
export interface InMemoryDataset {
    /** Its path in the workspace, as a call's argument names it. */
    readonly path: TreePath;
    /** Its East type. */
    readonly type: EastType;
    /** Its value. */
    readonly value: unknown;
    /** The hash a run pins it at; the SHA-256 of its beast2 bytes when omitted. */
    readonly hash?: string;
}

const samePath = equalFor(TreePathType);

/**
 * Builds a one-shot call answered in memory, as e3 answers one: the request's
 * body decoded from its IR and compiled with no platform function — a query's
 * call is platform-free — then called with the value of each dataset its
 * arguments name, each pinned at its hash.
 *
 * @param datasets - The datasets a call may read
 * @returns The call
 *
 * @remarks
 * - **Success**: the answer, beast2 at the body's output type, and each
 *   dataset read with its hash.
 * - **Failed**: a body that raises an East error fails as a runner's run does —
 *   exit code 1, and on stderr `Error: <message>` with each place it was
 *   raised, so the builder places it in the jq.
 * - **Invalid**: an argument naming no dataset here is refused as e3 refuses
 *   an unassigned one ("Dataset argument 0 is not assigned"), and an inline
 *   value as one this stand-in does not take.
 * - **Too large**: an answer over the request's `maxResultBytes`.
 *
 * The time limit is not kept: a body runs to its end.
 *
 * @example
 * ```tsx
 * const call = createInMemoryQueryCall([
 *     { path: [variant("field", "inputs"), variant("field", "orders")], type: ArrayType(Order), value: orders },
 * ]);
 * return <QueryCallProvider call={call}>{surface}</QueryCallProvider>;
 * ```
 */
export function createInMemoryQueryCall(datasets: readonly InMemoryDataset[]): QueryCall {
    const held = datasets.map(dataset => {
        // Hashed when a run first reads it, once.
        let hash = dataset.hash;
        return { ...dataset, hashOf: () => (hash ??= sha256Hex(encodeBeast2For(dataset.type)(dataset.value as never))) };
    });
    return async (request: OneShotRequest): Promise<ExecuteResult> => {
        const quiet = { stdout: "", stdoutTruncated: false, stderrTruncated: false };
        const read: (typeof held)[number][] = [];
        for (const [i, arg] of request.args.entries()) {
            const found = arg.type === "dataset" ? held.find(d => samePath(d.path, arg.value)) : undefined;
            if (found === undefined) {
                const message = arg.type === "dataset"
                    ? `Dataset argument ${i} is not assigned (ref type: unassigned): nothing in memory at ${pathToString(arg.value)}`
                    : `Argument ${i} is an inline value, which an in-memory call does not take`;
                return { ...quiet, outcome: variant("invalid", { diagnostics: [{ message, filename: none, line: none, column: none }] }), stderr: "", inputs: [] };
            }
            read.push(found);
        }
        const inputs = read.map(d => ({ path: d.path, hash: d.hashOf() }));
        const body = decodeEastIR(request.bodyIr);
        const type = fromEastTypeValue(body.ir.value.type);
        if (type.type !== "Function") throw new Error("createInMemoryQueryCall: a call's body is a function");
        let answer: unknown;
        try {
            answer = body.compile([])(...read.map(d => d.value));
        } catch (err) {
            if (!(err instanceof EastError)) throw err;
            return { ...quiet, outcome: variant("failed", { exitCode: 1n }), stderr: `Error: ${err.toString()}\n`, inputs };
        }
        const bytes = encodeBeast2For(type.output)(answer as never);
        const limit = request.limits.type === "some" && request.limits.value.maxResultBytes.type === "some" ? request.limits.value.maxResultBytes.value : undefined;
        if (limit !== undefined && BigInt(bytes.length) > limit) {
            return { ...quiet, outcome: variant("too_large", { bytes: BigInt(bytes.length), limit }), stderr: "", inputs };
        }
        return { ...quiet, outcome: variant("success", { value: bytes }), stderr: "", inputs };
    };
}
