/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A run's plan in words (#941): its path and why, both paths' estimates, a
 * split's stages, its pieces and how its units ran, the reads that prune —
 * and the read-out beside a run.
 *
 * @packageDocumentation
 */

import type { JqRange, JqTotal } from "@elaraai/east";
import type { SplitCallProgress, SplitCallReport } from "@elaraai/e3-types";
import type { PlanExplanation, QueryPlan } from "../plan.js";
import { byteWords, durationWords, type QueryWords } from "./words.js";

/** A line of a plan's explanation: a sentence, and the jq it is about. */
export interface PlanLine {
    /**
     * What it says: the path and why; both paths' estimates and what they
     * assumed (#1143); a re-key and its stage (#942); what each piece runs,
     * what it reads cut at the same keys (#942), how the pieces combine, a
     * total, what runs once; what every piece reads whole; the pieces; how the
     * call's units ran, once it answered (#1105); a read that prunes.
     */
    readonly kind: "path" | "estimate" | "rekey" | "piece" | "copartitioned" | "combine" | "total" | "then" | "broadcast" | "pieces" | "units" | "pruning";
    /** Its sentence: one that ends with a colon has its jq after it. */
    readonly text: string;
    /** The jq it is about, as the query writes it; `undefined` when it is about none. */
    readonly code: string | undefined;
}

/** What a run knows of its plan as it goes: a split call's progress, how many pieces it cut, and how its units ran. */
export interface PlanRun {
    /** A split call's progress, while it goes. */
    readonly progress?: SplitCallProgress | undefined;
    /** How many pieces it cut, once e3 says. */
    readonly pieces?: number | undefined;
    /** How a split call ran, once it answered (#1105): the units it ran, and those the cache served. */
    readonly report?: SplitCallReport | undefined;
}

/**
 * How a split call's units ran, in words, once it answered (#1105) — `The
 * cache served 11 of its 14 units, and 3 ran.`; a call the cache served whole
 * consulted no unit, and says so.
 *
 * @param report - how it ran, as e3 reports it
 * @param words - the words
 * @returns the words
 */
export function planUnitsWords(report: SplitCallReport, words: QueryWords): string {
    const f = words.formatters;
    const ran = Number(report.ran);
    const cached = Number(report.cached);
    const units = ran + cached;
    const kind = units === 0 ? "whole" : cached > 0 ? "some" : "none";
    return words.messages.planUnits({ kind, cached: f.number(cached), ran: f.number(ran), units: f.number(units), n: units });
}

/**
 * How far a split run has got, in words — `3 of 12 pieces done`, `1 of 1
 * merges done`.
 *
 * @param progress - its progress, as e3 reports it
 * @param words - the words
 * @returns the words
 */
export function planProgressWords(progress: SplitCallProgress, words: QueryWords): string {
    const f = words.formatters;
    const units = Number(progress.units);
    return words.messages.planProgress({ phase: progress.phase.type, done: f.number(Number(progress.done)), units: f.number(units), n: units });
}

/**
 * A plan's explanation in words: one line per sentence, each with the jq it
 * is about.
 *
 * @param explanation - the plan's explanation (`plan.ts`)
 * @param words - the words
 * @param run - what the run knows of its plan: a split call's progress while
 *   it goes, how many pieces it cut once e3 says, and how its units ran once
 *   it answered
 * @returns the lines, in order
 *
 * @remarks
 * - **The path**, first: a split call over a dataset, estimated faster than
 *   one call or one call holding more memory than it may use (#1143), or the
 *   one a run went on as when its one call's answer was too large for one
 *   (#1113), or, its rows not known, what it weighs, more than one piece — or what the
 *   heaviest dataset cut with it weighs; or one call — estimated faster,
 *   within one piece, a weight not known, a split call that could not be
 *   made, or the reason the query runs as one unit, with the jq the reason is
 *   about.
 * - **The estimates** beside it, when the path was chosen by them (#1143):
 *   one call's time and what it holds, and the memory it may use; the split
 *   call's time, its pieces and how many run at once, and what each holds;
 *   and what they assumed — the rows, those a stream's first rows stop both
 *   paths after, what each costs in one call and in a piece, and what one call
 *   holding every row holds of each. A re-keyed
 *   join says so next, and its re-key stage with the join key and what the
 *   re-keyed rows are estimated to weigh (#942).
 * - **A split's stages**: what each piece runs; the data sources cut at the
 *   same keys with it (#942); how their outputs combine — rows joined;
 *   totals, each by its rule; grouped by a key, each group's totals combined
 *   or its rows collected; the distinct rows; the first row of each key; a
 *   reduce's updates by key, added or the last kept; the first rows of a sort
 *   (#942); what runs once after them; the data sources every piece reads
 *   whole; and the pieces — how far the run has got while it goes, then how
 *   many and about what each weighs, and how the call's units ran: how many
 *   the cache served, or that it served the whole call (#1105).
 * - **The reads that prune**, last: a count from a dataset's index, a key
 *   seek, a stream that stops.
 */
