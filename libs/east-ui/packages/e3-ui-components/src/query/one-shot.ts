/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A query's one-shot call (#935, with #928 folded in): the builder runs a
 * query with no query code on the server. The query is checked once against
 * the whole root its data sources make, translated to East IR here, and run
 * as a function, as one-shot runs any caller's IR (#1031), with one dataset
 * argument per data source it reads (`devdocs/QUERY.md` §17). The call is
 * platform-free — east-c given no platform package, and a body that calls no
 * platform function — so a caller who may read the workspace may run it.
 *
 * The builder sends {@link PreparedQuery.request} with e3-api-client's
 * `oneShotExecute` and reads what comes back with {@link queryResultOf}.
 * Everything here is a pure function: nothing reaches the network or the DOM.
 *
 * @packageDocumentation
 */

import {
    ArrayType, OptionType, StringType, StructType,
    checkJq, decodeBeast2For, encodeBeast2For, encodeEastIR, equalFor, fromEastTypeValue, none, printFor, runtimeErrorAt, some,
    translateJq, variant,
    type CheckJqResult, type EastType, type EastTypeValue, type JqMultiplicity, type JqNode, type QueryDiagnostic, type ValueTypeOf,
} from "@elaraai/east";
import { TreePathType, pathToString, type ExecuteResult, type OneShotRequest, type RunnerValue } from "@elaraai/e3-types";
import type { QueryInputType, QueryResultType, QueryRootEntryType } from "@elaraai/e3-ui/internal";

// ─── The root ────────────────────────────────────────────────────────────────

/**
 * A data source of a query's root, as the builder binds it: the root field a
 * query reads it by, its dataset's path, and the dataset's type.
 *
 * @remarks
 * `name` and `path` are a {@link QueryRootEntryType} value, what a saved query
 * keeps of its root; `type` is the dataset's East type, as e3 lists it.
 */
export type QueryRootEntry = ValueTypeOf<typeof QueryRootEntryType> & {
    /** The dataset's East type, as e3 lists it. */
    type: EastTypeValue;
};

/**
 * A query's root: the type every query of the builder is checked against, and
 * the data sources it is made of.
 *
 * @property type - The root's type: a Struct of the data sources' types, in entry order
 * @property entries - The data sources, in root order
 */
export interface QueryRoot {
    /** The root's type: a Struct of the data sources' types, in entry order. */
    readonly type: EastType;
    /** The data sources, in root order. */
    readonly entries: QueryRootEntry[];
}

/** A name `.name` reads: the jq lexer's field name, a letter or `_`, then letters, digits and `_`. */
const JQ_IDENTIFIER = /^[A-Za-z_][A-Za-z_0-9]*$/;

/** A name as East's text writes a string, for a message. */
const printString = printFor(StringType);

/**
 * The root a query's data sources make: the builder's `useQueryRoot` gives it
 * from the data sources a page binds.
 *
 * @param entries - the data sources, in root order
 * @returns the root: a Struct of the data sources' types, in entry order, and
 *   the data sources
 * @throws {Error} When a name is not a jq identifier, or is given twice,
 *   naming it.
 *
 * @remarks
 * The root is only a type. Its entries become the translation's parameters,
 * one dataset each, because a lazy dataset put into a struct is read whole
 * (`devdocs/QUERY.md` §15.6). A name is a jq identifier — a letter or `_`,
 * then letters, digits and `_` — so `.name` reads it. A root of no data
 * sources is the empty Struct, and a query that reads a data source of it is
 * refused when it is checked.
 *
 * @example
 * ```ts
 * const root = queryRoot([
 *     { name: "customers", path: [variant("field", "inputs"), variant("field", "customers")], type: toEastTypeValue(Customers) },
 *     { name: "orders", path: [variant("field", "inputs"), variant("field", "orders")], type: toEastTypeValue(Orders) },
 * ]);
 * // root.type is StructType({ customers: Customers, orders: Orders })
 *
 * queryRoot([{ name: "order lines", path, type }]);
 * // throws: queryRoot: "order lines" is not a jq identifier: …
 * ```
 */
