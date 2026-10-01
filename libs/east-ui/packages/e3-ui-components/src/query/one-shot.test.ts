/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A query's one-shot call (#935), over #875's shared fixture
 * (`libs/east/test/fixtures/query-fixture.beast2`): C1 the root and its name
 * errors; C2 the request — platform-free, one dataset argument per dataset
 * read, from one check against the whole root — and the programs that do not
 * check; C3 every outcome of a call mapped, truncation exactly. A request's
 * body is decoded from its bytes and run here over the fixture's datasets, as
 * a runner runs it; each outcome is an `ExecuteResult` built as e3 builds
 * one, a failure's stderr as the runners write it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
    ArrayType, East, EastError, IntegerType, OptionType, QueryError, StringType, StructType,
    checkJq, decodeBeast2, decodeBeast2For, decodeEastIR, encodeBeast2For, encodeEastIR, equalFor, evaluateJq,
    fromEastTypeValue, isTypeEqual, none, parseJq, some, translateJq, variant, walkIR,
    type EastType, type EastTypeValue, type QueryDiagnostic,
} from "@elaraai/east";
import { TreePathType, type ExecuteResult, type OneShotRequest, type RunnerValue, type TreePath } from "@elaraai/e3-types";
import { prepareQuery, queryResultOf, queryRoot, type PreparedQuery, type QueryOptions, type QueryResult, type QueryRootEntry } from "./one-shot.js";

// ─── The fixture as a root ───────────────────────────────────────────────────

/** The shared fixture: its root type and its datasets. */
const fixture = decodeBeast2(readFileSync(join(import.meta.dirname, "../../../../../east/test/fixtures/query-fixture.beast2")));
const ROOT_TYPE: EastType = fromEastTypeValue(fixture.type);
const DATASETS = fixture.value as Readonly<Record<string, unknown>>;

/** A dataset's path: an input of the workspace. */
const pathOf = (name: string): TreePath => [variant("field", "inputs"), variant("field", name)];
const samePath = equalFor(TreePathType);

/** The fields of the fixture's root type: its datasets' names and types, in its order. */
function rootFields(type: EastTypeValue): { name: string; type: EastTypeValue }[] {
    if (type.type !== "Struct") throw new Error(`the fixture's root is a Struct, not ${type.type}`);
    return type.value;
}

/** The fixture's datasets as a root's data sources, in its order: bom, byId, cells, customers, forecast, model, orders. */
const ENTRIES: QueryRootEntry[] = rootFields(fixture.type).map(({ name, type }) => ({ name, path: pathOf(name), type }));
const ROOT = queryRoot(ENTRIES);

/** A data source of the fixture's root, by name. */
function entry(name: string): QueryRootEntry {
    const found = ENTRIES.find(e => e.name === name);
    if (found === undefined) throw new Error(`the fixture has no dataset ${name}`);
    return found;
}

/** The hash e3 pins each dataset the tests read at. */
const HASHES: ReadonlyMap<string, string> = new Map([
    ["customers", "9b07e3a4".repeat(8)],
    ["model", "5d1e0b77".repeat(8)],
    ["orders", "4f2a1c8d".repeat(8)],
]);

/** The hash e3 pins a dataset at, by its data source's name. */
function hashOf(name: string): string {
    const hash = HASHES.get(name);
    if (hash === undefined) throw new Error(`no hash for ${name}`);
    return hash;
}

/** A dataset a result names as read: its hash, its data source's name and its path. */
const read = (name: string): QueryResult["inputs"][number] => ({ hash: hashOf(name), name, path: pathOf(name) });

/** The query editor mock's default query (`Query Editor Spec.md` §4.7): it reads customers, then orders. */
const DEFAULT_QUERY = [
    ".customers as $customers",
    "| .orders",
    "| map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))",
    "| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})",
    "| map({order: .id, customer: .name, region, total, shipped: .status.value.date})",
    "| sort_by(-.total)",
    "| .[:10]",
].join("\n");

// ─── Calls, run as a runner runs them ────────────────────────────────────────

/** A program's prepared call; the test fails when the program does not check. */
function prepared(program: string, options?: QueryOptions): PreparedQuery {
    const outcome = prepareQuery(program, ROOT, options);
    if (!("prepared" in outcome)) throw new Error(`${program} does not check: ${outcome.result.outcome.type}`);
    return outcome.prepared;
}