export function planWords(explanation: PlanExplanation, words: QueryWords, run: PlanRun = {}): PlanLine[] {
    const m = words.messages;
    const f = words.formatters;
    const jq = (range: JqRange | null): string | undefined => (range === null ? undefined : explanation.program.slice(range.from, range.to));
    const lines: PlanLine[] = [];
    const say = (kind: PlanLine["kind"], text: string, code?: string): void => {
        lines.push({ kind, text, code });
    };
    const totals = (list: readonly { readonly range: JqRange; readonly rule: JqTotal["rule"] }[]): void => {
        for (const total of list) say("total", m.planTotal({ rule: total.rule }), jq(total.range));
    };
    // Both paths' estimates and what they assumed, beside the path (#1143).
    const estimated = (): void => {
        const e = explanation.estimates;
        if (e === null) return;
        const memory = e.memoryBytes === null ? undefined : byteWords(e.memoryBytes, words);
        say("estimate", m.planEstimateOneCall({
            seconds: durationWords(e.oneCall.seconds, words), peak: byteWords(e.oneCall.peakBytes, words, 2), memory,
            over: e.memoryBytes !== null && e.oneCall.peakBytes > e.memoryBytes,
        }));
        say("estimate", m.planEstimateSplit({
            rekey: e.kind === "rekey", seconds: durationWords(e.split.seconds, words), pieces: f.number(e.pieces), n: e.pieces, cores: f.number(e.cores),
            peak: byteWords(e.split.peakBytes, words, 2),
        }));
        say("estimate", m.planAssumed({
            rows: f.number(e.rows), n: e.rows, over: e.over, first: e.firstRows === null ? undefined : { count: f.number(e.firstRows), n: e.firstRows },
            oneCall: f.number(e.row.oneCallUs), piece: f.number(e.row.pieceUs),
            held: e.holdsRows ? byteWords(e.row.heldBytes, words) : undefined,
        }));
    };
    const path = explanation.path;
    if (path.kind === "one_shot") {
        const why = path.why;
        switch (why.kind) {
            case "whole":
                say("path", m.planWhole({ code: why.reason.code, name: why.reason.name ?? undefined, at: why.reason.range !== null }), jq(why.reason.range));
                break;
            case "small":
                say("path", m.planSmall({ over: why.over, bytes: byteWords(why.bytes, words), piece: byteWords(why.pieceBytes, words) }));
                break;
            case "unweighed":
                say("path", m.planUnweighed({ over: why.over }));
                break;
            case "unsplit":
                say("path", m.planUnsplit({ message: why.message }));
                break;
            case "faster":
                say("path", m.planFaster({ over: why.over }));
                break;
        }
        estimated();
    } else {
        say("path", path.why === "weight"
            ? m.planSplit({ over: path.over, heaviest: path.heaviest, bytes: byteWords(path.bytes, words), piece: byteWords(path.pieceBytes, words) })
            : m.planSplitBy({ over: path.over, why: path.why }));
        estimated();
        if (path.rekey !== null) {
            say("rekey", m.planRekey({ name: path.rekey.name }));
            say("rekey", m.planRekeyStage({ over: path.over, name: path.rekey.name, bytes: byteWords(path.rekey.bytes, words) }), jq(path.rekey.key));
        }
        say("piece", m.planPiece({ over: path.over }), jq(path.stages.piece));
        if (path.copartitioned.length > 0) {
            say("copartitioned", m.planCopartitioned({ over: path.over, names: m.list({ items: path.copartitioned }), n: path.copartitioned.length }));
        }
        const combine = path.stages.combine;
        switch (combine.kind) {
            case "concat":
                say("combine", m.planCombine({ kind: "concat" }));
                break;
            case "totals":
                say("combine", m.planCombine({ kind: "totals" }));
                totals(combine.totals);
                break;
            case "group":
                say("combine", m.planCombine({ kind: "group" }), jq(combine.key));
                if (combine.totals === null) {
                    say("combine", m.planCombine({ kind: "groupRows" }));
                } else {
                    say("combine", m.planCombine({ kind: "groupTotals" }));
                    totals(combine.totals);
                }
                break;
            case "distinct":
                say("combine", m.planCombine({ kind: "distinct" }), jq(combine.range));
                break;
            case "distinct_by":
                say("combine", m.planCombine({ kind: "distinctBy" }), jq(combine.key));
                break;
            case "reduce":
                say("combine", m.planCombine({ kind: combine.update === "add" ? "reduceAdd" : "reduceReplace" }), jq(combine.key));
                break;
            case "top":
                // By the key `sort_by` sorts by, or for `sort` by the rows themselves: the sort and the step that keeps its first rows.
                say("combine", m.planTop({ count: f.number(combine.rows), n: combine.rows }), jq(combine.key ?? combine.range));
                break;
            case "first":
                // The `first` or `limit` that keeps them (#1113).
                say("combine", m.planFirst({ count: f.number(combine.rows), n: combine.rows }), jq(combine.range));
                break;
        }
        if (path.stages.then !== null) say("then", m.planThen(), jq(path.stages.then));
        if (path.broadcast.length > 0) say("broadcast", m.planBroadcast({ names: m.list({ items: path.broadcast }) }));
        if (run.progress !== undefined) {
            say("pieces", planProgressWords(run.progress, words));
        } else if (run.pieces !== undefined && run.pieces > 0) {
            say("pieces", m.planPieces({ over: path.over, count: f.number(run.pieces), n: run.pieces, size: byteWords(Math.round(path.bytes / run.pieces), words) }));
        }
        if (run.progress === undefined && run.report !== undefined) say("units", planUnitsWords(run.report, words));
    }
    for (const read of explanation.pruning) say("pruning", m.planPruning({ kind: read.kind, name: read.name }), jq(read.range));
    return lines;
}