export function queryRoot(entries: readonly QueryRootEntry[]): QueryRoot {
    const names = new Set<string>();
    for (const { name } of entries) {
        if (!JQ_IDENTIFIER.test(name)) {
            throw new Error(`queryRoot: ${printString(name)} is not a jq identifier: a data source's name is a letter or _, then letters, digits and _, so .name reads it`);
        }
        if (names.has(name)) throw new Error(`queryRoot: ${printString(name)} is given twice: each data source of a root has a name of its own`);
        names.add(name);
    }
    return {
        type: StructType(Object.fromEntries(entries.map(entry => [entry.name, fromEastTypeValue(entry.type)]))),
        entries: [...entries],
    };
}

// ─── Preparing a call ────────────────────────────────────────────────────────

/** The most outputs a `many` query returns, by default: as many as `long_range` warns past (`devdocs/QUERY.md` §12). */
const DEFAULT_MAX_OUTPUTS = 1_000;

/** The most outputs a `many` query may be asked for. */
const MAX_OUTPUTS = 100_000;

/** The largest answer a call returns, in bytes, by default: 1 MiB. */
const DEFAULT_MAX_BYTES = 1_048_576;

/**
 * Options for {@link prepareQuery}: the call's limits, and its runner.
 *
 * @property maxOutputs - The most outputs a `many` query returns: 1 000 by default, at most 100 000
 * @property maxBytes - The largest answer the call returns, in bytes: 1 MiB by default
 * @property timeoutMs - The call's time limit, in milliseconds: the server's when omitted
 * @property runner - The runner: east-c given no platform package, by default
 */
export interface QueryOptions {
    /** The most outputs a `many` query returns: 1 000 by default, at most 100 000. */
    readonly maxOutputs?: number;
    /** The largest answer the call returns, in bytes: 1 MiB by default. */
    readonly maxBytes?: number;
    /**
     * The call's time limit, in milliseconds. Omitted, the call names none and
     * the server's applies: its default for a call that names none, under the
     * longest a request to it may take (#1131).
     */
    readonly timeoutMs?: number;
    /** The runner: east-c given no platform package by default, which any caller who may read the workspace may run. */
    readonly runner?: RunnerValue;
}

/** What a run of a query answered: a {@link QueryResultType} value. */
export type QueryResult = ValueTypeOf<typeof QueryResultType>;

/** How a run of a query ended. */
type QueryOutcome = QueryResult["outcome"];

/** A dataset a run read, pinned at its hash. */
type QueryInput = ValueTypeOf<typeof QueryInputType>;

/**
 * What the checker made of a program that checks: the program as written, the
 * type of each output and how many there are, each present.
 */
export type CheckedProgram = CheckJqResult & {
    /** The program as written. */
    readonly program: JqNode;
    /** The type of each output. */
    readonly elementType: EastType;
    /** How many outputs the program gives. */
    readonly multiplicity: JqMultiplicity;
};

/**
 * Whether a program checks: its program, the type of each output and how many
 * there are are present exactly when no diagnostic is an error.
 *
 * @param checked - what `checkJq` made of the program
 * @returns whether it checks
 */
export function programChecks(checked: CheckJqResult): checked is CheckedProgram {
    return checked.program !== null && checked.elementType !== null && checked.multiplicity !== null;
}

/**
 * A query's one-shot call, ready to send, and what reading its answer needs.
 *
 * @property checked - What the checker made of the program: the program as written, the type of each output and how many there are, and the spans a runtime error is placed by
 * @property entries - The data sources the query reads, one per argument of the call, in its order
 * @property request - The call, which e3-api-client's `oneShotExecute` sends
 * @property maxOutputs - The most outputs a `many` query returns
 */
export interface PreparedQuery {
    /** What the checker made of the program: the program as written, the type of each output and how many there are, and the spans a runtime error is placed by. */
    readonly checked: CheckedProgram;
    /** The data sources the query reads, one per argument of the call, in its order: the order the query first reads them. */
    readonly entries: QueryRootEntry[];
    /** The call, which e3-api-client's `oneShotExecute` sends. */
    readonly request: OneShotRequest;
    /** The most outputs a `many` query returns; the call gives one more, which says the answer was cut short. */
    readonly maxOutputs: number;
}

