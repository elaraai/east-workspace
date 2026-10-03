/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A query's calls answered in memory (#940, #941): the stand-ins for e3 where
 * there is no server — the east-ui showcase, and the builder's tests — as
 * `createInMemoryFunctionApi` stands in for a deployed function.
 *
 * - **A one-shot call** ({@link createInMemoryQueryCall}), which the builder
 *   makes through it when a `QueryCallProvider` hands it over.
 * - **A split call** ({@link createInMemorySplitCall}), run as e3 runs one:
 *   the partitioned dataset cut into pieces — datasets partitioned together
 *   cut at the same keys — each piece's program run, the pieces' outputs
 *   assembled by the output kind and kept by their hash, which a later call's
 *   `object` argument reads, and the final function run once — through a
 *   `QuerySplitCallProvider`.
 * - **A data source's status** ({@link createInMemorySourceStatus}): what each
 *   dataset holds and weighs — through a `QuerySourceStatusProvider`.
 *
 * @packageDocumentation
 */

import {
    ArrayType, DictType, EastError, SetType, SortedMap, SortedSet,
    compareFor, decodeBeast2, decodeBeast2For, decodeEastIR, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, none, printFor, sha256Hex, variant,
    type EastType,
} from "@elaraai/east";
import type { SplitCallAnswer } from "@elaraai/e3-api-client";
import {
    TreePathType, pathToString,
    type ExecuteResult, type OneShotRequest, type SplitCallProgress, type SplitCallRequest, type TreePath,
} from "@elaraai/e3-types";
import type { QueryCall, QuerySourceStatus, QuerySplitCall } from "./hooks.js";

/**
 * A dataset an in-memory call may read.
 *
 * @property path - Its path in the workspace, as a call's argument names it
 * @property type - Its East type
 * @property value - Its value
 * @property hash - The hash a run pins it at; the SHA-256 of its beast2 bytes when omitted
 * @property bytes - What it weighs in the store, as its status says; its beast2 bytes' length when omitted
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
    /** What it weighs in the store, in bytes, as its status says; its beast2 bytes' length when omitted. A test weighs a small dataset as a large one with it. */
    readonly bytes?: number;
}

/** A dataset held in memory, its bytes encoded and hashed once, when first asked for. */
interface HeldDataset extends InMemoryDataset {
    /** The hash a run pins it at. */
    readonly hashOf: () => string;
    /** What it weighs. */
    readonly bytesOf: () => number;
}

const samePath = equalFor(TreePathType);

/** Holds the datasets: each encoded, hashed and weighed once, when first asked. */
function hold(datasets: readonly InMemoryDataset[]): HeldDataset[] {
    return datasets.map((dataset) => {
        let encoded: Uint8Array | undefined;
        let hash = dataset.hash;
        const bytes = () => (encoded ??= encodeBeast2For(dataset.type)(dataset.value as never));
        return { ...dataset, hashOf: () => (hash ??= sha256Hex(bytes())), bytesOf: () => dataset.bytes ?? bytes().length };
    });
}

/** The output streams of a call that said nothing. */
const QUIET = { stdout: "", stdoutTruncated: false, stderrTruncated: false } as const;

/** The `invalid` result e3 answers a call it refuses, before anything runs. */
function invalid(message: string): ExecuteResult {
    return { ...QUIET, outcome: variant("invalid", { diagnostics: [{ message, filename: none, line: none, column: none }] }), stderr: "", inputs: [] };
}

/** How e3 refuses a dataset argument with nothing at its path: as it refuses an unassigned dataset. */
function unassigned(i: number, path: TreePath): string {
    return `Dataset argument ${i} is not assigned (ref type: unassigned): nothing in memory at ${pathToString(path)}`;
}

/** A call's largest answer, from its limits; `undefined` when it sets none. */
function maxResultBytes(limits: OneShotRequest["limits"]): bigint | undefined {
    return limits.type === "some" && limits.value.maxResultBytes.type === "some" ? limits.value.maxResultBytes.value : undefined;
}

