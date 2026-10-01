/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A query's one-shot call answered in memory (#940), as the showcase makes
 * one: what a run reads and the hash it pins it at; an argument naming
 * nothing, refused as e3 refuses an unassigned dataset; the size limit; and a
 * runtime error, failed as a runner fails it, placed in the jq.
 */

import { describe, test, expect } from "vitest";
import { IntegerType, decodeBeast2For, encodeBeast2For, sha256Hex, toEastTypeValue } from "@elaraai/east";
import { createInMemoryQueryCall } from "./in-memory-call.js";
import { prepareQuery, queryResultOf, queryRoot } from "./one-shot.js";
import { FIXTURE_VALUE, ORDERS, OrdersType } from "./query.test-utils.js";

const orders = (FIXTURE_VALUE as Readonly<Record<string, unknown>>)["orders"];
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
