/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runs (#938, #941) — a query read on e3 (`Query Editor Spec.md` §4.11). The
 * builder prepares each run itself, and plans it (`plan.ts`) as one one-shot
 * call over its root, with the call's limits (#935), or as a split call over
 * the pieces of the dataset it works through, when that dataset weighs more
 * than one piece:
 *
 * - **what runs** ({@link planRun}): in the visual view, the counting program
 *   (#933), so a one-shot run gives the result and every shape line's count —
 *   and, for a split run, the query itself, a rows result wrapped to count its
 *   rows, since a split run counts the source and the result only; in the jq
 *   view, the jq as typed, printed canonically when it parses — a text that
 *   does not parse is never sent, its run being the checker's refusal;
 * - **how it runs** ({@link useQueryRun}): the query checked and split; the
 *   dataset it would cut weighed, by its status; then the plan's call, a
 *   split call's progress told as it goes;
 * - **one at a time**: a new run abandons the one before by its signal, and
 *   an abandoned run's answer is dropped when it lands; while it goes, the run
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

import { useCallback, useEffect, useRef, useState } from "react";
import {
    decodeBeast2, fromEastTypeValue, parseJq, printJq,
    type CheckJqResult, type EastType, type option,
} from "@elaraai/east";
import { ApiError, AuthError } from "@elaraai/e3-api-client";
import type { ExecuteResult, SplitCallProgress } from "@elaraai/e3-types";
import type { QueryCall, QuerySourceStatus, QuerySplitCall } from "./hooks.js";
import { queryResultOf, type QueryReading, type QueryResult, type QueryRoot } from "./one-shot.js";
import { draftPlan, weighPlan, type PlanDraft, type PlanOptions, type QueryPlan, type SourceWeight } from "./plan.js";
import type { QueryHeader } from "./session.js";
import type { CheckedSteps } from "./steps/check.js";
import { SOURCE_COUNT, countingProgram, readCounts } from "./steps/count.js";
import { printSteps } from "./steps/print.js";
import { shapeOf, type Shape } from "./steps/shape.js";
import type { StepQuery } from "./steps/values.js";
import type { QueryView } from "./toolbar.js";

/** The most rows a visual run returns; the counting program counts them all. */
export const RUN_MAX_ROWS = 1000;

/** How the pipeline layout joins one stage to the next. */
const NEXT_STAGE = "\n| ";

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

/** What a run sends as a split call, and what reading its answer needs. */
export interface SplitRun {
    /**
     * The program: in the visual view the query, a rows result followed by
     * `{counts: [length], result: .[:1000]}` — the rows joined, and that run
     * once after them; in the jq view, the jq.
     */
    readonly program: string;
    /** What each of its counts is of — the last counted stage, for a visual run of rows; `undefined` when it answers the result alone. */
    readonly counted: readonly string[] | undefined;
    /** The data source whose stored row count is the source's count — a visual run's, when its source counts; `undefined` otherwise. */
    readonly source: string | undefined;
}

/** What a run sends, and what reading its answer needs. */
export interface RunPlan {
    /** The program a one-shot call runs: the counting program, or the jq. */
    readonly program: string;
    /** The query's own program, canonical: what its result is fresh against, and what its plan splits and explains. */
    readonly canonical: string;
    /** What each of the counting program's counts is of — `undefined` for a jq run. */
    readonly counted: readonly string[] | undefined;
    /** What a split call runs instead. */
    readonly split: SplitRun;
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
 * @returns the plan: in the visual view the counting program, or for a split
 *   call the query, a rows result wrapped to count its rows; in the jq view the jq
 */
export function planRun(editor: RunEditor, root: QueryRoot): RunPlan {
    const { view, header, query, checked, jqText, jqChecked } = editor;
    if (view === "visual" && header.jq.type === "none") {
        const plain = printSteps(query, root.type).text;
        const counting = countingProgram(query, root.type, { maxRows: RUN_MAX_ROWS });
        const canonical = canonicalProgram(plain);
        // A split run counts the source, from its stored rows, and a rows result's rows: nothing between.
        const source = counting.counted.includes(SOURCE_COUNT) ? query.source : undefined;
        const last = counting.counted.at(-1);
        const split: SplitRun = checked?.final.kind === "rows" && last !== undefined
            ? { program: `${canonical}${NEXT_STAGE}{counts: [length], result: .[:${RUN_MAX_ROWS}]}`, counted: [last], source }
            : { program: canonical, counted: undefined, source };
        return {
            program: counting.text, canonical, counted: counting.counted, split, shape: checked?.final,
            name: header.name, description: header.description,
        };
    }
    const text = view === "jq" ? jqText : header.jq.type === "some" ? header.jq.value : jqText;
    const canonical = canonicalProgram(text);
    const shape = jqChecked !== undefined && jqChecked.elementType !== null
        ? shapeOf(jqChecked.elementType, jqChecked.multiplicity, { noun: "row" })
        : undefined;
    return {
        program: canonical, canonical, counted: undefined, split: { program: canonical, counted: undefined, source: undefined },
        shape, name: header.name, description: header.description,
    };
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

/** No counts known before a run answers. */
const NO_COUNTS: ReadonlyMap<string, number> = new Map();

/**
 * Reads a run's answer.
 *
 * @param program - what the run's program counts: a {@link RunPlan}'s
 *   counting program, or a {@link SplitRun}'s
 * @param result - what the call answered
 * @param known - counts known before the run answered, by step id: a split
 *   run's source's stored rows
 * @returns the result and its counts; `undefined` for a run that gave no result
 * @throws {Error} When a counting run's answer does not hold one count per counted stage.
 */
export function runOutput(
    program: { readonly counted: readonly string[] | undefined }, result: QueryResult, known: ReadonlyMap<string, number> = NO_COUNTS,
): RunOutput | undefined {
    if (result.outcome.type !== "ok") return undefined;
    const { result: bytes, truncated } = result.outcome.value;
    const decoded = decodeBeast2(bytes);
    const type = fromEastTypeValue(decoded.type);
    const counted = program.counted;
    if (counted === undefined) return { type, value: decoded.value, counts: known.size === 0 ? undefined : known, total: undefined, truncated };
    if (type.type !== "Struct") throw new Error("runOutput: a counting run answers {counts, result}");
    const read = readCounts(decoded.value as { counts: bigint[]; result: unknown }, counted);
    const resultType = (type.fields as Record<string, EastType>)["result"]!;
    const last = counted.length === 0 ? undefined : read.counts.get(counted[counted.length - 1]!);
    const shown = resultType.type === "Array" ? (read.value as readonly unknown[]).length : undefined;
    const total = last !== undefined && shown !== undefined && last > shown ? last : undefined;
    const counts = known.size === 0 ? read.counts : new Map([...known, ...read.counts]);
    return { type: resultType, value: read.value, counts, total, truncated: false };
}

/** Where the builder's run stands. */
export type RunState =
    | { readonly status: "idle" }
    /**
     * A run going: its number, its plan, the data sources it reads; how it
     * reads them, once planned; and a split call's progress, and how many
     * pieces it cut, once e3 says.
     */
    | {
        readonly status: "running"; readonly n: number; readonly plan: RunPlan; readonly reads: readonly string[];
        readonly planned: QueryPlan | undefined; readonly progress: SplitCallProgress | undefined; readonly pieces: number | undefined;
    }
    /** A run answered — a result, or the checker's, the runner's or e3's refusal — how it read its data, and how many pieces it cut. */
    | {
        readonly status: "done"; readonly n: number; readonly plan: RunPlan; readonly result: QueryResult;
        readonly output: RunOutput | undefined; readonly at: Date; readonly ms: number;
        readonly planned: QueryPlan | undefined; readonly pieces: number | undefined;
    }
    /** A call that never answered: unreachable, or refused by the server — and how it was to read its data. */
    | {
        readonly status: "failed"; readonly n: number; readonly plan: RunPlan; readonly reason: "unreachable" | "refused";
        readonly message: string; readonly at: Date; readonly planned: QueryPlan | undefined;
    };

/** What a run reaches e3 through, and how it plans. */
export interface QueryRunSeams {
    /** How a one-shot call is made; `undefined` when there is no server. */
    readonly call: QueryCall | undefined;
    /** How a split call is made; `undefined` when there is no server. */
    readonly split: QuerySplitCall | undefined;
    /** How a data source's status is read; `undefined` when there is none to read, and every dataset's weight is unknown. */
    readonly status: QuerySourceStatus | undefined;
    /** How the run plans: the most a dataset may weigh and still be read by one call. */
    readonly options: PlanOptions;
}

/** An error's message. */
function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Whether an error a call rejected with is the server's refusal of it, not a
 * failure to reach it: an `ApiError` or an `AuthError`; and, from a split call,
 * anything but the `TypeError` `fetch` rejects with — a job that ended
 * `failed` is e3's refusal to run it.
 */
function refusedBy(err: unknown, split: boolean): boolean {
    if (err instanceof ApiError || err instanceof AuthError) return true;
    return split && !(err instanceof TypeError);
}

/**
 * What the datasets a run plans over weigh, by name: the one a split call
 * would cut, and the source whose stored rows a split visual run counts. A
 * status that cannot be read leaves its dataset's weight unknown.
 */
async function weigh(draft: PlanDraft, source: string | undefined, root: QueryRoot, status: QuerySourceStatus | undefined): Promise<ReadonlyMap<string, SourceWeight>> {
    const weights = new Map<string, SourceWeight>();
    if (status === undefined || draft.over === undefined) return weights;
    const names = [...new Set([draft.over, ...(source === undefined ? [] : [source])])];
    await Promise.all(names.map(async (name) => {
        const entry = root.entries.find(e => e.name === name);
        if (entry === undefined) return;
        try {
            weights.set(name, await status(entry.path));
        } catch {
            // Not weighed: the plan says its weight is not known, and the run is one call.
        }
    }));
    return weights;
}

/**
 * Runs the open query: each run planned in the browser and sent as one
 * one-shot call, or as a split call over the dataset it works through; one
 * run in flight at a time, a new run abandoning the old.
 *
 * @param root - The root, or why it cannot be queried
 * @param seams - How a one-shot call, a split call and a data source's status
 *   are made, and how the run plans
 * @param onRan - Told each run that answered, with its result, for the recent queries
 * @returns The run's state, and `run(plan)`
 *
 * @remarks
 * A run checks and splits the query (`draftPlan`); reads the status of the
 * dataset it would cut, when it would cut one; plans the call by what that
 * weighs (`weighPlan`); and makes it. A split call's progress is the run's as
 * e3 reports it, and how many pieces it cut is the partition's units. A split
 * visual run counts the source from its dataset's stored rows, and a rows
 * result's rows from the call; nothing between.
 */
export function useQueryRun(
    root: QueryRoot | string, seams: QueryRunSeams, onRan?: (result: QueryResult, plan: RunPlan) => void,
): { state: RunState; run: (plan: RunPlan) => void } {
    const [state, setState] = useState<RunState>({ status: "idle" });
    // The latest run's number: an answer to an earlier one is dropped.
    const seq = useRef(0);
    // The latest run's abandon: a new run, or the builder going, abandons it.
    const abandon = useRef<AbortController | undefined>(undefined);
    useEffect(() => () => abandon.current?.abort(), []);
    const { call, split, status, options } = seams;
    const run = useCallback((plan: RunPlan) => {
        const n = ++seq.current;
        abandon.current?.abort();
        const controller = new AbortController();
        abandon.current = controller;
        const live = (): boolean => seq.current === n;
        const failed = (reason: "unreachable" | "refused", message: string, planned: QueryPlan | undefined): void =>
            setState({ status: "failed", n, plan, reason, message, at: new Date(), planned });
        if (typeof root === "string") {
            failed("refused", root, undefined);
            return;
        }
        let drafted: ReturnType<typeof draftPlan>;
        try {
            drafted = draftPlan({ query: plan.canonical, oneShot: plan.program, split: plan.split.program }, root, options);
        } catch (err) {
            failed("refused", messageOf(err), undefined);
            return;
        }
        if ("result" in drafted) {
            setState({ status: "done", n, plan, result: drafted.result, output: undefined, at: new Date(), ms: 0, planned: undefined, pieces: undefined });
            return;
        }
        const draft = drafted.draft;
        const reads = draft.reads;
        setState({ status: "running", n, plan, reads, planned: undefined, progress: undefined, pieces: undefined });
        const started = performance.now();

        /** The run answered: its result read, its output, and the recent queries told. */
        const answered = (planned: QueryPlan, reading: QueryReading, answer: ExecuteResult, read: (result: QueryResult) => RunOutput | undefined, pieces: number | undefined): void => {
            let result: QueryResult;
            let output: RunOutput | undefined;
            try {
                result = queryResultOf(reading, answer);
                output = read(result);
            } catch (err) {
                failed("refused", messageOf(err), planned);
                return;
            }
            setState({ status: "done", n, plan, result, output, at: new Date(), ms: performance.now() - started, planned, pieces });
            if (onRan !== undefined) queueMicrotask(() => onRan(result, plan));
        };

        void (async () => {
            const weights = await weigh(draft, plan.split.source, root, status);
            if (!live()) return;
            let planned: QueryPlan;
            try {
                const weighed = weighPlan(draft, draft.over === undefined ? undefined : weights.get(draft.over));
                if ("result" in weighed) {
                    setState({ status: "done", n, plan, result: weighed.result, output: undefined, at: new Date(), ms: 0, planned: undefined, pieces: undefined });
                    return;
                }
                planned = weighed.plan;
            } catch (err) {
                failed("refused", messageOf(err), undefined);
                return;
            }
            setState({ status: "running", n, plan, reads, planned, progress: undefined, pieces: undefined });

            if (planned.kind === "one_shot") {
                if (call === undefined) {
                    failed("unreachable", "", planned);
                    return;
                }
                let answer: ExecuteResult;
                try {
                    answer = await call(planned.prepared.request);
                } catch (err) {
                    if (live()) failed(refusedBy(err, false) ? "refused" : "unreachable", messageOf(err), planned);
                    return;
                }
                if (!live()) return;
                answered(planned, planned.prepared, answer, (result) => runOutput(plan, result), undefined);
                return;
            }

            if (split === undefined) {
                failed("unreachable", "", planned);
                return;
            }
            let pieces: number | undefined;
            let answer: ExecuteResult;
            try {
                answer = await split(planned.request, {
                    signal: controller.signal,
                    onProgress: (progress) => {
                        if (!live()) return;
                        if (progress.phase.type === "partition") pieces = Number(progress.units);
                        setState({ status: "running", n, plan, reads, planned, progress, pieces });
                    },
                });
            } catch (err) {
                if (live()) failed(refusedBy(err, true) ? "refused" : "unreachable", messageOf(err), planned);
                return;
            }
            if (!live()) return;
            // The source's count is its dataset's stored rows; a rows result's, the call's.
            const rows = plan.split.source === undefined ? undefined : weights.get(plan.split.source)?.rows;
            const known: ReadonlyMap<string, number> = rows === undefined ? NO_COUNTS : new Map([[SOURCE_COUNT, rows]]);
            answered(planned, planned.reading, answer, (result) => runOutput(plan.split, result, known), pieces);
        })();
    }, [root, call, split, status, options, onRan]);
    return { state, run };
}
