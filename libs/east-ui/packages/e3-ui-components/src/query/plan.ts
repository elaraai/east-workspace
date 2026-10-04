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
 *   datasets it would cut weigh more than one piece — e3's smallest,
 *   `PIECE_SIZES.min` (16 MiB), unless the options name another — so a small
 *   dataset keeps a one-shot call's latency. A query that runs as one unit is
 *   one call, and so is one whose datasets' weight is not known. A join both of
 *   whose sides weigh more than one piece is re-keyed (#942): two split calls,
 *   the first re-keying the rows by the join key, the second joining its
 *   output and the other side cut at the same keys.
 * - **The request** ({@link splitCallRequest}): the piece program; one
 *   `dataset` argument per data source the query reads, at its path, the one
 *   cut partitioned, and those cut at the same keys with it; the output kind,
 *   with its programs and a fold's zero; the final function; and a one-shot
 *   call's runner, so a caller who may read the workspace may run it, and its
 *   limits, which name no time limit unless the options do: e3 gives a split
 *   call's job the server's. A re-keyed join's two ({@link rekeyCallRequests}).
 * - **The explanation** ({@link PlanExplanation}): the path and why; for a
 *   split, what each piece runs, how the pieces combine, what runs once after
 *   them, what every piece reads whole and what it reads cut at the same keys,
 *   and a re-key and what it is estimated to weigh; and the reads that skip
 *   what they don't need — as data, which the builder's words say
 *   (`planWords`).
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
    type CheckJqResult, type JqPruning, type JqRange, type JqSplit, type JqSplitCall, type JqSplitStages, type JqWholeReason,
} from "@elaraai/east";
import { PIECE_SIZES, type ExecuteResult, type SplitCallRequest } from "@elaraai/e3-types";
import {
    entryNamed, prepareCheckedQuery, prepareQuery, programChecks, queryLimits,
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
        /** The dataset the pieces work through, by its data source's name. */
        readonly over: string;
        /** The dataset e3 cuts the pieces by, the heaviest of those partitioned: `over`, or one cut at the same keys with it. */
        readonly heaviest: string;
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
        /** The data sources partitioned with `over`, each piece holding the same keys of them (#942). */
        readonly copartitioned: readonly string[];
        /**
         * A re-keyed join (#942): `over`'s rows re-keyed first by the join key,
         * the jq of it, then joined with `name` cut at the same keys; `bytes`
         * what the re-keyed rows are estimated to weigh, from `over`'s manifest.
         * `null` when the join, if any, reads its other side whole.
         */
        readonly rekey: { readonly name: string; readonly key: JqRange; readonly bytes: number } | null;
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
    | { readonly kind: "split"; readonly request: SplitCallRequest; readonly reading: QueryReading; readonly explanation: PlanExplanation }
    /**
     * A re-keyed join (#942): two split calls, the second over the first's
     * output by its hash; the second's answer, with what the first read
     * ({@link RekeyCalls.answer}), is read as a one-shot call's.
     */
    | ({ readonly kind: "rekey"; readonly reading: QueryReading; readonly explanation: PlanExplanation } & RekeyCalls);

/** A re-keyed join's two split calls ({@link rekeyCallRequests}), and how their answers make the run's. */
export interface RekeyCalls {
    /** The re-key call: the dataset's rows, each under its join key, its output read by its hash, never inline. */
    readonly first: SplitCallRequest;
    /**
     * The join call, over the re-key call's output.
     *
     * @param output - the hash of the re-key call's output, as its completed status gives it
     * @returns the request
     */
    join(output: string): SplitCallRequest;
    /**
     * The run's answer: the join call's, or the re-key call's when it gave no
     * output to join, with every dataset the run read — the re-key call's
     * dataset, pinned as it pinned it, then the join call's — in the order
     * the reading's entries name them.
     *
     * @param first - the re-key call's result
     * @param join - the join call's result; `undefined` when the re-key call gave no output
     * @returns the run's answer
     */
    answer(first: ExecuteResult, join: ExecuteResult | undefined): ExecuteResult;
}

/**
 * A query checked and split, waiting to be weighed ({@link weighPlan}): the
 * first half of a plan, which says which data source's weight decides it.
 */
export interface PlanDraft {
    /** The data sources the query reads, in the order it first reads them: what a run says it reads. */
    readonly reads: readonly string[];
    /** The data source a split call would cut, whose weight decides the path; `undefined` when the query runs as one unit. */
    readonly over: string | undefined;
    /**
     * The data sources whose weights decide the path: `over`, those cut at the
     * same keys with it, and the other side of a join it could re-key (#942);
     * none when the query runs as one unit.
     */
    readonly weighs: readonly string[];
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
    if (checked.program === null) {
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
            weighs: split.kind === "split" ? [...new Set([split.over, ...split.copartitioned, ...(split.rekey === null ? [] : [split.rekey.name])])] : [],
            programs: all, root, options, checked, split,
        },
    };
}