/** A program's `error` result; the test fails when the program checks. */
function refusedResult(program: string): QueryResult {
    const outcome = prepareQuery(program, ROOT);
    if (!("result" in outcome)) throw new Error(`${program} checks`);
    return outcome.result;
}

/** The fixture's dataset a call's argument names. */
function datasetOf(arg: OneShotRequest["args"][number]): { name: string; value: unknown } {
    if (arg.type !== "dataset") throw new Error("a query's call has dataset arguments only");
    const found = ENTRIES.find(e => samePath(e.path, arg.value));
    if (found === undefined) throw new Error("an argument names no dataset of the fixture");
    return { name: found.name, value: DATASETS[found.name] };
}

/**
 * Runs a call's body here, as a runner runs it: decoded from its bytes,
 * compiled with no platform function, called on the datasets its arguments
 * name, and its value written at the function's own output type.
 */
function run(call: PreparedQuery): Uint8Array {
    const body = decodeEastIR(call.request.bodyIr);
    const type = fromEastTypeValue(body.ir.value.type);
    if (type.type !== "Function") throw new Error("the body is a function");
    const value = body.compile([])(...call.request.args.map(arg => datasetOf(arg).value));
    return encodeBeast2For(type.output)(value);
}

/**
 * What a runner writes on stderr when a call's body raises an error: the
 * body, decoded from the request, run here, and its error framed as every
 * runner frames one — `Error: <message>`, then `  at <file>:<line>:<column>`.
 */
function stderrOf(call: PreparedQuery): string {
    try {
        run(call);
    } catch (e) {
        if (e instanceof EastError) return `Error: ${e.toString()}\n`;
        throw e;
    }
    throw new Error("the call's body raises no error");
}

/** What e3 returns for a call that ran: each dataset argument pinned at its hash, in argument order. */
function executed(call: PreparedQuery, outcome: ExecuteResult["outcome"], stderr = ""): ExecuteResult {
    return {
        outcome,
        stdout: "",
        stderr,
        stdoutTruncated: false,
        stderrTruncated: false,
        inputs: call.request.args.map(arg => {
            const { name } = datasetOf(arg);
            return { path: pathOf(name), hash: hashOf(name) };
        }),
    };
}

/** What e3 returns for a call it refused before running it, as e3-core's `invalidExecuteResult` builds it. */
function invalid(message: string): ExecuteResult {
    return {
        outcome: variant("invalid", { diagnostics: [{ message, filename: none, line: none, column: none }] }),
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        inputs: [],
    };
}

/** The platform functions a body calls, at any depth: what e3 refuses a reader's one-shot for. */
function platformCalls(bodyIr: Uint8Array): string[] {
    const names: string[] = [];
    walkIR(decodeEastIR(bodyIr).ir, node => {
        if (node.type === "Platform") names.push(node.value.name);
    });
    return names;
}

/** The diagnostics of the error a program raises when `evaluateJq` runs it over the fixture. */
function raisedBy(program: string): QueryDiagnostic[] {
    try {
        evaluateJq(program, fixture.value, { inputType: ROOT_TYPE, root: true });
    } catch (e) {
        if (e instanceof QueryError) return e.diagnostics;
        throw e;
    }
    throw new Error(`${program} raises no error`);
}

/** A runtime diagnostic, as the results hold one. */
const runtime = (message: string, span: QueryDiagnostic["span"] = none): QueryDiagnostic =>
    ({ code: "runtime", fixes: [], message, severity: variant("error", null), span, suggestions: [] });

/** East-c, given no platform package, each collection read lazily. */
const PLATFORM_FREE_EAST_C: RunnerValue = variant("east_c", { decode: variant("lazy", null), platforms: [] });

// ─── C1: the root ────────────────────────────────────────────────────────────

