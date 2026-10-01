/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Plans (#941) — how a run of a query reads its data: as one one-shot call
 * (#935), or as a split call (#1032) over the pieces of the dataset it works
 * through, which e3 runs as a job of pieces and merges, and the builder
 * launches and polls.
 *
 * - **The split** is east's (`splitJq`): the stage of the query that works row
 *   by row, the program each piece runs, how the pieces' outputs combine and
 *   what runs once after them — or why the query runs as one unit.
 * - **The path**: a query that splits runs as a split call only when the
 *   dataset it would cut weighs more than one piece — e3's smallest,
 *   `PIECE_SIZES.min` (16 MiB), unless the options name another — so a small
 *   dataset keeps a one-shot call's latency. A query that runs as one unit is
 *   one call, and so is one whose dataset's weight is not known.
 * - **The request** ({@link splitCallRequest}): the piece program; one
 *   `dataset` argument per data source the query reads, at its path, the one
 *   cut partitioned; the output kind, with its programs and a fold's zero; the
 *   final function; and a one-shot call's runner, so a caller who may read the
 *   workspace may run it, and its limits but for the time limit, which e3
 *   gives a split call's job.
 * - **The explanation** ({@link PlanExplanation}): the path and why; for a
 *   split, what each piece runs, how the pieces combine, what runs once after
 *   them, and what every piece reads whole; and the reads that skip what they
 *   don't need — as data, which the builder's words say (`planWords`).
 *
 * A split call answers an `ExecuteResult`, read as a one-shot call's is
 * (`queryResultOf`): the final function gives the query's result at the type
 * the translation gives it, so the two paths answer alike.
 *
 * Everything here is a pure function: nothing reaches the network or the DOM.
 *
 * @packageDocumentation
 */

import {
    checkJq, encodeBeast2For, encodeEastIR, none, some, splitJq, variant,
    type CheckJqResult, type JqPruning, type JqSplit, type JqSplitCall, type JqSplitStages, type JqWholeReason,
} from "@elaraai/east";
import { PIECE_SIZES, type SplitCallRequest } from "@elaraai/e3-types";
import {
    entryNamed, prepareCheckedQuery, prepareQuery, queryLimits,
    type PreparedQuery, type QueryOptions, type QueryReading, type QueryResult, type QueryRoot,
} from "./one-shot.js";

// ─── What planning takes ─────────────────────────────────────────────────────

/**
 * Options for planning a run: a call's limits and runner, as a one-shot call's
 * ({@link QueryOptions}), and the most a dataset may weigh and still be read
 * by one call.
 */
export interface PlanOptions extends QueryOptions {
    /**
     * The most a dataset may weigh, in stored bytes, and still be read by one
     * call: e3's smallest piece, `PIECE_SIZES.min` (16 MiB), by default. A
     * test against a server whose pieces are small sets it small too.
     */
    readonly pieceBytes?: number;
}

/** What a data source weighs, as e3's status says: its stored bytes, and the rows of a stored collection. */
export interface SourceWeight {
    /** What its value weighs in the store, in bytes — a collection's segments and its manifest; `undefined` when not known. */
    readonly bytes: number | undefined;
    /** How many elements a stored collection holds; `undefined` for a value that is not one, or when not known. */
    readonly rows: number | undefined;
}

/**
 * The programs a run plans from: the query, and what each kind of call runs
 * of it.
 *
 * @remarks
 * In the jq view all three are the jq. In the visual view a one-shot call runs
 * the program that counts every stage's rows, and a split call runs the query
 * itself — a rows result followed by `{counts: [length], result: .[:1000]}`,
 * which the split runs once after the rows are joined — since a split run
 * counts the source and the result only.
 */
export interface PlanPrograms {
    /** The query as its author reads it: what the plan splits and explains. */
    readonly query: string;
    /** What a one-shot call runs: the query by default. */
    readonly oneShot?: string;
    /** What a split call runs: the query by default. */
    readonly split?: string;
}

// ─── What a plan is ──────────────────────────────────────────────────────────

/**
 * Why a run reads its data in one call.
 *
 * @remarks
 * - `whole`: the query runs as one unit, for east's reason (`JqWhole`).
 * - `small`: it would split over a dataset that weighs no more than one piece.
 * - `unweighed`: it would split over a dataset whose weight is not known.
 * - `unsplit`: it would split, and the split call could not be made — what
 *   went wrong, so it shows rather than hides. `over` is `null` when the split
 *   itself failed.
 */
export type OneCallWhy =
    | { readonly kind: "whole"; readonly reason: JqWholeReason }
    | { readonly kind: "small"; readonly over: string; readonly bytes: number; readonly pieceBytes: number }
    | { readonly kind: "unweighed"; readonly over: string }
    | { readonly kind: "unsplit"; readonly over: string | null; readonly message: string };

/** How a run reads its data, as its explanation says it. */
export type PlanPath =
    /** One call, and why. */
    | { readonly kind: "one_shot"; readonly why: OneCallWhy }
    | {
        readonly kind: "split";
        /** The dataset the pieces are cut from, by its data source's name. */
        readonly over: string;
        /** What it weighs in the store, in bytes. */
        readonly bytes: number;
        /** The most a dataset may weigh and still be read by one call. */
        readonly pieceBytes: number;
        /** How the pieces' outputs combine: the split call's output kind. */
        readonly output: JqSplitCall["output"]["kind"];
        /** What runs where, as ranges of the query's text. */
        readonly stages: JqSplitStages;
        /** The data sources every piece reads whole. */
        readonly broadcast: readonly string[];
    };

/**
 * A plan's explanation, as data: the builder's words say it (`planWords`),
 * beside the run's read-outs.
 */
export interface PlanExplanation {
    /** The query's text: every range of the explanation is of it. */
    readonly program: string;
    /** The path, and why. */
    readonly path: PlanPath;
    /** The reads that skip what they don't need: a count from the index, a key seek, a stream that stops. */
    readonly pruning: readonly JqPruning[];
}

/** A run's plan: the call it makes, what reading the call's answer needs, and its explanation. */
export type QueryPlan =
    /** One one-shot call, which e3-api-client's `oneShotExecute` sends. */
    | { readonly kind: "one_shot"; readonly prepared: PreparedQuery; readonly explanation: PlanExplanation }
    /** A split call, which e3-api-client's `splitCall` launches and polls; its answer is read as a one-shot call's. */
    | { readonly kind: "split"; readonly request: SplitCallRequest; readonly reading: QueryReading; readonly explanation: PlanExplanation };

/**
 * A query checked and split, waiting to be weighed ({@link weighPlan}): the
 * first half of a plan, which says which data source's weight decides it.
 */
export interface PlanDraft {
    /** The data sources the query reads, in the order it first reads them: what a run says it reads. */
    readonly reads: readonly string[];
    /** The data source a split call would cut, whose weight decides the path; `undefined` when the query runs as one unit. */
    readonly over: string | undefined;
    /** The programs, each given. @internal */
    readonly programs: Required<PlanPrograms>;
    /** The root. @internal */
    readonly root: QueryRoot;
    /** The options. @internal */
    readonly options: PlanOptions;
    /** What the checker made of the query. @internal */
    readonly checked: CheckJqResult;
    /** How the query splits, or why it does not; or what went wrong splitting it. @internal */
    readonly split: JqSplit | { readonly kind: "failed"; readonly message: string };
}

// ─── Planning ────────────────────────────────────────────────────────────────

/**
 * The most a dataset may weigh and still be read by one call, from the options.
 *
 * @param options - the options
 * @returns `pieceBytes`, or `PIECE_SIZES.min`
 * @throws {RangeError} When `pieceBytes` is not a whole number of bytes.
 */
function pieceBytesOf(options: PlanOptions): number {
    const bytes = options.pieceBytes ?? PIECE_SIZES.min;
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError(`planQuery: pieceBytes is ${bytes}, not a whole number of bytes`);
    return bytes;
}

/** An error's message. */
function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Checks and splits a query: the first half of a plan, which says the data
 * source whose weight decides the path ({@link PlanDraft.over}).
 *
 * @param programs - the query, and what each kind of call runs of it; a
 *   string is all three
 * @param root - the root its data sources make
 * @param options - a call's limits and runner, and `pieceBytes`
 * @returns the draft; or, for a query that does not check, the `error` result
 *   a run of it gives, as {@link prepareQuery} gives it
 * @throws {RangeError} When a limit, or `pieceBytes`, is not a whole number.
 *
 * @remarks
 * The query is checked once, against the whole root, as a one-shot call's is.
 * A `many` query is split with the call's most outputs, so its final function
 * keeps as many as the one-shot translation does, and one more. A split that
 * fails — a gap in the splitter, never a mistake in the query — leaves the
 * query one call, the failure in its explanation.
 */
export function draftPlan(programs: PlanPrograms | string, root: QueryRoot, options: PlanOptions = {}): { draft: PlanDraft } | { result: QueryResult } {
    const all: Required<PlanPrograms> = typeof programs === "string"
        ? { query: programs, oneShot: programs, split: programs }
        : { query: programs.query, oneShot: programs.oneShot ?? programs.query, split: programs.split ?? programs.query };
    const { maxOutputs } = queryLimits(options);
    pieceBytesOf(options);
    const checked = checkJq(all.query, root.type, { root: true });
    if (checked.query === null) {
        const refused = prepareCheckedQuery(checked, root, options);
        if ("result" in refused) return refused;
    }
    let split: PlanDraft["split"];
    try {
        split = splitJq(checked, checked.multiplicity === "many" ? { maxOutputs } : {});
    } catch (err) {
        split = { kind: "failed", message: messageOf(err) };
    }
    return {
        draft: {
            reads: [...checked.reads],
            over: split.kind === "split" ? split.over : undefined,
            programs: all, root, options, checked, split,
        },
    };
}

/**
 * Weighs a draft: the path, by what its dataset weighs, and the call it makes.
 *
 * @param draft - the query, checked and split ({@link draftPlan})
 * @param weight - what the dataset a split call would cut weighs
 *   ({@link PlanDraft.over}); `undefined` when it is not known
 * @returns the plan; or, for a one-shot program that does not check, the
 *   `error` result a run of it gives
 * @throws {TranslationError} When a checked program holds something the
 *   translator cannot express.
 *
 * @remarks
 * A query that runs as one unit is one call. One that splits is a split call
 * when its dataset weighs more than `pieceBytes`, and one call when it weighs
 * no more, or its weight is not known. A split call's request is built from
 * the split program — in the visual view, the query wrapped to count its
 * rows — which must split over the same dataset into the same output kind as
 * the query; one that cannot be built is one call, and its explanation says
 * why.
 */
export function weighPlan(draft: PlanDraft, weight: SourceWeight | undefined): { plan: QueryPlan } | { result: QueryResult } {
    const { checked, split, programs, root, options } = draft;
    const program = checked.source.text;
    const oneCall = (why: OneCallWhy, pruning: readonly JqPruning[]): { plan: QueryPlan } | { result: QueryResult } => {
        // The query's own check serves its call when the call runs the query.
        const prepared = programs.oneShot === programs.query ? prepareCheckedQuery(checked, root, options) : prepareQuery(programs.oneShot, root, options);
        if ("result" in prepared) return prepared;
        return { plan: { kind: "one_shot", prepared: prepared.prepared, explanation: { program, path: { kind: "one_shot", why }, pruning } } };
    };
    if (split.kind === "failed") return oneCall({ kind: "unsplit", over: null, message: split.message }, []);
    if (split.kind === "whole") return oneCall({ kind: "whole", reason: split.reason }, split.pruning);
    const pieceBytes = pieceBytesOf(options);
    const bytes = weight?.bytes;
    if (bytes === undefined) return oneCall({ kind: "unweighed", over: split.over }, split.pruning);
    if (bytes <= pieceBytes) return oneCall({ kind: "small", over: split.over, bytes, pieceBytes }, split.pruning);
    let call: { request: SplitCallRequest; reading: QueryReading };
    try {
        call = splitCallOf(draft, split);
    } catch (err) {
        return oneCall({ kind: "unsplit", over: split.over, message: messageOf(err) }, split.pruning);
    }
    return {
        plan: {
            kind: "split", ...call,
            explanation: {
                program,
                path: { kind: "split", over: split.over, bytes, pieceBytes, output: split.output.kind, stages: split.stages, broadcast: split.broadcast },
                pruning: split.pruning,
            },
        },
    };
}

/**
 * Plans a run: checks and splits the query, and weighs it — {@link draftPlan},
 * then {@link weighPlan} with the weight of the dataset it would cut.
 *
 * @param programs - the query, and what each kind of call runs of it; a
 *   string is all three
 * @param root - the root its data sources make
 * @param weights - what each data source weighs, by name; one not given is
 *   not known
 * @param options - a call's limits and runner, and `pieceBytes`
 * @returns the plan: one call or a split call, what reading its answer needs,
 *   and its explanation; or, for a query that does not check, the `error`
 *   result a run of it gives
 * @throws {RangeError} When a limit, or `pieceBytes`, is not a whole number.
 *
 * @example
 * ```ts
 * const planned = planQuery(".orders | group_by(.region) | map({region: .[0].region, revenue: map(.total) | add})",
 *     root, new Map([["orders", { bytes: 1.4e9, rows: 8_000_000 }]]));
 * if ("result" in planned) return planned.result;           // the checker's problems
 * const plan = planned.plan;
 * if (plan.kind === "split") {
 *     const { result } = await splitCall(url, repo, workspace, plan.request, { token });
 *     return queryResultOf(plan.reading, result);
 * }
 * return queryResultOf(plan.prepared, await oneShotExecute(url, repo, workspace, plan.prepared.request, { token }));
 * ```
 */
export function planQuery(
    programs: PlanPrograms | string, root: QueryRoot, weights: ReadonlyMap<string, SourceWeight>, options: PlanOptions = {},
): { plan: QueryPlan } | { result: QueryResult } {
    const drafted = draftPlan(programs, root, options);
    if ("result" in drafted) return drafted;
    const over = drafted.draft.over;
    return weighPlan(drafted.draft, over === undefined ? undefined : weights.get(over));
}

/**
 * The split call of a draft that splits: the split program's split, which
 * must cut the same dataset into the same output kind as the query's, and its
 * request and reading.
 *
 * @throws {Error} When the split program does not check, or splits otherwise
 *   than the query.
 */
function splitCallOf(draft: PlanDraft, split: JqSplitCall): { request: SplitCallRequest; reading: QueryReading } {
    const { programs, root, options } = draft;
    const { maxOutputs } = queryLimits(options);
    let checked = draft.checked;
    let call = split;
    if (programs.split !== programs.query) {
        checked = checkJq(programs.split, root.type, { root: true });
        if (checked.query === null) throw new Error(`the run's split program does not check: ${checked.diagnostics[0]?.message ?? ""}`);
        const wrapped = splitJq(checked, checked.multiplicity === "many" ? { maxOutputs } : {});
        if (wrapped.kind !== "split" || wrapped.over !== split.over || wrapped.output.kind !== split.output.kind) {
            throw new Error(`the run's split program splits otherwise than the query: ${wrapped.kind === "split" ? `${wrapped.output.kind} over ${wrapped.over}` : wrapped.reason.code}`);
        }
        call = wrapped;
    }
    const query = checked.query;
    if (query === null) throw new Error("the query does not check");
    return {
        request: splitCallRequest(call, root, options),
        reading: { query, checked, entries: call.inputs.map(input => entryNamed(root, input.name, "splitCallRequest")), maxOutputs },
    };
}

// ─── The request ─────────────────────────────────────────────────────────────

/**
 * The split call a query split over a dataset's pieces runs as: the request
 * e3-api-client's `splitCall` (or `splitCallLaunch`, `splitCallExplain`)
 * sends, exactly as the builder sends it.
 *
 * @param split - the query's split (`splitJq`), over a root's data sources
 * @param root - the root: each data source the split reads is an argument at
 *   its path
 * @param options - the call's limits and its runner, as a one-shot call's
 * @returns the request
 * @throws {RangeError} When a limit is not a whole number of at least 1.
 * @throws {Error} When the split reads a root field no data source of the root is.
 *
 * @remarks
 * - `bodyIr` is the piece program, and `then` the final function, when there
 *   is one: each `encodeEastIR(fn.toIR())`, as a one-shot call's body is.
 * - `args` is one `dataset` argument per input of the split, in its order —
 *   the root fields the query reads, as the translation takes them — at its
 *   data source's path; the one the pieces are cut from, `over`, is
 *   partitioned with no `by`, so any key may start a piece, and every other
 *   argument reaches each piece whole.
 * - `output` is the split's output kind: a dict's merge and a fold's combine
 *   encoded as the programs are, and a fold's zero as beast2 at its type.
 * - `runner` is a one-shot call's (`QueryOptions`): east-c given no platform
 *   package, and no program calls a platform function, so a caller who may
 *   read the workspace may launch it.
 * - `limits` are a one-shot call's, but for the time limit: a split call is a
 *   job, which e3 gives the server's ceiling (ten minutes on a local server)
 *   when the request asks for no time limit, as it asks for none unless the
 *   options set one. A one-shot call's limit would cut a large dataset's job
 *   short.
 *
 * @example
 * ```ts
 * const split = splitJq(checkJq(".orders | map(.total) | add", root.type, { root: true }));
 * if (split.kind === "split") {
 *     const { result } = await splitCall(url, repo, workspace, splitCallRequest(split, root), { token });
 * }
 * ```
 */
export function splitCallRequest(split: JqSplitCall, root: QueryRoot, options: QueryOptions = {}): SplitCallRequest {
    const { limits, runner } = queryLimits(options);
    const then = split.then();
    return {
        bodyIr: encodeEastIR(split.piece().toIR()),
        args: split.inputs.map(input => ({
            arg: variant("dataset", entryNamed(root, input.name, "splitCallRequest").path),
            partition: input.name === split.over ? some({ by: [] }) : none,
        })),
        output: outputOf(split.output),
        then: then === null ? none : some(encodeEastIR(then.toIR())),
        runner,
        limits: jobLimits(limits, options),
    };
}

/**
 * A split call's limits: a one-shot call's, with no time limit asked unless
 * the options set one, so its job runs to the server's ceiling.
 *
 * @param limits - a one-shot call's limits, from the options
 * @param options - the call's options
 * @returns the limits
 */
function jobLimits(limits: SplitCallRequest["limits"], options: QueryOptions): SplitCallRequest["limits"] {
    if (options.timeoutMs !== undefined || limits.type === "none") return limits;
    return some({ ...limits.value, timeoutMs: none });
}

/** A split's output kind as a split call's request holds it. */
function outputOf(output: JqSplitCall["output"]): SplitCallRequest["output"] {
    switch (output.kind) {
        case "array":
            return variant("array", null);
        case "set":
            return variant("set", null);
        case "dict":
            return variant("dict", { merge: some(encodeEastIR(output.merge().toIR())) });
        case "fold":
            return variant("fold", { combine: encodeEastIR(output.combine().toIR()), zero: encodeBeast2For(output.type)(output.zero as never) });
    }
}