/** A call's answer, as e3 answers it: beast2 at its type, or `too_large` over the call's limit. */
function answer(type: EastType, value: unknown, limits: OneShotRequest["limits"], inputs: ExecuteResult["inputs"]): ExecuteResult {
    const bytes = encodeBeast2For(type)(value as never);
    const limit = maxResultBytes(limits);
    if (limit !== undefined && BigInt(bytes.length) > limit) {
        return { ...QUIET, outcome: variant("too_large", { bytes: BigInt(bytes.length), limit }), stderr: "", inputs };
    }
    return { ...QUIET, outcome: variant("success", { value: bytes }), stderr: "", inputs };
}

/** A body that raised an East error, failed as a runner's run fails: exit code 1, and `Error: <message>` with its places. */
function raised(err: EastError, inputs: ExecuteResult["inputs"]): ExecuteResult {
    return { ...QUIET, outcome: variant("failed", { exitCode: 1n }), stderr: `Error: ${err.toString()}\n`, inputs };
}

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
    const held = hold(datasets);
    return async (request: OneShotRequest): Promise<ExecuteResult> => {
        const read: HeldDataset[] = [];
        for (const [i, arg] of request.args.entries()) {
            const found = arg.type === "dataset" ? held.find(d => samePath(d.path, arg.value)) : undefined;
            if (found === undefined) {
                return invalid(arg.type === "dataset" ? unassigned(i, arg.value) : `Argument ${i} is an inline value, which an in-memory call does not take`);
            }
            read.push(found);
        }
        const inputs = read.map(d => ({ path: d.path, hash: d.hashOf() }));
        const body = decodeEastIR(request.bodyIr);
        const type = fromEastTypeValue(body.ir.value.type);
        if (type.type !== "Function") throw new Error("createInMemoryQueryCall: a call's body is a function");
        let value: unknown;
        try {
            value = body.compile([])(...read.map(d => d.value));
        } catch (err) {
            if (!(err instanceof EastError)) throw err;
            return raised(err, inputs);
        }
        return answer(type.output, value, request.limits, inputs);
    };
}

/** Options for {@link createInMemorySplitCall}. */
export interface InMemorySplitCallOptions {
    /**
     * How many pieces the partitioned dataset is cut into, in order: as near
     * equal runs of its rows as can be, some empty when there are more pieces
     * than rows.
     */
    readonly pieces: number;
}

/** A program compiled from IR: a function of its arguments. */
type Compiled = (...args: unknown[]) => unknown;

/** A program of a request, decoded and compiled with no platform function, and its type. */
function compiled(ir: Uint8Array, what: string): { fn: Compiled; inputs: EastType[]; output: EastType } {
    const decoded = decodeEastIR(ir);
    const type = fromEastTypeValue(decoded.ir.value.type);
    if (type.type !== "Function") throw new Error(`createInMemorySplitCall: the call's ${what} is a function`);
    return { fn: decoded.compile([]) as Compiled, inputs: type.inputs as EastType[], output: type.output as EastType };
}

/** A collection cut into `k` pieces in order: runs of its rows, as near equal as can be. */
function cut(value: unknown, type: EastType, k: number): unknown[] {
    const t = type.type === "Recursive" ? type.node as EastType : type;
    const runs = <T>(rows: readonly T[]): T[][] => Array.from({ length: k }, (_, i) => rows.slice(Math.floor(i * rows.length / k), Math.floor((i + 1) * rows.length / k)));
    switch (t.type) {
        case "Array":
            return runs(value as readonly unknown[]);
        case "Set": {
            const compare = compareFor(t.key as EastType);
            return runs([...(value as SortedSet<unknown>)]).map(rows => new SortedSet(rows, compare));
        }
        case "Dict": {
            const compare = compareFor(t.key as EastType);
            return runs([...(value as SortedMap<unknown, unknown>).entries()]).map(rows => new SortedMap(rows, compare));
        }
        default:
            throw new Error(`createInMemorySplitCall: a partitioned argument is an Array, a Set or a Dict, not ${t.type}`);
    }
}

/** The type a value is cut by: its recursive wrapper read through. */
function opened(type: EastType): EastType {
    return type.type === "Recursive" ? type.node as EastType : type;
}