describe("C1: the root", () => {
    test("the root is a Struct of the data sources' types, in entry order", () => {
        expect(isTypeEqual(ROOT.type, ROOT_TYPE)).toBe(true);
        expect(ROOT.entries).toEqual(ENTRIES);
        const orders = entry("orders");
        const customers = entry("customers");
        const swapped = queryRoot([orders, customers]);
        expect(isTypeEqual(swapped.type, StructType({ orders: fromEastTypeValue(orders.type), customers: fromEastTypeValue(customers.type) }))).toBe(true);
        expect(isTypeEqual(swapped.type, StructType({ customers: fromEastTypeValue(customers.type), orders: fromEastTypeValue(orders.type) }))).toBe(false);
    });

    test("a name that is not a jq identifier is refused, naming it; a jq field name of any kind is taken", () => {
        const orders = entry("orders");
        expect(() => queryRoot([{ ...orders, name: "order lines" }])).toThrow(new Error(
            "queryRoot: \"order lines\" is not a jq identifier: a data source's name is a letter or _, then letters, digits and _, so .name reads it"));
        expect(() => queryRoot([{ ...orders, name: "2026" }])).toThrow(new Error(
            "queryRoot: \"2026\" is not a jq identifier: a data source's name is a letter or _, then letters, digits and _, so .name reads it"));
        expect(() => queryRoot([{ ...orders, name: "" }])).toThrow(new Error(
            "queryRoot: \"\" is not a jq identifier: a data source's name is a letter or _, then letters, digits and _, so .name reads it"));
        // A keyword is a field name too: `.if` reads the data source called if.
        const keyword = queryRoot([{ ...orders, name: "_orders" }, { ...entry("customers"), name: "if" }]);
        const outcome = prepareQuery(".if | length", keyword);
        if (!("prepared" in outcome)) throw new Error(".if does not check");
        expect(outcome.prepared.request.args).toEqual([variant("dataset", pathOf("customers"))]);
    });

    test("a name given twice is refused, naming it", () => {
        expect(() => queryRoot([entry("orders"), entry("customers"), { ...entry("bom"), name: "orders" }])).toThrow(new Error(
            "queryRoot: \"orders\" is given twice: each data source of a root has a name of its own"));
    });

    test("no data sources make the empty root, and a query that reads one is refused when it is checked", () => {
        const empty = queryRoot([]);
        expect(isTypeEqual(empty.type, StructType({}))).toBe(true);
        expect(empty.entries).toEqual([]);
        const outcome = prepareQuery(".orders", empty);
        if (!("result" in outcome)) throw new Error(".orders checks against the empty root");
        expect(outcome.result.outcome).toEqual(variant("error", [{
            code: "unknown_field", fixes: [], message: "unknown_field: .orders is not a dataset in this workspace.",
            severity: variant("error", null), span: some({ column: 1n, length: 7n, line: 1n, offset: 0n }), suggestions: [],
        }]));
    });
});

// ─── C2: the request ─────────────────────────────────────────────────────────

describe("C2: the request", () => {
    test("the default query's call: one dataset argument per dataset read, in the translation's order", () => {
        const call = prepared(DEFAULT_QUERY);
        const checked = checkJq(DEFAULT_QUERY, ROOT_TYPE, { root: true });
        expect(translateJq(checked).inputs.map(i => i.name)).toEqual(["customers", "orders"]);
        expect(call.entries).toEqual([entry("customers"), entry("orders")]);
        expect(call.request.args).toEqual([variant("dataset", pathOf("customers")), variant("dataset", pathOf("orders"))]);
        expect(call.request.limits).toEqual(some({ timeoutMs: some(30_000n), maxResultBytes: some(1_048_576n), maxLogBytes: none }));
        expect(call.maxOutputs).toBe(1_000);
        expect(call.query).toEqual(checked.query);
    });

    test("the call is platform-free: east-c given no platform package, and a body with no Platform node", () => {
        const call = prepared(DEFAULT_QUERY);
        expect(call.request.runner).toEqual(PLATFORM_FREE_EAST_C);
        expect(platformCalls(call.request.bodyIr)).toEqual([]);
        // The same walk finds a platform call where a body makes one.
        const log = East.platform("console_log", [StringType], StringType);
        const logging = East.function([StringType], StringType, ($, text) => {
            $(log(text));
            return text;
        });
        expect(platformCalls(encodeEastIR(logging.toIR()))).toEqual(["console_log"]);
    });

    test("the body is the query's translation: run over the fixture, it answers as evaluateJq does", () => {
        const answer = decodeBeast2(run(prepared(DEFAULT_QUERY)));
        expect(answer.value).toHaveLength(10);
        expect(answer.value).toEqual(evaluateJq(DEFAULT_QUERY, fixture.value, { inputType: ROOT_TYPE, root: true }));
    });

    test("the options set the limits and the runner; maxOutputs is at most 100 000, and a limit is a whole number", () => {
        const runner: RunnerValue = variant("east_node", { decode: variant("whole", null), platforms: [] });
        const call = prepared(".orders[] | .id", { maxOutputs: 250_000, maxBytes: 4_096, timeoutMs: 5_000, runner });
        expect(call.maxOutputs).toBe(100_000);
        expect(call.request.limits).toEqual(some({ timeoutMs: some(5_000n), maxResultBytes: some(4_096n), maxLogBytes: none }));
        expect(call.request.runner).toEqual(runner);
        expect(() => prepareQuery(".orders | length", ROOT, { maxOutputs: 0 })).toThrow(new RangeError(
            "prepareQuery: maxOutputs is 0, not a whole number of at least 1"));
        expect(() => prepareQuery(".orders | length", ROOT, { timeoutMs: 1.5 })).toThrow(new RangeError(
            "prepareQuery: timeoutMs is 1.5, not a whole number of at least 1"));
    });
});