/**
 * What reading a call's answer needs ({@link queryResultOf}): the checker's
 * record of the query that ran — the type of each output, and how many there
 * are — the data sources in the call's argument order, and its most outputs. A
 * one-shot call's {@link PreparedQuery} is one; so is a split call's, which
 * the planner gives (`plan.ts`).
 */
export type QueryReading = Pick<PreparedQuery, "checked" | "entries" | "maxOutputs">;

/** A call's limits and runner, as its options set them: what a one-shot call and a split call both send. */
export interface QueryLimits {
    /** The most outputs a `many` query returns. */
    readonly maxOutputs: number;
    /** The call's limits: its largest answer as `maxResultBytes`, and its time limit when the options name one. */
    readonly limits: OneShotRequest["limits"];
    /** The runner: east-c given no platform package, unless the options name another. */
    readonly runner: RunnerValue;
}

/**
 * A call's limits and runner, from its options: its most outputs and its
 * largest answer their defaults when the options give none, and no time limit
 * unless the options name one, so the server's applies (#1131).
 *
 * @param options - the call's limits and its runner
 * @returns the most outputs, the limits and the runner
 * @throws {RangeError} When a limit is not a whole number of at least 1.
 */
export function queryLimits(options: QueryOptions = {}): QueryLimits {
    const maxOutputs = Math.min(limitOf(options.maxOutputs, DEFAULT_MAX_OUTPUTS, "maxOutputs"), MAX_OUTPUTS);
    const maxBytes = limitOf(options.maxBytes, DEFAULT_MAX_BYTES, "maxBytes");
    const timeoutMs = options.timeoutMs === undefined ? none : some(BigInt(checkedLimit(options.timeoutMs, "timeoutMs")));
    return {
        maxOutputs,
        limits: some({ timeoutMs, maxResultBytes: some(BigInt(maxBytes)), maxLogBytes: none }),
        runner: options.runner ?? platformFreeEastC(),
    };
}

/**
 * Prepares a query's one-shot call: checks the program once against the whole
 * root, translates it, and builds the request.
 *
 * @param program - the query's jq text
 * @param root - the root its data sources make ({@link queryRoot})
 * @param options - the call's limits and its runner
 * @returns the prepared call; or, for a program that does not check, the
 *   `error` result a run of it gives
 * @throws {RangeError} When a limit is not a whole number of at least 1.
 * @throws {TranslationError} When the checked program holds something the
 *   translator cannot express: a gap in the translation, never a mistake in
 *   the query.
 *
 * @remarks
 * - **One check.** The program is checked with
 *   `checkJq(program, root.type, { root: true })`, once, against the whole
 *   root, which is never narrowed to what the query reads (#1041): `keys` on
 *   the root answers every name. A problem of error severity is an `error`
 *   result holding the checker's diagnostics, lints included, and no input,
 *   since nothing ran; reading the whole root is one.
 * - **The translation.** `translateJq` translates it, a `many` query asked
 *   for at most `maxOutputs + 1` outputs (#923). Its parameters are the
 *   datasets it reads, in the order it first reads them.
 * - **The request.** `bodyIr` is the translation as an East function, its IR
 *   encoded with its source map, so a runtime error names its place in the
 *   jq; `args` is one `dataset` argument per dataset read, in the
 *   translation's order; `runner` is east-c given no platform package, unless
 *   the options name another; `limits` holds `maxBytes` as `maxResultBytes`,
 *   and `timeoutMs` when the options give one. A call that names no time limit
 *   runs under the server's: its default for a call that names none, under
 *   the longest a request to it may take (#1131).
 * - **Platform-free.** A translation calls East's builtins only, so the body
 *   holds no `Platform` node, and with the default runner any caller who may
 *   read the workspace may run the call (#1031).
 *
 * @example
 * ```ts
 * const prepared = prepareQuery(".orders | map(.total) | add", root, { timeoutMs: 10_000 });
 * if ("result" in prepared) return prepared.result;   // the checker's problems
 * const result = await oneShotExecute(url, repo, workspace, prepared.prepared.request, { token });
 * return queryResultOf(prepared.prepared, result);
 * ```
 */