/** A dict cut at fences: its entries below the first, then from each fence up to the next, then from the last on; empty pieces after, to `k`. */
function cutAt(value: unknown, type: EastType, fences: readonly unknown[], k: number): unknown[] {
    const compare = compareFor((opened(type) as EastType & { key: EastType }).key);
    const entries = [...(value as SortedMap<unknown, unknown>).entries()];
    return Array.from({ length: k }, (_, i) => {
        if (i > fences.length) return new SortedMap([], compare);
        const lo = i === 0 ? undefined : fences[i - 1];
        const hi = i === fences.length ? undefined : fences[i];
        return new SortedMap(entries.filter(([key]) => (lo === undefined || compare(key, lo) >= 0) && (hi === undefined || compare(key, hi) < 0)), compare);
    });
}

/**
 * The partitioned arguments cut into `k` pieces, by argument: one into runs
 * of its rows; several, which must be dicts keyed alike, at the same keys —
 * the first key of each run of the one whose beast2 bytes weigh the most, as
 * e3 cuts datasets partitioned together by the heaviest.
 *
 * @returns the pieces by argument, or why the arguments cannot be cut together
 */
function cutTogether(values: readonly unknown[], types: readonly EastType[], partitioned: readonly number[], k: number): Map<number, unknown[]> | string {
    if (partitioned.length === 1) return new Map([[partitioned[0]!, cut(values[partitioned[0]!], types[partitioned[0]!]!, k)]]);
    const keys = partitioned.map(i => opened(types[i]!));
    const first = keys[0]!;
    if (!keys.every(t => t.type === "Dict" && first.type === "Dict" && isTypeEqual(t.key as EastType, first.key as EastType))) {
        return "arguments partitioned together are dicts keyed by one type: their pieces are cut at the same keys";
    }
    let heaviest = partitioned[0]!;
    let most = -1;
    for (const i of partitioned) {
        const bytes = encodeBeast2For(types[i]!)(values[i] as never).length;
        if (bytes > most) [heaviest, most] = [i, bytes];
    }
    const runs = cut(values[heaviest], types[heaviest]!, k) as SortedMap<unknown, unknown>[];
    // A run's first key starts its piece; an empty run, and every run after the last key, start none.
    const fences: unknown[] = [];
    for (const run of runs.slice(1)) {
        const start = run.keys().next();
        if (start.done === true) break;
        fences.push(start.value);
    }
    return new Map(partitioned.map(i => [i, cutAt(values[i], types[i]!, fences, k)]));
}

/** A stage's progress, as a job reports it. */
function progress(phase: "partition" | "merge" | "combine", done: number, units: number): SplitCallProgress {
    return { phase: variant(phase, null), done: BigInt(done), units: BigInt(units) };
}

/**
 * Builds a split call answered in memory, run as e3 runs one: the request's
 * programs decoded and compiled with no platform function — a plan's are
 * platform-free — the partitioned dataset cut into a given number of pieces,
 * each piece's program run with an `emit` that collects what it emits, the
 * pieces' outputs assembled by the output kind, and the final function run
 * once over the assembled output and the arguments.
 *
 * @param datasets - The datasets a call may read
 * @param options - How many pieces the partitioned dataset is cut into
 * @returns The call
 *
 * @remarks
 * Each output kind assembles as e3 assembles it (`e3-data-architecture.md`
 * §3.7), a piece at a time and then across the pieces in input order:
 * - `array`: each piece's rows, concatenated;
 * - `set`: their union, in East's order;
 * - `dict`: by key, a key emitted again folded with `merge(key, a, b)` in
 *   emission order — within a piece, then across the pieces; without `merge`,
 *   a key emitted twice fails, naming it;
 * - `fold`: every value a piece emits folded with `combine`, starting from
 *   `zero`; then the pieces' partials folded the same way.
 *
 * Arguments partitioned together — dicts keyed alike (#942) — are cut at the
 * same keys: the first key of each run of the one whose beast2 bytes weigh
 * the most. The assembled output is kept by the SHA-256 of its beast2 bytes,
 * which the answer gives, and a later call of this stand-in reads it by that
 * hash as an `object` argument, as e3 reads an earlier call's output.
 *
 * With no `then`, the call's value is the assembled output. Its answer is as a
 * one-shot call's: beast2 at the value's type with each dataset argument
 * pinned at its hash, `failed` for an East error with its places on stderr,
 * `invalid` for an argument naming nothing here — a dataset, or an object no
 * call of this stand-in assembled — or for arguments that cannot be cut
 * together, and `too_large` over the request's `maxResultBytes`. It reports
 * each piece done, then the merge or the fold, to `onProgress`, yielding
 * between pieces, and rejects with the signal's reason once abandoned. The
 * time limit is not kept.
 *
 * @example
 * ```tsx
 * const split = createInMemorySplitCall([{ path: ORDERS, type: OrdersType, value: orders }], { pieces: 7 });
 * return <QuerySplitCallProvider call={split}>{surface}</QuerySplitCallProvider>;
 * ```
 */