describe("C2: one check against the whole root", () => {
    test("keys on the root answers every name, though the query reads no dataset", () => {
        const call = prepared("keys");
        expect(call.request.args).toEqual([]);
        expect(decodeBeast2For(ArrayType(StringType))(run(call))).toEqual(["bom", "byId", "cells", "customers", "forecast", "model", "orders"]);
    });

    test("a query that reads one dataset is checked against them all, and is given that one", () => {
        const call = prepared("{names: keys, orders: (.orders | length), model: has(\"model\")}");
        expect(call.request.args).toEqual([variant("dataset", pathOf("orders"))]);
        expect(isTypeEqual(fromEastTypeValue(call.query.value.input_type), ROOT_TYPE)).toBe(true);
        expect(decodeBeast2(run(call)).value).toEqual({
            names: ["bom", "byId", "cells", "customers", "forecast", "model", "orders"], orders: 40n, model: true,
        });
    });
});

describe("C2: a program that does not check", () => {
    test("a program that fails its check is an error result of the checker's diagnostics, and no query, since nothing ran", () => {
        const program = ".orders | map(.totl)";
        const result = refusedResult(program);
        expect(result).toEqual({
            inputs: [],
            outcome: variant("error", checkJq(program, ROOT_TYPE, { root: true }).diagnostics),
            query: none,
        });
        expect(result.outcome.type === "error" ? result.outcome.value.map(d => d.message) : []).toEqual([
            "unknown_field: .totl is not a field of Struct{customer_id: String, discount: Option<Float>, id: Integer, " +
            "lines: Array<Struct{price: Float, qty: Integer, sku: String}>, status: Variant{cancelled, pending, shipped}, total: Float}. Did you mean .total?",
        ]);
    });

    test("reading the whole root is refused, naming the datasets to read instead", () => {
        expect(refusedResult(".")).toEqual({
            inputs: [],
            outcome: variant("error", [{
                code: "unsupported", fixes: [], message: "unsupported: reading the whole root loads every dataset — name them: .bom, .byId, .cells, ….",
                severity: variant("error", null), span: some({ column: 1n, length: 1n, line: 1n, offset: 0n }), suggestions: [],
            }]),
            query: none,
        });
    });

    test("a program that does not parse is an error result of the parser's diagnostics", () => {
        expect(refusedResult(".orders |")).toEqual({
            inputs: [],
            outcome: variant("error", parseJq(".orders |").diagnostics),
            query: none,
        });
    });
});

// ─── C3: every outcome of a call ─────────────────────────────────────────────

