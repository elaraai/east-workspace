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

/**
 * The summaries a builder has fetched, while it is mounted: one per prefix,
 * kept with the hashes of the data sources the run read, so a newer dataset
 * misses.
 *
 * @example
 * ```ts
 * const cache = new SummaryCache(request => runOneShot(request.program, SUMMARY_LIMITS));
 * const request = summaryAt(query, 2, root);
 * if (request !== undefined && summaryNeeded("value")) await cache.ensure(request, hashes);
 * const summary = request === undefined ? undefined : cache.get(request, hashes);
 * ```
 */
export class SummaryCache {
    private readonly entries = new Map<string, SummaryResult>();
    private readonly pending = new Map<string, Promise<Summary | undefined>>();

    /**
     * @param run - runs a summary's program
     */
    constructor(private readonly run: SummaryRun) {}

    /**
     * The summary of a request, when the cache holds it for the data sources as they are.
     *
     * @param request - the request
     * @param hashes - each data source's current hash, by name; a source not listed is taken as unchanged
     * @returns the summary, or `undefined` when it has not been fetched, or a source it read has changed since
     */
    get(request: SummaryRequest, hashes: ReadonlyMap<string, string>): Summary | undefined {
        const entry = this.entries.get(request.prefix);
        if (entry === undefined) return undefined;
        for (const source of request.reads) {
            const now = hashes.get(source);
            if (now !== undefined && entry.hashes.get(source) !== now) return undefined;
        }
        return entry.summary;
    }

    /**
     * Fetches a request's summary unless the cache holds it: once per prefix
     * and hashes, however often it is asked for while the run is in flight.
     *
     * @param request - the request
     * @param hashes - each data source's current hash, by name
     * @returns the summary, or `undefined` when the run failed
     */
    ensure(request: SummaryRequest, hashes: ReadonlyMap<string, string>): Promise<Summary | undefined> {
        const held = this.get(request, hashes);
        if (held !== undefined) return Promise.resolve(held);
        const key = `${request.prefix}\u0000${request.reads.map(s => hashes.get(s) ?? "").join("\u0000")}`;
        const inFlight = this.pending.get(key);
        if (inFlight !== undefined) return inFlight;
        const fetched = this.run(request).then(result => {
            this.pending.delete(key);
            if (result === undefined) return undefined;
            this.entries.set(request.prefix, result);
            return result.summary;
        }, () => {
            this.pending.delete(key);
            return undefined;
        });
        this.pending.set(key, fetched);
        return fetched;
    }
}