export function prepareQuery(program: string, root: QueryRoot, options: QueryOptions = {}): { prepared: PreparedQuery } | { result: QueryResult } {
    // The limits are checked before the program, so a wrong one is refused whatever the program.
    queryLimits(options);
    return prepareCheckedQuery(checkJq(program, root.type, { root: true }), root, options);
}

/**
 * Prepares a query's one-shot call from what the checker made of it: what
 * {@link prepareQuery} does once it has checked the program, for a caller that
 * has checked it already — the planner, which checks a query once to split it
 * and to call it.
 *
 * @param checked - what `checkJq` made of the program, against `root.type`, as an e3 root
 * @param root - the root
 * @param options - the call's limits and its runner
 * @returns the prepared call; or, for a program that does not check, the `error` result a run of it gives
 * @throws {RangeError} When a limit is not a whole number of at least 1.
 * @throws {TranslationError} When the checked program holds something the translator cannot express.
 */
export function prepareCheckedQuery(checked: CheckJqResult, root: QueryRoot, options: QueryOptions = {}): { prepared: PreparedQuery } | { result: QueryResult } {
    const { maxOutputs, limits, runner } = queryLimits(options);
    if (!programChecks(checked)) return { result: { inputs: [], outcome: variant("error", checked.diagnostics) } };
    const translation = translateJq(checked, checked.multiplicity === "many" ? { maxOutputs } : {});
    const entries = translation.inputs.map(input => entryNamed(root, input.name));
    const request: OneShotRequest = {
        bodyIr: encodeEastIR(translation.fn().toIR()),
        args: entries.map(entry => variant("dataset", entry.path)),
        runner,
        limits,
    };
    return { prepared: { checked, entries, request, maxOutputs } };
}

/**
 * A limit of a call: its default when the options give none.
 *
 * @param value - the limit the options give
 * @param fallback - its default
 * @param name - its name, for the error
 * @returns the limit
 * @throws {RangeError} When it is not a whole number of at least 1.
 */
function limitOf(value: number | undefined, fallback: number, name: string): number {
    return value === undefined ? fallback : checkedLimit(value, name);
}

/**
 * A limit the options give, checked.
 *
 * @param value - the limit
 * @param name - its name, for the error
 * @returns the limit
 * @throws {RangeError} When it is not a whole number of at least 1.
 */
function checkedLimit(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`prepareQuery: ${name} is ${value}, not a whole number of at least 1`);
    return value;
}

/**
 * The data source of a root a query reads by a name.
 *
 * @param root - the root
 * @param name - the root field the translation, or the split, reads
 * @param caller - what asks, for the error: `prepareQuery` by default
 * @returns the data source
 * @throws {Error} When the root has none of that name: its type was not made from its entries.
 */
export function entryNamed(root: QueryRoot, name: string | null, caller = "prepareQuery"): QueryRootEntry {
    const entry = root.entries.find(e => e.name === name);
    if (entry === undefined) throw new Error(`${caller}: the query reads .${name ?? ""}, which no data source of the root is`);
    return entry;
}

/**
 * east-c given no platform package, each collection read lazily: the runner of
 * a platform-free call, which any caller who may read the workspace may run.
 *
 * @returns the runner
 */
function platformFreeEastC(): RunnerValue {
    return variant("east_c", { platforms: [], decode: variant("lazy", null) });
}

// ─── Reading the answer ──────────────────────────────────────────────────────

