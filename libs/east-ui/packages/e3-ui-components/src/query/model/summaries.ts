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
import { NOW_FIELD, minuteKey, type QueryResult } from "../one-shot.js";
import type { StepField } from "../steps/fields.js";
import { SEP, layOutSteps, queryReadsNow } from "../steps/print.js";
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
    /** The data sources it reads, by name: the source, and each Look up's — and `now` when a condition reads the minute (#1670), whose hash is the minute. */
    readonly reads: readonly string[];
}

/**
 * The summary of the rows a step takes. Rows narrowed by "is in the last" are
 * the minute's: the request reads `now`, so a summary is kept for the minute
 * its asker gives under `now` in its hashes.
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
        reads: [query.source, ...new Set(lookups), ...(queryReadsNow(prefix) ? [NOW_FIELD] : [])],
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
 * An asker's hashes with the minute it asks for under `now` (#1670): what an
 * answer that read `.now` is kept by beside its data sources, so it stands for
 * that minute and the next one asks again.
 *
 * @param hashes - each data source's hash, by name
 * @param at - the instant asked for: its minute is kept
 * @returns the hashes, and the minute's under {@link NOW_FIELD}
 */
export function withMinute(hashes: ReadonlyMap<string, string>, at: Date): ReadonlyMap<string, string> {
    return new Map([...hashes, [NOW_FIELD, minuteKey(at)]]);
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

/** A run in flight: its answer, how to give it up, how many still wait for it, and what its askers knew. */
interface InFlight<V> {
    answer: Promise<V | undefined>;
    readonly controller: AbortController;
    waiting: number;
    /** Each data source it reads whose hash one of its askers knew, by that hash. */
    readonly asked: Map<string, string>;
}

/**
 * Whether a run in flight serves an asker: for each data source it reads, the
 * run's askers knew no hash of it, the asker knows none, or both know the same
 * one. A tile that asked before the page's poll first read its source's hash
 * is served by the run it started once it knows that hash, rather than asking
 * again.
 *
 * @param run - the run in flight
 * @param request - the request: the data sources it reads
 * @param hashes - each data source's hash as the asker sees it
 * @returns whether the run's answer is the asker's
 */
function serves(run: InFlight<unknown>, request: KeptRequest, hashes: ReadonlyMap<string, string>): boolean {
    return request.reads.every((source) => {
        const was = run.asked.get(source);
        const now = hashes.get(source);
        return was === undefined || now === undefined || was === now;
    });
}

/**
 * Answers kept by their program and the hashes of the data sources they read
 * (#934, #1670): the query builder's summaries, and a Studio page's tiles.
 * One run per program and hashes, however many ask for it while it is in
 * flight — an asker who has come to know a hash the run's askers did not
 * know is served by it too; given up once every one that asked has stopped
 * waiting, and none has asked again in the same turn — a page drawn again
 * re-asks at once, and keeps its runs.
 *
 * @example
 * ```ts
 * const answers = new AnswerCache((request, signal) => askOnE3(request.prefix, signal));
 * const kept = answers.get(request, hashes) ?? await answers.ensure(request, hashes, tile.signal);
 * ```
 */
export class AnswerCache<R extends KeptRequest, V> {
    private readonly entries = new Map<string, KeptResult<V>>();
    /** The runs in flight, by program: more than one where their askers knew different hashes. */
    private readonly pending = new Map<string, readonly InFlight<V>[]>();

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
     * flight ({@link serves}). The answer is kept by the hashes the run read,
     * and a source the run named none for by the hash its askers knew — so an
     * answer that ended before reading, a problem, stands until that source
     * moves.
     *
     * @param request - the request
     * @param hashes - each data source's current hash, by name
     * @param signal - this asker stops waiting; once every asker has, and none asks again in the same turn, the run is given up
     * @returns the answer, or `undefined` when the run was given up, or gave none; it rejects as a run that failed rejects
     */
    ensure(request: R, hashes: ReadonlyMap<string, string>, signal?: AbortSignal): Promise<V | undefined> {
        const held = this.get(request, hashes);
        if (held !== undefined) return Promise.resolve(held);
        if (signal?.aborted === true) return Promise.resolve(undefined);
        const runs = this.pending.get(request.prefix) ?? [];
        let run = runs.find((inFlight) => serves(inFlight, request, hashes));
        if (run === undefined) {
            const made: InFlight<V> = { answer: Promise.resolve(undefined), controller: new AbortController(), waiting: 0, asked: new Map() };
            made.answer = this.run(request, made.controller.signal).then(result => {
                this.drop(request.prefix, made);
                if (result === undefined) return undefined;
                this.entries.set(request.prefix, { value: result.value, hashes: keptHashes(request, made.asked, result.hashes) });
                return result.value;
            }, (err: unknown) => {
                // A run that failed keeps nothing: its askers hear why, and the next ask runs again.
                this.drop(request.prefix, made);
                throw err;
            });
            this.pending.set(request.prefix, [...runs, made]);
            run = made;
        }
        // What this asker knows of the sources it reads, the run keeps: its answer is kept by it where the run reads none.
        for (const source of request.reads) {
            const hash = hashes.get(source);
            if (hash !== undefined) run.asked.set(source, hash);
        }
        const waited = run;
        waited.waiting += 1;
        signal?.addEventListener("abort", () => {
            waited.waiting -= 1;
            if (waited.waiting > 0) return;
            // The last asker gone: the run is given up, and the next ask starts another — unless an asker
            // asks for it again in the same turn, as a page drawn again stops its effects and starts them
            // at once, which keeps it running.
            queueMicrotask(() => {
                if (waited.waiting === 0 && this.pending.get(request.prefix)?.includes(waited) === true) {
                    this.drop(request.prefix, waited);
                    waited.controller.abort();
                }
            });
        }, { once: true });
        return waited.answer;
    }

    /** Forgets a run that is no longer in flight: it settled, or was given up. */
    private drop(prefix: string, run: InFlight<V>): void {
        const left = (this.pending.get(prefix) ?? []).filter((inFlight) => inFlight !== run);
        if (left.length === 0) this.pending.delete(prefix);
        else this.pending.set(prefix, left);
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
