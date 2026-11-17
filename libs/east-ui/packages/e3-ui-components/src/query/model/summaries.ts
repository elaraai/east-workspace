/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Summaries (#934): what the rows at a step hold, for a slot's offers and a
 * field's summary (`Query Editor Spec.md` §4.5). A summary is #875's summary
 * program (`summaryProgram`) after the program up to the step, which the
 * builder runs as a one-shot call (#935); this module gives the program and
 * keeps the answers. Nothing here reads data: a summary is fetched only when
 * a slot that needs it opens, never on an edit.
 *
 * @packageDocumentation
 */

import { SummaryType, summaryProgram, type EastType, type ValueTypeOf } from "@elaraai/east";
import type { QueryResult } from "../one-shot.js";
import type { StepField } from "../steps/fields.js";
import { SEP, layOutSteps } from "../steps/print.js";
import type { Shape } from "../steps/shape.js";
import { isComplete, type StepQuery } from "../steps/values.js";
import type { SlotKind } from "./messages.js";
import { leafPath, type SummaryLeaf } from "./words.js";

/** A summary of rows: how many, and each leaf path's summary. */
export type Summary = ValueTypeOf<typeof SummaryType>;

/** The limits a summary's run takes: one output, and five seconds. */
export const SUMMARY_LIMITS = { maxOutputs: 1, timeoutMs: 5_000 } as const;

/** A summary to fetch: the rows at a step, and the program that summarises them. */
export interface SummaryRequest {
    /** The canonical program of the steps before: what the summary is of, and its cache key. */
    readonly prefix: string;
    /** The program to run: the prefix, then the summary. */
    readonly program: string;
    /** The shape of the rows it summarises. */
    readonly shape: Shape;
    /** The data sources it reads, by name: the source, and each Look up's. */
    readonly reads: readonly string[];
}

/**
 * The summary of the rows a step takes.
 *
 * @param query - the query
 * @param stepIndex - the step; the query's length for the rows it gives
 * @param root - the root's type: a struct of the data sources
 * @returns the request, or `undefined` when the rows are not known there: a step before has a problem, or the stage is not rows
 */
export function summaryAt(query: StepQuery, stepIndex: number, root: EastType): SummaryRequest | undefined {
    const prefix: StepQuery = { source: query.source, steps: query.steps.slice(0, stepIndex) };
    const layout = layOutSteps(prefix, root);
    const shape = layout.final;
    if (shape.kind !== "rows" || layout.check.diagnostics.some(d => d.severity.type === "error")) return undefined;
    const text = layout.printed.text;
    const lookups = prefix.steps.flatMap(s => s.type === "lookup" && isComplete(s) && s.value.dataset.type === "some" ? [s.value.dataset.value] : []);
    return {
        prefix: text,
        program: `${text}${SEP}${summaryProgram(shape.type)}`,
        shape,
        reads: [query.source, ...new Set(lookups)],
    };
}

/**
 * A field's leaf of a summary.
 *
 * @param summary - the summary of the rows the field is read in
 * @param field - the field
 * @param list - the list field the field is an item's field of, for an inner condition
 * @returns the leaf, or `undefined` when the summary has none for it
 */
export function leafOf(summary: Summary | undefined, field: StepField, list?: StepField): SummaryLeaf | undefined {
    return summary?.leaves.get(leafPath(field, list));
}

/**
 * Whether a slot's offers come from a summary: a condition's field and
 * value, a field to show, group by, total or sort by, and an input's value.
 *
 * @param slot - the slot's kind
 * @returns whether opening it fetches the summary
 */
export function summaryNeeded(slot: SlotKind): boolean {
    switch (slot) {
        case "field": case "value": case "by": case "agg-field": case "sort-field": case "pick-field": case "pick-add": case "fill-field":
            return true;
        default:
            return false;
    }
}

/** What a summary's run gave: the summary, and the hash of each data source it read. */
export interface SummaryResult {
    /** The summary. */
    readonly summary: Summary;
    /** Each data source read, by name, with the hash the run read. */
    readonly hashes: ReadonlyMap<string, string>;
}

/**
 * Runs a summary's program: the builder's one-shot call (#935).
 *
 * @param request - the summary to fetch
 * @returns what it gave, or `undefined` when it failed: the popover then lists no values
 */
export type SummaryRun = (request: SummaryRequest) => Promise<SummaryResult | undefined>;

/** What an answer cache keeps a run by: the program's text, and the data sources it reads. */
export interface KeptRequest {
    /** The program's canonical text: what its answer is kept by. */
    readonly prefix: string;
    /** The data sources it reads, by name: a newer hash of any of them misses. */
    readonly reads: readonly string[];
}

/** What a kept run gave: its answer, and the hash of each data source it read. */
export interface KeptResult<V> {
    /** The answer. */
    readonly value: V;
    /** Each data source read, by name, with the hash the run read. */
    readonly hashes: ReadonlyMap<string, string>;
}

/**
 * The hash of each data source a run read, by its name in the root: what its
 * answer is kept by ({@link KeptResult}).
 *
 * @param result - what the run answered
 * @returns each data source's hash, by name; none when nothing ran
 */
export function readHashes(result: QueryResult): ReadonlyMap<string, string> {
    return new Map(result.inputs.map(input => [input.name, input.hash]));
}

/**
 * The hashes an answer is kept by: each data source the run read, by the hash
 * it read; and each it reads that the run named no hash for — a run that ended
 * before it read, with the checker's problems or a refusal — by the hash its
 * asker saw, so the answer stands until that source moves.
 *
 * @param request - the request: the data sources it reads
 * @param asked - each data source's hash as the asker saw it
 * @param read - each data source's hash as the run read it
 * @returns the hashes to keep the answer by
 */
function keptHashes(request: KeptRequest, asked: ReadonlyMap<string, string>, read: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
    const kept = new Map(read);
    for (const source of request.reads) {
        const hash = asked.get(source);
        if (hash !== undefined && !kept.has(source)) kept.set(source, hash);
    }
    return kept;
}

/** A run in flight: its answer, how to give it up, and how many still wait for it. */
interface InFlight<V> {
    readonly answer: Promise<V | undefined>;
    readonly controller: AbortController;
    waiting: number;
}

/**
 * Answers kept by their program and the hashes of the data sources they read
 * (#934, #1670): the query builder's summaries, and a Studio page's tiles.
 * One run per program and hashes, however many ask for it while it is in
 * flight; given up once every one that asked has stopped waiting.
 *
 * @example
 * ```ts
 * const answers = new AnswerCache((request, signal) => askOnE3(request.prefix, signal));
 * const kept = answers.get(request, hashes) ?? await answers.ensure(request, hashes, tile.signal);
 * ```
 */
export class AnswerCache<R extends KeptRequest, V> {
    private readonly entries = new Map<string, KeptResult<V>>();
    private readonly pending = new Map<string, InFlight<V>>();

    /**
     * @param run - runs a request's program; given up by its signal, it answers `undefined`
     */
    constructor(private readonly run: (request: R, signal: AbortSignal) => Promise<KeptResult<V> | undefined>) {}

    /**
     * The answer to a request, when the cache holds it for the data sources as they are.
     *
     * @param request - the request
     * @param hashes - each data source's current hash, by name; a source not listed is taken as unchanged
     * @returns the answer, or `undefined` when it has not been run, or a source it read has changed since
     */
    get(request: R, hashes: ReadonlyMap<string, string>): V | undefined {
        const entry = this.entries.get(request.prefix);
        if (entry === undefined) return undefined;
        for (const source of request.reads) {
            const now = hashes.get(source);
            if (now !== undefined && entry.hashes.get(source) !== now) return undefined;
        }
        return entry.value;
    }

    /**
     * Runs a request's program unless the cache holds its answer: once per
     * program and hashes, however often it is asked for while the run is in
     * flight. The answer is kept by the hashes the run read, and a source the
     * run named none for by the hash in `hashes` — so an answer that ended
     * before reading, a problem, stands until that source moves.
     *
     * @param request - the request
     * @param hashes - each data source's current hash, by name
     * @param signal - this asker stops waiting; once every asker has, the run is given up
     * @returns the answer, or `undefined` when the run was given up, or gave none; it rejects as a run that failed rejects
     */
    ensure(request: R, hashes: ReadonlyMap<string, string>, signal?: AbortSignal): Promise<V | undefined> {
        const held = this.get(request, hashes);
        if (held !== undefined) return Promise.resolve(held);
        if (signal?.aborted === true) return Promise.resolve(undefined);
        const key = `${request.prefix}\u0000${request.reads.map(s => hashes.get(s) ?? "").join("\u0000")}`;
        let inFlight = this.pending.get(key);
        if (inFlight === undefined) {
            const controller = new AbortController();
            const answer = this.run(request, controller.signal).then(result => {
                if (this.pending.get(key) === inFlight) this.pending.delete(key);
                if (result === undefined) return undefined;
                this.entries.set(request.prefix, { value: result.value, hashes: keptHashes(request, hashes, result.hashes) });
                return result.value;
            }, (err: unknown) => {
                // A run that failed keeps nothing: its askers hear why, and the next ask runs again.
                if (this.pending.get(key) === inFlight) this.pending.delete(key);
                throw err;
            });
            inFlight = { answer, controller, waiting: 0 };
            this.pending.set(key, inFlight);
        }
        const run = inFlight;
        run.waiting += 1;
        signal?.addEventListener("abort", () => {
            run.waiting -= 1;
            // The last asker gone: the run is given up, and the next ask starts another.
            if (run.waiting === 0 && this.pending.get(key) === run) {
                this.pending.delete(key);
                run.controller.abort();
            }
        }, { once: true });
        return run.answer;
    }
}

/**
 * The summaries a builder has fetched, while it is mounted: one per prefix,
 * kept with the hashes of the data sources the run read, so a newer dataset
 * misses ({@link AnswerCache}).
 *
 * @example
 * ```ts
 * const cache = new SummaryCache(request => runOneShot(request.program, SUMMARY_LIMITS));
 * const request = summaryAt(query, 2, root);
 * if (request !== undefined && summaryNeeded("value")) await cache.ensure(request, hashes);
 * const summary = request === undefined ? undefined : cache.get(request, hashes);
 * ```
 */
export class SummaryCache extends AnswerCache<SummaryRequest, Summary> {
    /**
     * @param run - runs a summary's program
     */
    constructor(run: SummaryRun) {
        super(async (request) => {
            try {
                const result = await run(request);
                return result === undefined ? undefined : { value: result.summary, hashes: result.hashes };
            } catch {
                // A summary that fails leaves the slot's offers without values.
                return undefined;
            }
        });
    }
}