export function createInMemorySplitCall(datasets: readonly InMemoryDataset[], options: InMemorySplitCallOptions): QuerySplitCall {
    const pieces = options.pieces;
    if (!Number.isSafeInteger(pieces) || pieces < 1) throw new RangeError(`createInMemorySplitCall: pieces is ${pieces}, not a whole number of at least 1`);
    const held = hold(datasets);
    // The outputs the calls assembled, by hash: what a later call's `object` argument reads.
    const stored = new Map<string, unknown>();
    return async (request: SplitCallRequest, { signal, onProgress }): Promise<SplitCallAnswer> => {
        const refused = (message: string): SplitCallAnswer => ({ result: invalid(message), output: null });
        // The arguments: a dataset by its path, pinned at its hash; an object by its hash; a value as its bytes say.
        const values: unknown[] = [];
        const inputs: ExecuteResult["inputs"] = [];
        const partitioned: number[] = [];
        for (const [i, { arg, partition }] of request.args.entries()) {
            if (partition.type === "some") partitioned.push(i);
            if (arg.type === "dataset") {
                const found = held.find(d => samePath(d.path, arg.value));
                if (found === undefined) return refused(unassigned(i, arg.value));
                values.push(found.value);
                inputs.push({ path: found.path, hash: found.hashOf() });
            } else if (arg.type === "value") {
                values.push(decodeBeast2(arg.value).value);
            } else {
                if (!stored.has(arg.value)) return refused(`Object argument ${i} names ${arg.value}, which the repository does not hold`);
                values.push(stored.get(arg.value));
            }
        }
        if (partitioned.length === 0) return refused("a split call partitions at least one of its arguments: its pieces are cut from it");

        const body = compiled(request.bodyIr, "body");
        const emitType = body.inputs.at(-1);
        if (emitType?.type !== "Function") throw new Error("createInMemorySplitCall: the body's last parameter is its emit function");
        const emitted = emitType.inputs as EastType[];
        const then = request.then.type === "some" ? compiled(request.then.value, "final function") : undefined;
        const output = request.output;
        const cuts = cutTogether(values, body.inputs, partitioned, pieces);
        if (typeof cuts === "string") return refused(cuts);
        // The assembled output's hash, once the pieces ran: a final function that fails still has it, as e3's job does.
        let hash: string | null = null;
        try {
            // Each piece, its program run over its piece of every partitioned argument and the others whole.
            const outputs: unknown[][][] = [];
            onProgress(progress("partition", 0, pieces));
            for (let p = 0; p < pieces; p++) {
                signal.throwIfAborted();
                const args = values.map((value, i) => cuts.get(i)?.[p] ?? value);
                const out: unknown[][] = [];
                body.fn(...args, (...emit: unknown[]) => { out.push(emit); return null; });
                outputs.push(out);
                onProgress(progress("partition", p + 1, pieces));
                // A host sees the progress, and may abandon the call, between pieces.
                await Promise.resolve();
            }
            signal.throwIfAborted();
            let assembled: unknown;
            let type: EastType;
            switch (output.type) {
                case "array":
                    type = ArrayType(emitted[0]!);
                    assembled = outputs.flatMap(out => out.map(([row]) => row));
                    break;
                case "set": {
                    const key = emitted[0]!;
                    type = SetType(key);
                    onProgress(progress("merge", 0, 1));
                    assembled = new SortedSet(outputs.flatMap(out => out.map(([row]) => row)), compareFor(key));
                    onProgress(progress("merge", 1, 1));
                    break;
                }
                case "dict": {
                    const [key, value] = [emitted[0]!, emitted[1]!];
                    type = DictType(key, value);
                    const merge = output.value.merge.type === "some" ? compiled(output.value.merge.value, "merge").fn : undefined;
                    const printKey = printFor(key);
                    const into = (dict: SortedMap<unknown, unknown>, k: unknown, v: unknown): void => {
                        if (!dict.has(k)) { dict.set(k, v); return; }
                        if (merge === undefined) throw new EastError(`the key ${printKey(k as never)} is emitted twice, and the dict output has no merge`);
                        dict.set(k, merge(k, dict.get(k), v));
                    };
                    // Within a piece, in emission order; then across the pieces, in input order.
                    const perPiece = outputs.map(out => {
                        const dict = new SortedMap<unknown, unknown>([], compareFor(key));
                        for (const [k, v] of out) into(dict, k, v);
                        return dict;
                    });
                    onProgress(progress("merge", 0, 1));
                    const all = new SortedMap<unknown, unknown>([], compareFor(key));
                    for (const dict of perPiece) for (const [k, v] of dict) into(all, k, v);
                    onProgress(progress("merge", 1, 1));
                    assembled = all;
                    break;
                }
                case "fold": {
                    type = emitted[0]!;
                    const combine = compiled(output.value.combine, "combine").fn;
                    const zero = decodeBeast2For(type)(output.value.zero);
                    // Each piece's values folded from the zero, then the pieces' partials, in input order.
                    const partials = outputs.map(out => out.reduce((acc: unknown, [v]) => combine(acc, v), zero));
                    onProgress(progress("combine", 0, 1));
                    assembled = partials.reduce((acc: unknown, v) => combine(acc, v), zero);
                    onProgress(progress("combine", 1, 1));
                    break;
                }
            }
            // Kept by its hash, as e3 stores a call's output.
            hash = sha256Hex(encodeBeast2For(type)(assembled as never));
            stored.set(hash, assembled);
            if (then === undefined) return { result: answer(type, assembled, request.limits, inputs), output: hash };
            return { result: answer(then.output, then.fn(assembled, ...values), request.limits, inputs), output: hash };
        } catch (err) {
            if (!(err instanceof EastError)) throw err;
            return { result: raised(err, inputs), output: hash };
        }
    };
}

