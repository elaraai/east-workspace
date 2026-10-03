/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * What a run sends and what it gives (#938, `Query Editor Spec.md` §4.11):
 * the counting program in the visual view and the jq, canonically, in the jq
 * view; a program's canonical text; and a counting run's answer read into the
 * result, the counts and, when the run returned fewer rows, the total.
 */

import { describe, test, expect } from "vitest";
import { ArrayType, IntegerType, StructType, checkJq, encodeBeast2For, evaluateJq, none, some, variant } from "@elaraai/east";
import { SOURCE_COUNT } from "./steps/count.js";
import { parseSteps } from "./steps/parse.js";
import { checkSteps } from "./steps/check.js";
import { QUERY_HEADER_ID, type QueryHeader } from "./session.js";
import { canonicalProgram, planRun, runOutput, type RunEditor } from "./run.js";
import type { QueryResult } from "./one-shot.js";
import { FIXTURE_VALUE, FixtureType, ROOT } from "./query.test-utils.js";

const HEADER: QueryHeader = { id: QUERY_HEADER_ID, name: "Big orders", description: none, source: "orders", jq: none };

/** The open query as steps, in a view. */
function editorOf(program: string, view: RunEditor["view"] = "visual", jqText = ""): RunEditor {
    const parsed = parseSteps(program, ROOT.type);
    if ("error" in parsed) throw new Error(parsed.error.message);
    return {
        view, header: HEADER, query: parsed.query, checked: checkSteps(parsed.query, ROOT.type),
        jqText, jqChecked: view === "jq" ? checkJq(jqText, ROOT.type, { root: true }) : undefined,
    };
}

describe("run.ts (#938)", () => {
    test("a program's canonical text: the pipeline layout when it parses, the text when it does not", () => {
        expect(canonicalProgram(".orders   |  map(select(.total>=1000))")).toBe(".orders\n| map(select(.total >= 1000))");
        expect(canonicalProgram(".orders | map(")).toBe(".orders | map(");
    });

    test("the visual view sends the counting program, fresh against the steps' canonical program", () => {
        const plan = planRun(editorOf(".orders\n| map(select(.total >= 1000))"), ROOT);
        expect(plan.canonical).toBe(".orders\n| map(select(.total >= 1000))");
        expect(plan.program.endsWith("{counts: [$n0, $n1], result: .[:1000]}")).toBe(true);
        expect(plan.counted).toHaveLength(2);
        expect([plan.counted![0], plan.shape?.kind, plan.name, plan.description]).toEqual([SOURCE_COUNT, "rows", "Big orders", none]);
    });

    test("the jq view sends the jq, canonically, and a header's jq is sent as written when it does not parse", () => {
        const plan = planRun(editorOf(".orders", "jq", ".orders  |  length"), ROOT);
        expect([plan.program, plan.canonical, plan.counted, plan.shape?.kind]).toEqual([".orders\n| length", ".orders\n| length", undefined, "one"]);
        const broken = planRun({ ...editorOf(".orders"), view: "jq", header: { ...HEADER, jq: some(".orders | map(") }, jqText: ".orders | map(" }, ROOT);
        expect([broken.program, broken.counted]).toEqual([".orders | map(", undefined]);
    });

    test("a counting run's answer: the result, the counts by stage, and the total when the run returned fewer rows", () => {
        const plan = planRun(editorOf(".orders\n| map(select(.total >= 1000))"), ROOT);
        const answer = evaluateJq(plan.program, FIXTURE_VALUE, { inputType: FixtureType, root: true });
        const type = checkJq(plan.program, ROOT.type, { root: true }).elementType!;
        const result: QueryResult = { inputs: [], query: none, outcome: variant("ok", { outputs: 1n, result: encodeBeast2For(type)(answer as never), truncated: false }) };
        const output = runOutput(plan, result)!;
        expect(output.counts!.get(SOURCE_COUNT)).toBe(40);
        expect(output.total).toBeUndefined();
        expect((output.value as unknown[]).length).toBe(output.counts!.get(plan.counted![1]!));
        // A counting answer that returned fewer rows than it counted: the total is the last count.
        const Row = StructType({ id: IntegerType });
        const Cut = StructType({ counts: ArrayType(IntegerType), result: ArrayType(Row) });
        const cut = encodeBeast2For(Cut)({ counts: [4210n, 4210n], result: [{ id: 1n }, { id: 2n }] });
        const read = runOutput(plan, { inputs: [], query: none, outcome: variant("ok", { outputs: 1n, result: cut, truncated: false }) })!;
        expect([read.total, (read.value as unknown[]).length, read.truncated]).toEqual([4210, 2, false]);
    });

    test("a run that gave no result gives no output", () => {
        const plan = planRun(editorOf(".orders"), ROOT);
        expect(runOutput(plan, { inputs: [], query: none, outcome: variant("timed_out", { ms: 30_000n }) })).toBeUndefined();
    });
});

describe("run.ts — what a split run sends (#941)", () => {
    test("the visual view: the query, a rows result followed by its counts — the last counted stage's — and the source whose stored rows count", () => {
        const plan = planRun(editorOf(".orders\n| map(select(.total >= 1000))"), ROOT);
        expect(plan.split).toEqual({
            program: ".orders\n| map(select(.total >= 1000))\n| {counts: [length], result: .[:1000]}",
            counted: [plan.counted![1]!],
            source: "orders",
        });
        // One value: the query itself, which answers the value alone.
        const count = planRun(editorOf(".orders\n| map(select(.total >= 1000))\n| length"), ROOT);
        expect(count.split).toEqual({ program: ".orders\n| map(select(.total >= 1000))\n| length", counted: undefined, source: "orders" });
    });

    test("the jq view: the jq, canonically, with no counts", () => {
        const plan = planRun(editorOf(".orders", "jq", ".orders  |  map(.id)"), ROOT);
        expect(plan.split).toEqual({ program: ".orders\n| map(.id)", counted: undefined, source: undefined });
    });

    test("a split run's answer: the source's count as its stored rows, the result's as the call counted them, and nothing between", () => {
        const plan = planRun(editorOf(".orders\n| map(select(.total >= 1000))"), ROOT);
        const Row = StructType({ id: IntegerType });
        const Cut = StructType({ counts: ArrayType(IntegerType), result: ArrayType(Row) });
        const answer = encodeBeast2For(Cut)({ counts: [4210n], result: [{ id: 1n }, { id: 2n }] });
        const read = runOutput(plan.split, { inputs: [], query: none, outcome: variant("ok", { outputs: 1n, result: answer, truncated: false }) }, new Map([[SOURCE_COUNT, 90_000]]))!;
        expect([...read.counts!.entries()]).toEqual([[SOURCE_COUNT, 90_000], [plan.counted![1]!, 4210]]);
        expect([read.total, (read.value as unknown[]).length]).toEqual([4210, 2]);
        // An answer that is the result alone keeps the counts known before it.
        const one = runOutput({ counted: undefined }, { inputs: [], query: none, outcome: variant("ok", { outputs: 1n, result: encodeBeast2For(IntegerType)(7n), truncated: false }) }, new Map([[SOURCE_COUNT, 40]]))!;
        expect([one.value, [...one.counts!.entries()]]).toEqual([7n, [[SOURCE_COUNT, 40]]]);
    });
});