/**
 * What a query's call answered: a one-shot call's, or a split call's.
 *
 * @param prepared - the call, as {@link prepareQuery} prepared it; or a split
 *   call's reading, as the planner gives it — both a {@link QueryReading}
 * @param result - what e3-api-client's `oneShotExecute` returned for it, or a
 *   split call's result (`splitCall`'s `result`)
 * @returns the answer: how the run ended, and the datasets it read
 * @throws {Error} When the call read a dataset other than the one the query
 *   reads there: the result is not this call's.
 *
 * @remarks
 * - `success` is `ok`, the value decoded with the translation's result type.
 *   A `many` answer of more than `maxOutputs` outputs — the translation gives
 *   one more — is `truncated`, its last output dropped. `result` is
 *   self-describing beast2 of the answer kept, at the result type, and
 *   `outputs` counts its outputs: one for a `one` query, none or one for
 *   `maybe`.
 * - `failed` for a platform function the runner could not find is
 *   `needs_platform`, naming each: a function value in the data may call one
 *   (`devdocs/QUERY.md` §9).
 * - `failed` otherwise is an `error` of one `runtime` diagnostic: the
 *   runner's message, at the jq node that raised it, placed by east's
 *   `runtimeErrorAt` as `evaluateJq` places one (`devdocs/QUERY.md` §15.3).
 *   A failure with no message says what the runner last said, or its exit
 *   code.
 * - `invalid` is an `error`: `no_value` for a dataset e3 found unassigned
 *   ("orders has no value yet"), and `invalid` for anything else it refused.
 * - `timed_out` and `too_large` are as e3 reported them.
 *
 * `inputs` names each dataset the run read, with the hash e3 pinned it at, in
 * the call's argument order: empty when nothing ran.
 *
 * @example
 * ```ts
 * const result = queryResultOf(prepared, await oneShotExecute(url, repo, workspace, prepared.request, { token }));
 * if (result.outcome.type === "ok") show(decodeBeast2(result.outcome.value.result), result.outcome.value.truncated);
 * ```
 */
export function queryResultOf(prepared: QueryReading, result: ExecuteResult): QueryResult {
    const inputs = inputsOf(prepared, result);
    const outcome = result.outcome;
    switch (outcome.type) {
        case "success":
            return { inputs, outcome: answered(prepared, outcome.value.value) };
        case "failed":
            return { inputs, outcome: failed(prepared.checked, outcome.value.exitCode, result.stderr) };
        case "invalid":
            return { inputs, outcome: variant("error", outcome.value.diagnostics.map(d => refused(prepared, d.message))) };
        case "timed_out":
            return { inputs, outcome: variant("timed_out", { ms: outcome.value.ms }) };
        case "too_large":
            return { inputs, outcome: variant("too_large", { bytes: outcome.value.bytes, limit: outcome.value.limit }) };
    }
}

/** Equality of dataset paths. */
const samePath = equalFor(TreePathType);

/**
 * The datasets a call read, each with the name of the data source it is.
 *
 * @param prepared - the call
 * @param result - what it returned: one pinned dataset per argument, in order
 * @returns the datasets read
 * @throws {Error} When an argument read a dataset other than the data source the query reads there.
 */
function inputsOf(prepared: QueryReading, result: ExecuteResult): QueryInput[] {
    return result.inputs.map((input, i) => {
        const entry = prepared.entries[i];
        if (entry === undefined || !samePath(entry.path, input.path)) {
            throw new Error(`queryResultOf: the call's argument ${i} read ${pathToString(input.path)}, which is not the data source the query reads there`);
        }
        return { hash: input.hash, name: entry.name, path: input.path };
    });
}

/**
 * A successful run's answer, decoded with the query's result type: a `many`
 * answer cut to `maxOutputs` outputs.
 *
 * @param prepared - the call
 * @param bytes - the answer, beast2 at the result type
 * @returns the `ok` outcome
 * @throws {Error} When the answer does not decode at the query's result type.
 */
function answered(prepared: QueryReading, bytes: Uint8Array): QueryOutcome {
    const element = prepared.checked.elementType;
    switch (prepared.checked.multiplicity) {
        case "one":
            // Decoded, so an answer of another type is refused.
            decodeBeast2For(element)(bytes);
            return variant("ok", { outputs: 1n, result: bytes, truncated: false });
        case "maybe": {
            const answer = decodeBeast2For(OptionType(element))(bytes);
            return variant("ok", { outputs: answer.type === "some" ? 1n : 0n, result: bytes, truncated: false });
        }
        case "many": {
            const type = ArrayType(element);
            const answer = decodeBeast2For(type)(bytes);
            if (answer.length <= prepared.maxOutputs) return variant("ok", { outputs: BigInt(answer.length), result: bytes, truncated: false });
            return variant("ok", { outputs: BigInt(prepared.maxOutputs), result: encodeBeast2For(type)(answer.slice(0, prepared.maxOutputs)), truncated: true });
        }
    }
}

/** A failure as every stock runner reports it on stderr. */
interface RunnerFailure {
    /** The error's message. */
    readonly message: string;
    /** Where it was raised, innermost first: a file, and a 1-based line and column. */
    readonly places: readonly { readonly file: string; readonly line: number; readonly column: number }[];
}