describe("C3: every outcome of a call", () => {
    test("success: the answer as the run returned it, its outputs, and each dataset read with its hash", () => {
        const call = prepared(DEFAULT_QUERY);
        const bytes = run(call);
        expect(queryResultOf(call, executed(call, variant("success", { value: bytes })))).toEqual({
            inputs: [read("customers"), read("orders")],
            outcome: variant("ok", { outputs: 1n, result: bytes, truncated: false }),
            query: some(call.query),
        });
    });

    test("success: a maybe answer holds one output, or none", () => {
        const found = prepared("first(.orders[] | select(.total > 1000)) | .id");
        const one = run(found);
        expect(decodeBeast2For(OptionType(IntegerType))(one)).toEqual(some(1002n));
        expect(queryResultOf(found, executed(found, variant("success", { value: one }))).outcome).toEqual(
            variant("ok", { outputs: 1n, result: one, truncated: false }));
        const missing = prepared("first(.orders[] | select(.total > 100000)) | .id");
        const nothing = run(missing);
        expect(decodeBeast2For(OptionType(IntegerType))(nothing)).toEqual(none);
        expect(queryResultOf(missing, executed(missing, variant("success", { value: nothing }))).outcome).toEqual(
            variant("ok", { outputs: 0n, result: nothing, truncated: false }));
    });

    test("success: a many answer of maxOutputs + 1 outputs is truncated, its last dropped; of maxOutputs or fewer, it is whole", () => {
        const ids = ArrayType(IntegerType);
        const answer = (program: string): { call: PreparedQuery; bytes: Uint8Array } => {
            const call = prepared(program, { maxOutputs: 3 });
            return { call, bytes: run(call) };
        };
        for (const [program, outputs] of [[".orders[:2][] | .id", 2n], [".orders[:3][] | .id", 3n]] as const) {
            const { call, bytes } = answer(program);
            expect(queryResultOf(call, executed(call, variant("success", { value: bytes })))).toEqual({
                inputs: [read("orders")],
                outcome: variant("ok", { outputs, result: bytes, truncated: false }),
                query: some(call.query),
            });
        }
        // Four outputs, one more than three: truncated, the fourth dropped.
        const four = answer(".orders[:4][] | .id");
        expect(decodeBeast2For(ids)(four.bytes)).toEqual([1001n, 1002n, 1003n, 1004n]);
        const truncated = variant("ok", { outputs: 3n, result: encodeBeast2For(ids)([1001n, 1002n, 1003n]), truncated: true });
        expect(queryResultOf(four.call, executed(four.call, variant("success", { value: four.bytes })))).toEqual({
            inputs: [read("orders")], outcome: truncated, query: some(four.call.query),
        });
        // Forty orders: the translation stops at maxOutputs + 1.
        const forty = answer(".orders[] | .id");
        expect(decodeBeast2For(ids)(forty.bytes)).toEqual([1001n, 1002n, 1003n, 1004n]);
        const result = queryResultOf(forty.call, executed(forty.call, variant("success", { value: forty.bytes })));
        expect(result.outcome).toEqual(truncated);
        // What is kept is self-describing beast2, at the query's result type.
        if (result.outcome.type !== "ok") throw new Error(`the answer is ${result.outcome.type}`);
        const kept = decodeBeast2(result.outcome.value.result);
        expect(isTypeEqual(fromEastTypeValue(kept.type), ids)).toBe(true);
        expect(kept.value).toEqual([1001n, 1002n, 1003n]);
    });

    test("failed: a runtime error is placed in the jq, as evaluateJq places it", () => {
        const cases = [
            {
                program: ".orders\n| map(if .id > 1001 then error(\"boom \\(.id)\") else .id end)",
                stderr: "Error: boom 1002\n  at jq:2:26\n",
                raised: runtime("runtime: boom 1002", some({ column: 26n, length: 20n, line: 2n, offset: 33n })),
            },
            {
                // `.total / …`, `.total` and its `.` all start where the division raised: the place
                // is `.total`, the innermost that can raise, as `.` cannot.
                program: ".orders | map(.total / (.id - .id))",
                stderr: "Error: Division by zero\n  at jq:1:15\n",
                raised: runtime("runtime: Division by zero", some({ column: 15n, length: 6n, line: 1n, offset: 14n })),
            },
        ];
        for (const { program, stderr, raised } of cases) {
            const call = prepared(program);
            // The request's body names the place in the jq: run, it raises what east-c wrote for it.
            expect(stderrOf(call)).toBe(stderr);
            expect(raisedBy(program)).toEqual([raised]);
            expect(queryResultOf(call, executed(call, variant("failed", { exitCode: 1n }), stderr))).toEqual({
                inputs: [read("orders")],
                outcome: variant("error", [raised]),
                query: some(call.query),
            });
        }
    });

    test("failed: an error placed outside the jq, and a run that says no error, are errors of what was said", () => {
        const call = prepared(".orders | length");
        const failedWith = (exitCode: bigint, stderr: string): QueryResult["outcome"] =>
            queryResultOf(call, executed(call, variant("failed", { exitCode }), stderr)).outcome;
        expect(failedWith(1n, "Error: Function expects 2 inputs, got 1\nSignature: (Array<Order>, Integer) -> Integer\n")).toEqual(variant("error", [
            runtime("runtime: Function expects 2 inputs, got 1\nSignature: (Array<Order>, Integer) -> Integer"),
        ]));
        expect(failedWith(-1n, "e3: the guard stopped the runner at 512 MiB, with the machine nearly out of memory")).toEqual(variant("error", [
            runtime("runtime: e3: the guard stopped the runner at 512 MiB, with the machine nearly out of memory"),
        ]));
        expect(failedWith(-1n, "")).toEqual(variant("error", [runtime("runtime: the run failed with exit code -1")]));
    });

    test("failed: a platform function the runner cannot find is needs_platform, naming it", () => {
        const call = prepared("call(.model; {price: 10.0, region: \"NSW\"})");
        expect(call.request.args).toEqual([variant("dataset", pathOf("model"))]);
        // What east-c writes when the model the call reads calls console_log, which it has not loaded.
        expect(queryResultOf(call, executed(call, variant("failed", { exitCode: 1n }), "Error: Unknown platform function: console_log\n  at jq:1:1\n  at jq:1:1\n"))).toEqual({
            inputs: [read("model")],
            outcome: variant("needs_platform", { functions: ["console_log"] }),
            query: some(call.query),
        });
        // east-node and east-py say so as they compile the model, and of one marked optional as they call
        // it; and said without the runners' `Error:` lead, it is still named.
        for (const [stderr, functions] of [
            ["Error: Platform function 'console_error' not found at an unknown location\n", ["console_error"]],
            ["Error: Platform function 'fs_read_file' is not available\n  at jq:1:1\n", ["fs_read_file"]],
            ["Platform function 'fs_read_file' not found\n", ["fs_read_file"]],
        ] as const) {
            expect(queryResultOf(call, executed(call, variant("failed", { exitCode: 1n }), stderr)).outcome).toEqual(
                variant("needs_platform", { functions: [...functions] }));
        }
    });

    test("invalid: a dataset with no value yet, by its data source's name; anything else e3 refused, as it said it", () => {
        const call = prepared(DEFAULT_QUERY);
        expect(queryResultOf(call, invalid("Dataset argument 1 is not assigned (ref type: unassigned)"))).toEqual({
            inputs: [],
            outcome: variant("error", [{
                code: "no_value", fixes: [], message: "no_value: orders has no value yet.", severity: variant("error", null), span: none, suggestions: [],
            }]),
            query: some(call.query),
        });
        expect(queryResultOf(call, invalid("the body does not decode as a function: Invalid Beast2 magic at offset 0")).outcome).toEqual(variant("error", [{
            code: "invalid", fixes: [], message: "invalid: the body does not decode as a function: Invalid Beast2 magic at offset 0",
            severity: variant("error", null), span: none, suggestions: [],
        }]));
    });

    test("timed_out and too_large, as e3 reported them", () => {
        const call = prepared(DEFAULT_QUERY);
        expect(queryResultOf(call, executed(call, variant("timed_out", { ms: 30_000n })))).toEqual({
            inputs: [read("customers"), read("orders")],
            outcome: variant("timed_out", { ms: 30_000n }),
            query: some(call.query),
        });
        expect(queryResultOf(call, executed(call, variant("too_large", { bytes: 2_097_152n, limit: 1_048_576n })))).toEqual({
            inputs: [read("customers"), read("orders")],
            outcome: variant("too_large", { bytes: 2_097_152n, limit: 1_048_576n }),
            query: some(call.query),
        });
    });

    test("success: an answer that is not at the query's result type is refused", () => {
        const answeredWith = (program: string, value: Uint8Array): QueryResult => {
            const call = prepared(program);
            return queryResultOf(call, executed(call, variant("success", { value })));
        };
        expect(() => answeredWith(".orders | length", encodeBeast2For(StringType)("40"))).toThrow(new Error(
            "beast2: cannot decode a blob of type .String as .Integer"));
        expect(() => answeredWith("first(.orders[] | select(.total > 1000)) | .id", encodeBeast2For(IntegerType)(1002n))).toThrow(new Error(
            "beast2: cannot decode a blob of type .Integer as .Variant [(name=\"none\", type=.Null), (name=\"some\", type=.Integer)]"));
        expect(() => answeredWith(".orders[] | .id", encodeBeast2For(ArrayType(StringType))(["1001"]))).toThrow(new Error(
            "beast2: cannot decode a blob of type .Array .String as .Array .Integer"));
    });

    test("a result that is not the call's is refused", () => {
        const call = prepared(DEFAULT_QUERY);
        const other = prepared(".orders | length");
        expect(() => queryResultOf(call, executed(other, variant("success", { value: run(other) })))).toThrow(new Error(
            "queryResultOf: the call's argument 0 read .inputs.orders, which is not the data source the query reads there"));
    });
});
