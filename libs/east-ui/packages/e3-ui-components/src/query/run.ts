/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runs (#938) — a query read on e3 (`Query Editor Spec.md` §4.11). The
 * builder prepares each run itself, as one one-shot call over its root, with
 * the call's limits (#935):
 *
 * - **what runs** ({@link planRun}): in the visual view, the counting program
 *   (#933), so one run gives the result and every shape line's count; in the
 *   jq view, the jq as typed, printed canonically when it parses — a text that
 *   does not parse is never sent, its run being the checker's refusal;
 * - **one at a time** ({@link useQueryRun}): a new run abandons the one
 *   before, whose answer is dropped when it lands; while it goes, the run
 *   names the data sources it reads;
 * - **what came back** ({@link runOutput}): the result's type and value, the
 *   counts, and whether the rows were cut;
 * - **fresh or stale** ({@link canonicalProgram}): a result is fresh while
 *   the query's canonical program is the one it ran.
 *
 * Runs happen on Run, ⌘⏎ and the opening of a saved query — never on an edit.
 *
 * @packageDocumentation
 */

import { useCallback, useRef, useState } from "react";
import {
    decodeBeast2, fromEastTypeValue, parseJq, printJq,
    type CheckJqResult, type EastType, type option,
} from "@elaraai/east";
import { ApiError, AuthError } from "@elaraai/e3-api-client";
import type { QueryCall } from "./hooks.js";
import { prepareQuery, queryResultOf, type QueryResult, type QueryRoot } from "./one-shot.js";
import type { QueryHeader } from "./session.js";
import type { CheckedSteps } from "./steps/check.js";
import { countingProgram, readCounts } from "./steps/count.js";
import { printSteps } from "./steps/print.js";
import { shapeOf, type Shape } from "./steps/shape.js";
import type { StepQuery } from "./steps/values.js";
import type { QueryView } from "./toolbar.js";

/** The most rows a visual run returns; the counting program counts them all. */
export const RUN_MAX_ROWS = 1000;

/**
 * A program's canonical text: printed in the pipeline layout when it parses,
 * as written when it does not — what a result is fresh against.
 *
 * @param program - the program's text
 * @returns its canonical text
 */
export function canonicalProgram(program: string): string {
    const parsed = parseJq(program);
    return parsed.program.type === "some" ? printJq(parsed.program.value, { layout: "pipeline" }).text : program;
}

/** What a run sends, and what reading its answer needs. */
export interface RunPlan {
    /** The program the call runs: the counting program, or the jq. */
    readonly program: string;
    /** The query's own program, canonical: what its result is fresh against. */
    readonly canonical: string;
    /** What each of the counting program's counts is of — `undefined` for a jq run. */
    readonly counted: readonly string[] | undefined;
    /** The shape the query gives, as the editor knew it when it ran: what its rows are called. */
    readonly shape: Shape | undefined;
    /** The query's name and description when it ran: what its recent query is called. */
    readonly name: string;
    readonly description: option<string>;
}

/** What planning a run needs of the open query. */
export interface RunEditor {
    /** The view shown. */
    readonly view: QueryView;
    /** The header: its jq, when the program is not steps. */
    readonly header: QueryHeader;
    /** The steps. */
    readonly query: StepQuery;
    /** The steps' check; `undefined` while the program is jq. */
    readonly checked: CheckedSteps | undefined;
    /** The jq as typed, in the jq view. */
    readonly jqText: string;
    /** The jq view's check of it. */
    readonly jqChecked: CheckJqResult | undefined;
}

/**
 * What a run of the open query sends.
 *
 * @param editor - the open query, as the editor holds it
 * @param root - the root
 * @returns the plan: in the visual view the counting program, in the jq view the jq
 */
export function planRun(editor: RunEditor, root: QueryRoot): RunPlan {
    const { view, header, query, checked, jqText, jqChecked } = editor;
    if (view === "visual" && header.jq.type === "none") {
        const plain = printSteps(query, root.type).text;
        const counting = countingProgram(query, root.type, { maxRows: RUN_MAX_ROWS });
        return {
            program: counting.text, canonical: canonicalProgram(plain), counted: counting.counted, shape: checked?.final,
            name: header.name, description: header.description,
        };
    }
    const text = view === "jq" ? jqText : header.jq.type === "some" ? header.jq.value : jqText;
    const canonical = canonicalProgram(text);
    const shape = jqChecked !== undefined && jqChecked.elementType !== null
        ? shapeOf(jqChecked.elementType, jqChecked.multiplicity, { noun: "row" })
        : undefined;
    return { program: canonical, canonical, counted: undefined, shape, name: header.name, description: header.description };
}

/** What a run that answered gave: the query's result, and what the counting program counted. */
export interface RunOutput {
    /** The result's type: `T`, `Option<T>` or `Array<T>` by the query's multiplicity. */
    readonly type: EastType;
    /** The result. */
    readonly value: unknown;
    /** The rows each stage gave, by step id (`SOURCE_COUNT` for the source's): a visual run's. */
    readonly counts: ReadonlyMap<string, number> | undefined;
    /** The rows the query gives in all, when the run returned fewer: the counting program's last count. */
    readonly total: number | undefined;
    /** Whether the answer was cut at the call's most outputs, its total unknown: a jq run's. */
    readonly truncated: boolean;
}

/**
 * Reads a run's answer.
 *
 * @param plan - the run's plan
 * @param result - what the call answered
 * @returns the result and its counts; `undefined` for a run that gave no result
 * @throws {Error} When a counting run's answer does not hold one count per counted stage.
 */
export function runOutput(plan: RunPlan, result: QueryResult): RunOutput | undefined {
    if (result.outcome.type !== "ok") return undefined;
    const { result: bytes, truncated } = result.outcome.value;
    const decoded = decodeBeast2(bytes);
    const type = fromEastTypeValue(decoded.type);
    if (plan.counted === undefined) return { type, value: decoded.value, counts: undefined, total: undefined, truncated };
    if (type.type !== "Struct") throw new Error("runOutput: a counting run answers {counts, result}");
    const read = readCounts(decoded.value as { counts: bigint[]; result: unknown }, plan.counted);
    const resultType = (type.fields as Record<string, EastType>)["result"]!;
    const last = plan.counted.length === 0 ? undefined : read.counts.get(plan.counted[plan.counted.length - 1]!);
    const shown = resultType.type === "Array" ? (read.value as readonly unknown[]).length : undefined;
    const total = last !== undefined && shown !== undefined && last > shown ? last : undefined;
    return { type: resultType, value: read.value, counts: read.counts, total, truncated: false };
}

/** Where the builder's run stands. */
export type RunState =
    | { readonly status: "idle" }
    /** A run going: its number, its plan, and the data sources it reads. */
    | { readonly status: "running"; readonly n: number; readonly plan: RunPlan; readonly reads: readonly string[] }
    /** A run answered — a result, or the checker's, the runner's or e3's refusal. */
    | {
        readonly status: "done"; readonly n: number; readonly plan: RunPlan; readonly result: QueryResult;
        readonly output: RunOutput | undefined; readonly at: Date; readonly ms: number;
    }
    /** A call that never answered: unreachable, or refused by the server. */
    | {
        readonly status: "failed"; readonly n: number; readonly plan: RunPlan; readonly reason: "unreachable" | "refused";
        readonly message: string; readonly at: Date;
    };

/** Whether an error is the server's refusal of the call, not a failure to reach it. */
function refusedBy(err: unknown): boolean {
    return err instanceof ApiError || err instanceof AuthError;
}

/**
 * Runs the open query: each run prepared in the browser and sent as one
 * one-shot call; one run in flight at a time, a new run abandoning the old.
 *
 * @param root - The root, or why it cannot be queried
 * @param call - How a one-shot call is made; `undefined` when there is no server
 * @param onRan - Told each run that answered, with its result, for the recent queries
 * @returns The run's state, and `run(plan)`
 */
export function useQueryRun(
    root: QueryRoot | string, call: QueryCall | undefined, onRan?: (result: QueryResult, plan: RunPlan) => void,
): { state: RunState; run: (plan: RunPlan) => void } {
    const [state, setState] = useState<RunState>({ status: "idle" });
    // The latest run's number: an answer to an earlier one is dropped.
    const seq = useRef(0);
    const run = useCallback((plan: RunPlan) => {
        const n = ++seq.current;
        if (typeof root === "string") {
            setState({ status: "failed", n, plan, reason: "refused", message: root, at: new Date() });
            return;
        }
        const prepared = prepareQuery(plan.program, root);
        if ("result" in prepared) {
            setState({ status: "done", n, plan, result: prepared.result, output: undefined, at: new Date(), ms: 0 });
            return;
        }
        if (call === undefined) {
            setState({ status: "failed", n, plan, reason: "unreachable", message: "", at: new Date() });
            return;
        }
        setState({ status: "running", n, plan, reads: prepared.prepared.entries.map(e => e.name) });
        const started = performance.now();
        call(prepared.prepared.request).then(
            (answer) => {
                if (seq.current !== n) return;
                const result = queryResultOf(prepared.prepared, answer);
                setState({ status: "done", n, plan, result, output: runOutput(plan, result), at: new Date(), ms: performance.now() - started });
                if (onRan !== undefined) queueMicrotask(() => onRan(result, plan));
            },
            (err: unknown) => {
                if (seq.current !== n) return;
                const message = err instanceof Error ? err.message : String(err);
                setState({ status: "failed", n, plan, reason: refusedBy(err) ? "refused" : "unreachable", message, at: new Date() });
            },
        );
    }, [root, call, onRan]);
    return { state, run };
}