/**
 * Weighs a draft: the path, by what its datasets weigh, and the call it makes.
 *
 * @param draft - the query, checked and split ({@link draftPlan})
 * @param weights - what the data sources whose weights decide the path
 *   weigh ({@link PlanDraft.weighs}), by name; one not given is not known
 * @returns the plan; or, for a one-shot program that does not check, the
 *   `error` result a run of it gives
 * @throws {TranslationError} When a checked program holds something the
 *   translator cannot express.
 *
 * @remarks
 * A query that runs as one unit is one call. One that splits is a split call
 * when the datasets it cuts weigh more than `pieceBytes` — the heaviest of
 * them, which e3 cuts the pieces by, when others are cut at the same keys —
 * and one call when they weigh no more, or a weight is not known. A join
 * whose other side weighs more than `pieceBytes` too is re-keyed (#942),
 * rather than read whole by every piece: both sides large and unaligned. A
 * split call's request is built from the split program — in the visual view,
 * the query wrapped to count its rows — which must split as the query does:
 * over the same dataset, into the same output kind, cut at the same keys with
 * the same datasets and re-keying the same join; one that cannot be built is
 * one call, and its explanation says why.
 */
export function weighPlan(draft: PlanDraft, weights: ReadonlyMap<string, SourceWeight>): { plan: QueryPlan } | { result: QueryResult } {
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
    // e3 cuts the pieces by the heaviest of the datasets partitioned together.
    let heaviest = split.over;
    let bytes = -1;
    for (const name of [split.over, ...split.copartitioned]) {
        const weighs = weights.get(name)?.bytes;
        if (weighs === undefined) return oneCall({ kind: "unweighed", over: name }, split.pruning);
        if (weighs > bytes) [heaviest, bytes] = [name, weighs];
    }
    if (bytes <= pieceBytes) return oneCall({ kind: "small", over: heaviest, bytes, pieceBytes }, split.pruning);
    // Both sides large and unaligned: the join is re-keyed.
    const joined = split.rekey === null ? undefined : weights.get(split.rekey.name)?.bytes;
    const rekey = split.rekey !== null && joined !== undefined && joined > pieceBytes ? split.rekey : null;
    let call: { request: SplitCallRequest; reading: QueryReading } | ({ reading: QueryReading } & RekeyCalls);
    try {
        call = splitCallOf(draft, split, rekey !== null);
    } catch (err) {
        return oneCall({ kind: "unsplit", over: split.over, message: messageOf(err) }, split.pruning);
    }
    const explanation: PlanExplanation = {
        program,
        path: {
            kind: "split", over: split.over, heaviest, bytes, pieceBytes, output: split.output.kind, stages: split.stages,
            // A re-keyed join reads its other side cut at the same keys, not whole.
            broadcast: rekey === null ? split.broadcast : split.broadcast.filter(name => name !== rekey.name),
            copartitioned: split.copartitioned,
            rekey: rekey === null ? null : { name: rekey.name, key: rekey.key, bytes },
        },
        pruning: split.pruning,
    };
    return { plan: "request" in call ? { kind: "split", ...call, explanation } : { kind: "rekey", ...call, explanation } };
}