/**
 * Builds a data source's status answered in memory: how many rows each
 * dataset holds, its hash, and what it weighs — its beast2 bytes' length, or
 * the weight a test gives it.
 *
 * @param datasets - The datasets
 * @returns The status
 *
 * @remarks
 * A list's, a set's or a lookup table's rows are its elements; any other
 * value's are not counted. A path with nothing in memory is refused, as e3
 * refuses a dataset it does not hold.
 *
 * @example
 * ```tsx
 * const status = createInMemorySourceStatus([{ path: ORDERS, type: OrdersType, value: orders }]);
 * return <QuerySourceStatusProvider status={status}>{surface}</QuerySourceStatusProvider>;
 * ```
 */
export function createInMemorySourceStatus(datasets: readonly InMemoryDataset[]): QuerySourceStatus {
    const held = hold(datasets);
    return async (path: TreePath) => {
        const found = held.find(d => samePath(d.path, path));
        if (found === undefined) throw new Error(`createInMemorySourceStatus: nothing in memory at ${pathToString(path)}`);
        return { rows: rowsOf(found), hash: found.hashOf(), bytes: found.bytesOf() };
    };
}

/** How many elements a collection holds; `undefined` for a value that is not one. */
function rowsOf(dataset: InMemoryDataset): number | undefined {
    switch (dataset.type.type) {
        case "Array": return (dataset.value as readonly unknown[]).length;
        case "Set": return (dataset.value as SortedSet<unknown>).size;
        case "Dict": return (dataset.value as SortedMap<unknown, unknown>).size;
        default: return undefined;
    }
}