/**
 * A plan's read-out, beside a run's: `One call`; `Split call`, with how far it
 * has got while it goes — `Split call · 3 of 12 pieces done` — and how many
 * pieces it cut once e3 says — `Split call · 12 pieces`; and a re-keyed join's
 * two calls the same way — `Re-keyed join · 12 pieces`, the join call's
 * pieces (#942). Once the call answered, the units the cache served follow —
 * `Split call · 12 pieces · 11 units cached`, `Split call · 12 pieces · all
 * cached` for a call it served whole (#1105).
 *
 * @param planned - the run's plan
 * @param words - the words
 * @param run - what the run knows of its plan
 * @returns the read-out
 */
export function planBadge(planned: QueryPlan, words: QueryWords, run: PlanRun = {}): string {
    const m = words.messages;
    if (planned.kind === "one_shot") return m.planBadge({ kind: "one_shot", detail: "" });
    if (run.progress !== undefined) return m.planBadge({ kind: planned.kind, detail: planProgressWords(run.progress, words) });
    const parts: string[] = [];
    if (run.pieces !== undefined) parts.push(m.planPieceCount({ count: words.formatters.number(run.pieces), n: run.pieces }));
    // The units the cache served: none said, and a call it served whole, which consulted none, said so (#1105).
    const cached = run.report === undefined ? 0 : Number(run.report.cached);
    const whole = run.report !== undefined && Number(run.report.ran) + cached === 0;
    if (cached > 0 || whole) parts.push(m.planCachedCount({ count: words.formatters.number(cached), n: cached, whole }));
    return m.planBadge({ kind: planned.kind, detail: parts.join(" · ") });
}