/**
 * Plans a run: checks and splits the query, and weighs it — {@link draftPlan},
 * then {@link weighPlan} with the weights of the datasets that decide it.
 *
 * @param programs - the query, and what each kind of call runs of it; a
 *   string is all three
 * @param root - the root its data sources make
 * @param weights - what each data source weighs, by name; one not given is
 *   not known
 * @param options - a call's limits and runner, and `pieceBytes`
 * @returns the plan: one call, a split call or a re-keyed join's two, what
 *   reading its answer needs, and its explanation; or, for a query that does
 *   not check, the `error` result a run of it gives
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
 * if (plan.kind === "rekey") {
 *     const first = await splitCall(url, repo, workspace, plan.first, { token });
 *     const join = first.output === null ? undefined : (await splitCall(url, repo, workspace, plan.join(first.output), { token })).result;
 *     return queryResultOf(plan.reading, plan.answer(first.result, join));
 * }
 * return queryResultOf(plan.prepared, await oneShotExecute(url, repo, workspace, plan.prepared.request, { token }));
 * ```
 */
export function planQuery(
    programs: PlanPrograms | string, root: QueryRoot, weights: ReadonlyMap<string, SourceWeight>, options: PlanOptions = {},
): { plan: QueryPlan } | { result: QueryResult } {
    const drafted = draftPlan(programs, root, options);
    if ("result" in drafted) return drafted;
    return weighPlan(drafted.draft, weights);
}

/**
 * The split call of a draft that splits, or a re-keyed join's two calls: the
 * split program's split, which must split as the query's does — the same
 * dataset into the same output kind, cut at the same keys with the same
 * datasets, re-keying the same join — and the requests and reading.
 *
 * @throws {Error} When the split program does not check, or splits otherwise
 *   than the query.
 */
function splitCallOf(draft: PlanDraft, split: JqSplitCall, rekey: boolean): { request: SplitCallRequest; reading: QueryReading } | ({ reading: QueryReading } & RekeyCalls) {
    const { programs, root, options } = draft;
    const { maxOutputs } = queryLimits(options);
    let checked = draft.checked;
    let call = split;
    if (programs.split !== programs.query) {
        checked = checkJq(programs.split, root.type, { root: true });
        if (checked.program === null) throw new Error(`the run's split program does not check: ${checked.diagnostics[0]?.message ?? ""}`);
        const wrapped = splitJq(checked, checked.multiplicity === "many" ? { maxOutputs } : {});
        const same = wrapped.kind === "split" && wrapped.over === split.over && wrapped.output.kind === split.output.kind
            && wrapped.copartitioned.join("\n") === split.copartitioned.join("\n") && wrapped.rekey?.name === split.rekey?.name;
        if (!same) {
            throw new Error(`the run's split program splits otherwise than the query: ${wrapped.kind === "split" ? `${wrapped.output.kind} over ${wrapped.over}` : wrapped.reason.code}`);
        }
        call = wrapped;
    }
    if (!programChecks(checked)) throw new Error("the query does not check");
    const entry = (name: string) => entryNamed(root, name, "splitCallRequest");
    if (!rekey) return { request: splitCallRequest(call, root, options), reading: { checked, entries: call.inputs.map(input => entry(input.name)), maxOutputs } };
    // The re-key call reads the dataset, and the join call the rest: what the run read, in that order.
    const joined = call.inputs.filter(input => input.name !== call.over).map(input => entry(input.name));
    return { ...rekeyCallRequests(call, root, options), reading: { checked, entries: [entry(call.over), ...joined], maxOutputs } };
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
 *   partitioned with no `by`, so any key may start a piece, and so is each of
 *   `copartitioned`, which e3 cuts at the same keys (#942); every other
 *   argument reaches each piece whole.
 * - `output` is the split's output kind: a dict's merge and a fold's combine
 *   encoded as the programs are, and a fold's zero as beast2 at its type.
 * - `runner` is a one-shot call's (`QueryOptions`): east-c given no platform
 *   package, and no program calls a platform function, so a caller who may
 *   read the workspace may launch it.
 * - `limits` are a one-shot call's: no time limit unless the options set one,
 *   so e3 gives the job the server's ceiling (ten minutes on a local server),
 *   as it gives a one-shot call that names none the server's default.
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
            partition: input.name === split.over || split.copartitioned.includes(input.name) ? some({ by: [] }) : none,
        })),
        output: outputOf(split.output),
        then: then === null ? none : some(encodeEastIR(then.toIR())),
        runner,
        limits,
    };
}