/** The line that leads a runner's failure. */
const FAILURE_LEAD = "Error: ";

/** A place a failure was raised at, as a runner lists it under the failure. */
const FAILURE_PLACE = /^ {2}at (.+):(\d+):(\d+)$/;

/**
 * The failure a runner reported: `Error: <message>`, then `  at <file>:<line>:<column>`
 * for each place, innermost first, as east-c, east-node and east-py all write it.
 *
 * @param stderr - the tail of the runner's stderr
 * @returns the failure, or `undefined` when the runner reported none
 */
function failureOf(stderr: string): RunnerFailure | undefined {
    const lines = stderr.replace(/\r\n?/g, "\n").split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const places: { file: string; line: number; column: number }[] = [];
    let end = lines.length;
    for (; end > 0; end--) {
        const place = FAILURE_PLACE.exec(lines[end - 1]!);
        if (place === null) break;
        places.unshift({ file: place[1]!, line: Number(place[2]), column: Number(place[3]) });
    }
    let start = end - 1;
    while (start >= 0 && !lines[start]!.startsWith(FAILURE_LEAD)) start--;
    if (start < 0) return undefined;
    return { message: [lines[start]!.slice(FAILURE_LEAD.length), ...lines.slice(start + 1, end)].join("\n"), places };
}

/**
 * How each runtime says it cannot find a platform function: east-c's
 * `Unknown platform function: name`; and `Platform function 'name' not found`,
 * or `… is not available` for one marked optional, from the others and from
 * east-c's optional ones.
 */
const MISSING_PLATFORM = /Unknown platform function: ([^\s'"]+)|Platform function '([^']+)' (?:not found|is not available)/g;

/**
 * A failed run's outcome: `needs_platform` for platform functions the runner
 * could not find, else the error it raised.
 *
 * @param checked - the program, as the checker read it
 * @param exitCode - the runner's exit code
 * @param stderr - the tail of its stderr
 * @returns the outcome
 */
function failed(checked: CheckJqResult, exitCode: bigint, stderr: string): QueryOutcome {
    const failure = failureOf(stderr);
    const functions: string[] = [];
    // The failure's message names them; with no failure in the runners' framing, anything the runner said may.
    for (const match of (failure?.message ?? stderr).matchAll(MISSING_PLATFORM)) {
        const name = match[1] ?? match[2];
        if (name !== undefined && !functions.includes(name)) functions.push(name);
    }
    if (functions.length > 0) return variant("needs_platform", { functions });
    if (failure === undefined) {
        const said = stderr.split(/\r\n?|\n/).map(line => line.trim()).filter(line => line !== "").at(-1);
        return variant("error", [runtimeErrorAt(checked, said ?? `the run failed with exit code ${exitCode}`)]);
    }
    const place = failure.places.find(p => p.file === "jq");
    return variant("error", [runtimeErrorAt(checked, failure.message, place)]);
}

/** How e3 says a dataset argument has no value: `Dataset argument <i> is not assigned (ref type: …)`. */
const UNASSIGNED = /^Dataset argument (\d+) is not assigned\b/;

/**
 * What e3 refused a call for, as a diagnostic: a dataset with no value yet,
 * by its data source's name, or what e3 said.
 *
 * @param prepared - the call
 * @param message - e3's diagnostic
 * @returns the diagnostic
 */
function refused(prepared: QueryReading, message: string): QueryDiagnostic {
    const unassigned = UNASSIGNED.exec(message);
    const entry = unassigned === null ? undefined : prepared.entries[Number(unassigned[1])];
    if (entry !== undefined) return problem("no_value", `no_value: ${entry.name} has no value yet.`, none);
    return problem("invalid", `invalid: ${message}`, none);
}

/**
 * A diagnostic of error severity, with no fixes and no suggestions.
 *
 * @param code - its code
 * @param message - its sentence, led by its code
 * @param span - the jq text it is about, when it is about some
 * @returns the diagnostic
 */
function problem(code: string, message: string, span: QueryDiagnostic["span"]): QueryDiagnostic {
    return { code, fixes: [], message, severity: variant("error", null), span, suggestions: [] };
}
