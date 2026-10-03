/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A query's calls answered in memory (#940, #941), as the showcase and the
 * builder's tests make them. A one-shot call: what a run reads and the hash it
 * pins it at; an argument naming nothing, refused as e3 refuses an unassigned
 * dataset; the size limit; and a runtime error, failed as a runner fails it,
 * placed in the jq. A split call: the dataset cut into pieces, each reported
 * done, then the merge or the fold, answering as the one-shot call does; an
 * argument naming nothing; a piece's runtime error placed in the jq; the size
 * limit; a dict with no merge refusing a key emitted twice; and a call
 * abandoned by its signal. Its assembled output kept by its hash (#942),
 * which a later call's `object` argument reads — a re-keyed join's second
 * call — and an object no call assembled refused; arguments that cannot be
 * cut together, or none partitioned, refused. A data source's status: its
 * rows, its hash and its weight.
 */

import { describe, test, expect } from "vitest";
import {
    IntegerType, decodeBeast2, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, none, sha256Hex, some, toEastTypeValue, variant,
} from "@elaraai/east";
import type { SplitCallProgress } from "@elaraai/e3-types";
import { createInMemoryQueryCall, createInMemorySourceStatus, createInMemorySplitCall } from "./in-memory-call.js";
import { prepareQuery, queryResultOf, queryRoot, type QueryResult } from "./one-shot.js";
import { planQuery, type QueryPlan } from "./plan.js";
import { CUSTOMERS, CustomersType, FIXTURE_VALUE, ORDERS, OrdersType } from "./query.test-utils.js";

const orders = (FIXTURE_VALUE as Readonly<Record<string, unknown>>)["orders"];
const customers = (FIXTURE_VALUE as Readonly<Record<string, unknown>>)["customers"];
const ROOT = queryRoot([{ name: "orders", path: ORDERS, type: toEastTypeValue(OrdersType) }]);

/** A run of a program over the root, through a call. */
async function run(program: string, call: ReturnType<typeof createInMemoryQueryCall>, maxBytes?: number) {
    const prepared = prepareQuery(program, ROOT, maxBytes === undefined ? {} : { maxBytes });
    if ("result" in prepared) throw new Error(`${program} does not check`);
    const answer = await call(prepared.prepared.request);
    return { answer, result: queryResultOf(prepared.prepared, answer) };
}

describe("createInMemoryQueryCall (#940)", () => {
    test("a run reads the datasets its arguments name, each pinned at the SHA-256 of its beast2 bytes unless a hash is given", async () => {
        const { answer, result } = await run(".orders | length", createInMemoryQueryCall([{ path: ORDERS, type: OrdersType, value: orders }]));
        expect(answer.inputs.map(i => i.hash)).toEqual([sha256Hex(encodeBeast2For(OrdersType)(orders as never))]);
        if (result.outcome.type !== "ok") throw new Error(`expected an answer, got ${result.outcome.type}`);
        expect(decodeBeast2For(IntegerType)(result.outcome.value.result)).toBe(40n);
        const pinned = await run(".orders | length", createInMemoryQueryCall([{ path: ORDERS, type: OrdersType, value: orders, hash: "4f2a1c8d" }]));
        expect(pinned.answer.inputs.map(i => i.hash)).toEqual(["4f2a1c8d"]);
    });

    test("an argument naming nothing here is refused as e3 refuses an unassigned dataset: the source has no value yet", async () => {
        const { answer, result } = await run(".orders | length", createInMemoryQueryCall([]));
        expect([answer.outcome.type, answer.inputs]).toEqual(["invalid", []]);
        if (result.outcome.type !== "error") throw new Error(`expected a refusal, got ${result.outcome.type}`);
        expect(result.outcome.value.map(d => [d.code, d.message])).toEqual([["no_value", "no_value: orders has no value yet."]]);
    });

    test("an answer over the call's most bytes is too large", async () => {
        const { result } = await run(".orders", createInMemoryQueryCall([{ path: ORDERS, type: OrdersType, value: orders }]), 64);
        if (result.outcome.type !== "too_large") throw new Error(`expected too large, got ${result.outcome.type}`);
        expect(result.outcome.value.limit).toBe(64n);
        expect(result.outcome.value.bytes > 64n).toBe(true);
    });

    test("a runtime error fails as a runner's run does, and is placed in the jq", async () => {
        const program = ".orders | length | . % 0";
        const { answer, result } = await run(program, createInMemoryQueryCall([{ path: ORDERS, type: OrdersType, value: orders }]));
        expect([answer.outcome.type, answer.stderr.startsWith("Error: ")]).toEqual(["failed", true]);
        if (result.outcome.type !== "error") throw new Error(`expected an error, got ${result.outcome.type}`);
        const [first] = result.outcome.value;
        expect([first!.code, first!.span.type]).toEqual(["runtime", "some"]);
        expect(first!.message).toMatch(/Division by zero/i);
    });
});

// ─── A split call ────────────────────────────────────────────────────────────

/** The root of orders and customers, and their datasets in memory. */
const BOTH = queryRoot([
    { name: "orders", path: ORDERS, type: toEastTypeValue(OrdersType) },
    { name: "customers", path: CUSTOMERS, type: toEastTypeValue(CustomersType) },
]);
const DATASETS = [{ path: ORDERS, type: OrdersType, value: orders }, { path: CUSTOMERS, type: CustomersType, value: customers }];

/** A program's split call, its orders weighed as larger than one piece. */
function splitOf(program: string, maxBytes?: number): Extract<QueryPlan, { kind: "split" }> {
    const planned = planQuery(program, BOTH, new Map([["orders", { bytes: 1 << 30, rows: 40 }]]), maxBytes === undefined ? {} : { maxBytes });
    if ("result" in planned || planned.plan.kind !== "split") throw new Error(`${program} does not split`);
    return planned.plan;
}

/** A split call run in memory over some pieces: its answer read, its assembled output's hash, and each progress it reported. */
async function split(program: string, pieces: number, datasets = DATASETS, maxBytes?: number) {
    const { request, reading } = splitOf(program, maxBytes);
    const progress: SplitCallProgress[] = [];
    const { result: answer, output } = await createInMemorySplitCall(datasets, { pieces })(request, { signal: new AbortController().signal, onProgress: p => progress.push(p) });
    return { answer, output, result: queryResultOf(reading, answer), progress };
}

/** What a split call is given when nothing abandons it and nobody watches its progress. */
const QUIET = { signal: new AbortController().signal, onProgress: () => {} };

/** A one-shot call's answer, run in memory over the same datasets. */
async function oneShot(program: string): Promise<QueryResult> {
    const prepared = prepareQuery(program, BOTH);
    if ("result" in prepared) throw new Error(`${program} does not check`);
    return queryResultOf(prepared.prepared, await createInMemoryQueryCall(DATASETS)(prepared.prepared.request));
}

/** A result's answer, decoded at its type. */
function valueOf(result: QueryResult): { type: ReturnType<typeof fromEastTypeValue>; value: unknown } {
    if (result.outcome.type !== "ok") throw new Error(`expected an answer, got ${result.outcome.type}`);
    const decoded = decodeBeast2(result.outcome.value.result);
    return { type: fromEastTypeValue(decoded.type), value: decoded.value };
}

/** Progress in numbers: each report's stage, done and units. */
const steps = (progress: readonly SplitCallProgress[]) => progress.map(p => [p.phase.type, Number(p.done), Number(p.units)]);

describe("createInMemorySplitCall (#941)", () => {
    test("each piece reported done, then a set's merge, a dict's merge or a fold's combine; and it answers as the one-shot call does", async () => {
        const cases = [
            [".orders | map(.id)", []],
            [".orders | map(.customer_id) | unique", [["merge", 0, 1], ["merge", 1, 1]]],
            [".customers as $c | .orders | group_by($c[.customer_id].region) | map({region: .[0].customer_id, n: length})", [["merge", 0, 1], ["merge", 1, 1]]],
            [".orders | {n: length, lines: (map(.lines | length) | add)}", [["combine", 0, 1], ["combine", 1, 1]]],
        ] as const;
        for (const [program, after] of cases) {
            const { result, progress } = await split(program, 4);
            expect(steps(progress), program).toEqual([["partition", 0, 4], ["partition", 1, 4], ["partition", 2, 4], ["partition", 3, 4], ["partition", 4, 4], ...after]);
            const [got, want] = [valueOf(result), valueOf(await oneShot(program))];
            expect(equalFor(want.type)(got.value as never, want.value as never), program).toBe(true);
            // Each dataset read, pinned at the SHA-256 of its beast2 bytes, in the call's argument order.
            expect(result.inputs.map(i => i.name)).toEqual(splitOf(program).reading.entries.map(e => e.name));
        }
    });

    test("more pieces than rows: some pieces empty, and the answer the one-shot call's", async () => {
        const program = ".orders | map(.lines | length) | add";
        const { result } = await split(program, 64);
        expect(valueOf(result).value).toEqual(valueOf(await oneShot(program)).value);
    });

    test("a dataset argument naming nothing here is refused as e3 refuses an unassigned dataset: the source has no value yet", async () => {
        const { answer, result } = await split(".orders | map(.id)", 3, []);
        expect([answer.outcome.type, answer.inputs]).toEqual(["invalid", []]);
        expect(result.outcome).toEqual(variant("error", [{
            code: "no_value", fixes: [], message: "no_value: orders has no value yet.", severity: variant("error", null), span: none, suggestions: [],
        }]));
    });

    test("a piece's runtime error fails as a runner's run does, and is placed in the jq", async () => {
        const { answer, result } = await split(".orders | map(.lines | length) | map(10 / (. - .)) | add", 3);
        expect([answer.outcome.type, answer.stderr.startsWith("Error: ")]).toEqual(["failed", true]);
        if (result.outcome.type !== "error") throw new Error(`expected an error, got ${result.outcome.type}`);
        const [first] = result.outcome.value;
        expect([first!.code, first!.span.type, first!.message]).toEqual(["runtime", "some", "runtime: Division by zero"]);
    });

    test("an answer over the call's most bytes is too large", async () => {
        const { result } = await split(".orders | map(.id)", 3, DATASETS, 64);
        if (result.outcome.type !== "too_large") throw new Error(`expected too large, got ${result.outcome.type}`);
        expect([result.outcome.value.limit, result.outcome.value.bytes > 64n]).toEqual([64n, true]);
    });

    test("a dict with no merge refuses a key emitted twice, naming it", async () => {
        const { request } = splitOf(".orders | unique_by(.customer_id) | map(.id)");
        const { result: answer, output } = await createInMemorySplitCall(DATASETS, { pieces: 2 })({ ...request, output: variant("dict", { merge: none }) }, QUIET);
        expect(answer.outcome).toEqual(variant("failed", { exitCode: 1n }));
        expect(answer.stderr).toMatch(/^Error: the key "C0\d" is emitted twice, and the dict output has no merge\n$/);
        // Nothing was assembled: no output to read.
        expect(output).toBeNull();
    });

    test("its assembled output is kept by the SHA-256 of its beast2 bytes, which the answer gives — a final function that fails keeps it too (#942)", async () => {
        // No final function: the answer is the assembled output itself.
        const plain = await split(".orders | map(.id)", 3);
        if (plain.answer.outcome.type !== "success") throw new Error(`expected an answer, got ${plain.answer.outcome.type}`);
        expect(plain.output).toBe(sha256Hex(plain.answer.outcome.value.value));
        // A final function that raises: the call failed, and the fold it assembled — the same as the call whose final
        // function answers — is still kept.
        const failing = await split(".orders | map(.lines | length) | add | . % 0", 3);
        const added = await split(".orders | map(.lines | length) | add", 3);
        expect([failing.answer.outcome.type, added.answer.outcome.type]).toEqual(["failed", "success"]);
        expect(added.output).not.toBeNull();
        expect(failing.output).toBe(added.output);
    });

    test("an object argument reads an earlier call's output by its hash, as a re-keyed join's second call does; an object no call assembled is refused (#942)", async () => {
        const program = ".customers as $c | .orders | map($c[.customer_id].region) | unique";
        const planned = planQuery(program, BOTH, new Map([["orders", { bytes: 1 << 30, rows: 40 }], ["customers", { bytes: 1 << 30, rows: 8 }]]));
        if ("result" in planned || planned.plan.kind !== "rekey") throw new Error(`${program} is not re-keyed`);
        const p = planned.plan;
        const call = createInMemorySplitCall(DATASETS, { pieces: 3 });
        const first = await call(p.first, QUIET);
        const joined = await call(p.join(first.output!), QUIET);
        const [got, want] = [valueOf(queryResultOf(p.reading, p.answer(first.result, joined.result))), valueOf(await oneShot(program))];
        expect(equalFor(want.type)(got.value as never, want.value as never)).toBe(true);
        // Another stand-in assembled nothing: the hash names nothing it holds.
        const elsewhere = await createInMemorySplitCall(DATASETS, { pieces: 3 })(p.join(first.output!), QUIET);
        expect([elsewhere.result.outcome.type, elsewhere.output]).toEqual(["invalid", null]);
        if (elsewhere.result.outcome.type !== "invalid") throw new Error("expected a refusal");
        expect(elsewhere.result.outcome.value.diagnostics.map(d => d.message)).toEqual([`Object argument 1 names ${first.output!}, which the repository does not hold`]);
    });

    test("arguments partitioned together that are not dicts keyed alike are refused, and so is a call that partitions none", async () => {
        const { request } = splitOf(".customers as $c | .orders | map($c[.customer_id].region) | unique");
        const refusal = async (partitions: readonly boolean[]) => {
            const args = request.args.map((a, i) => ({ ...a, partition: partitions[i] === true ? some({ by: [] }) : none }));
            const { result } = await createInMemorySplitCall(DATASETS, { pieces: 3 })({ ...request, args }, QUIET);
            if (result.outcome.type !== "invalid") throw new Error(`expected a refusal, got ${result.outcome.type}`);
            return result.outcome.value.diagnostics.map(d => d.message);
        };
        // The customers, a dict, with the orders, a list: no keys to cut them at together.
        expect(await refusal([true, true])).toEqual(["arguments partitioned together are dicts keyed by one type: their pieces are cut at the same keys"]);
        expect(await refusal([false, false])).toEqual(["a split call partitions at least one of its arguments: its pieces are cut from it"]);
    });

    test("abandoned by its signal, it stops between pieces and rejects with the signal's reason", async () => {
        const { request } = splitOf(".orders | map(.id)");
        const controller = new AbortController();
        const reports: number[] = [];
        const call = createInMemorySplitCall(DATASETS, { pieces: 5 })(request, {
            signal: controller.signal,
            onProgress: (p) => {
                const done = Number(p.done);
                reports.push(done);
                if (done === 2) controller.abort(new Error("abandoned"));
            },
        });
        await expect(call).rejects.toThrow("abandoned");
        expect(reports).toEqual([0, 1, 2]);
    });
});

// ─── A data source's status ──────────────────────────────────────────────────

describe("createInMemorySourceStatus (#941)", () => {
    test("a collection's rows, the SHA-256 of its beast2 bytes and their length; a hash and a weight given are its own", async () => {
        const bytes = encodeBeast2For(OrdersType)(orders as never);
        const status = createInMemorySourceStatus(DATASETS);
        expect(await status(ORDERS)).toEqual({ rows: 40, hash: sha256Hex(bytes), bytes: bytes.length });
        expect((await status(CUSTOMERS)).rows).toBe(8);
        const weighed = createInMemorySourceStatus([{ path: ORDERS, type: OrdersType, value: orders, hash: "4f2a1c8d", bytes: 1 << 30 }]);
        expect(await weighed(ORDERS)).toEqual({ rows: 40, hash: "4f2a1c8d", bytes: 1 << 30 });
        // A value that is not a collection holds no rows.
        const one = createInMemorySourceStatus([{ path: ORDERS, type: IntegerType, value: 40n }]);
        expect((await one(ORDERS)).rows).toBeUndefined();
    });

    test("a path with nothing in memory is refused", async () => {
        await expect(createInMemorySourceStatus([])(ORDERS)).rejects.toThrow("createInMemorySourceStatus: nothing in memory at .inputs.orders");
    });
});