/**
 * A re-keyed join's two split calls (#942), as the planner sends them when
 * both sides of a join weigh more than one piece.
 *
 * @param split - the query's split, whose `rekey` is the join
 * @param root - the root
 * @param options - the calls' limits and their runner, as a one-shot call's
 * @returns the re-key call, the join call over its output, and how their
 *   answers make the run's ({@link RekeyCalls})
 * @throws {Error} When the split re-keys no join, or reads a root field no
 *   data source of the root is.
 *
 * @remarks
 * - **The re-key call** runs `rekey.piece()` over `over` partitioned, into a
 *   dict by the join key whose merge concatenates each key's rows in input
 *   order. Its output is read by its hash, so its answer is asked to be one
 *   byte at most: e3 answers `too_large` with the output's hash beside it.
 * - **The join call** runs `rekey.joinPiece()` over the re-key call's output,
 *   an `object` argument by its hash, and the join's other side, both
 *   partitioned, so e3 cuts them at the same keys; every other argument
 *   reaches each piece whole. Its output kind is the split's, and its final
 *   function `rekey.joinThen()`.
 * - **The answer** is the join call's, with the re-key call's dataset first in
 *   what the run read, as the re-key call pinned it; or the re-key call's own
 *   when it ended without an output.
 */
export function rekeyCallRequests(split: JqSplitCall, root: QueryRoot, options: QueryOptions = {}): RekeyCalls {
    const rekey = split.rekey;
    if (rekey === null) throw new Error("rekeyCallRequests: the split re-keys no join");
    const { limits, runner } = queryLimits(options);
    const path = (name: string) => entryNamed(root, name, "rekeyCallRequests").path;
    const first: SplitCallRequest = {
        bodyIr: encodeEastIR(rekey.piece().toIR()),
        args: [{ arg: variant("dataset", path(split.over)), partition: some({ by: [] }) }],
        output: variant("dict", { merge: some(encodeEastIR(rekey.output.merge().toIR())) }),
        then: none,
        runner,
        limits: some({
            timeoutMs: limits.type === "some" ? limits.value.timeoutMs : none,
            maxResultBytes: some(1n),
            maxLogBytes: limits.type === "some" ? limits.value.maxLogBytes : none,
        }),
    };
    const piece = encodeEastIR(rekey.joinPiece().toIR());
    const then = rekey.joinThen();
    const thenIr = then === null ? none : some(encodeEastIR(then.toIR()));
    return {
        first,
        join: (output) => ({
            bodyIr: piece,
            args: rekey.inputs.map(input => input.name === split.over
                ? { arg: variant("object", output), partition: some({ by: [] }) }
                : { arg: variant("dataset", path(input.name)), partition: input.name === rekey.name ? some({ by: [] }) : none }),
            output: outputOf(split.output),
            then: thenIr,
            runner,
            limits,
        }),
        answer: (firstResult, joinResult) => ({
            ...(joinResult ?? firstResult),
            inputs: [...firstResult.inputs, ...(joinResult?.inputs ?? [])],
        }),
    };
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
