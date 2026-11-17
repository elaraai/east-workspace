/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A draft's run (#1670): a query checked and split (`plan.ts`'s
 * `draftPlan`), then weighed, planned and called on e3 — one call, a split
 * call over a large dataset's pieces, or a re-keyed join's two — exactly as
 * the query builder runs a query (`run.ts`), and as a Studio tile asks its
 * program. The builder's run and a tile's ask are each a caller of it: what
 * they draw, and what they tell, is theirs.
 *
 * It imports neither React nor the renderers, so the query's calls entry
 * (`@elaraai/e3-ui-components/query`) carries it to a host in Node.
 *
 * @packageDocumentation
 */

import { ApiError, AuthError, type RemoteCollection } from "@elaraai/e3-api-client";
import type { ExecuteResult, SplitCallProgress, SplitCallReport, SplitCallRequest } from "@elaraai/e3-types";
import { messageOf } from "../shared/message.js";
import type { QueryCall, QueryCollection, QuerySourceStatus, QuerySplitCall } from "./hooks.js";
import type { QueryReading, QueryResult, QueryRoot } from "./one-shot.js";
import { weighPlan, type PlanDraft, type QueryPlan, type SourceWeight } from "./plan.js";

/**
 * What a draft's run reaches e3 through. Each is `undefined` where there is
 * none: a call it needs and lacks fails the run as unreachable; a status not
 * read leaves its dataset unweighed; an output not opened leaves an answer
 * too large.
 */
export interface DraftRunSeams {
    /** How a one-shot call is made. */
    readonly call: QueryCall | undefined;
    /** How a split call is made. */
    readonly split: QuerySplitCall | undefined;
    /** How a split call's output is opened, when its answer was too large for one (#1113). */
    readonly collection: QueryCollection | undefined;
    /** How a data source's status is read: what it weighs, and how many rows it holds. */
    readonly status: QuerySourceStatus | undefined;
}

/** What a draft's run is told as it goes, and the data source whose stored rows it weighs besides. */
export interface DraftRunEvents {
    /** A data source to weigh besides those that decide the path: the one whose stored rows a split visual run counts. */
    readonly source?: string | undefined;
    /** The plan the run calls by: told once it is weighed, and again when a one call's answer too large for one goes on as a split call. */
    readonly onPlanned?: (planned: QueryPlan) => void;
    /** A split call's progress as e3 reports it, and how many pieces it cut, once e3 says. */
    readonly onProgress?: (progress: SplitCallProgress, pieces: number | undefined) => void;
}

/** How a draft's run ended ({@link runDraft}). */
export type DraftRun =
    /** Given up by its signal: nothing to read. */
    | { readonly kind: "abandoned" }
    /** The weighed plan refused it: a one-shot program that does not check, its `error` result. */
    | { readonly kind: "refused"; readonly result: QueryResult }
    /** A call that never answered, or a plan that could not be made: unreachable, or refused by the server; and the plan, when there was one. */
    | { readonly kind: "failed"; readonly reason: "unreachable" | "refused"; readonly message: string; readonly planned: QueryPlan | undefined }
    /**
     * A call answered: the plan it was made by — one call, a split call or a
     * re-keyed join's two — what reading its answer needs, the answer, and
     * what the datasets weighed; and for a split call, its output opened when
     * its answer was too large for one and no final step made it, how many
     * pieces it cut when e3 said, its report, and the call those pieces are of.
     */
    | {
        readonly kind: "answered"; readonly planned: QueryPlan; readonly reading: QueryReading; readonly answer: ExecuteResult;
        readonly weights: ReadonlyMap<string, SourceWeight>; readonly opened: RemoteCollection | undefined;
        readonly pieces: number | undefined; readonly report: SplitCallReport | undefined; readonly counted: SplitCallRequest | undefined;
    };

/** An error's message, as a draft's run and its callers say it: the package's one copy (`shared/message.ts`). */
export { messageOf };

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
 * What the datasets a run plans over weigh, by name: those whose weights
 * decide its path — the one a split call would cut, those cut at the same keys
 * with it, and a join's other side (#942) — and the source whose stored rows a
 * split visual run counts. A status that cannot be read leaves its dataset's
 * weight unknown.
 */
async function weigh(draft: PlanDraft, source: string | undefined, root: QueryRoot, status: QuerySourceStatus | undefined): Promise<ReadonlyMap<string, SourceWeight>> {
    const weights = new Map<string, SourceWeight>();
    if (status === undefined || draft.weighs.length === 0) return weights;
    const names = [...new Set([...draft.weighs, ...(source === undefined ? [] : [source])])];
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
 * The split call a run goes on as when its one call, which the estimates
 * chose, answered too large for one answer (#1113): one with no final step,
 * whose output is read a page at a time.
 *
 * @param planned - the run's one call
 * @param draft - its query, checked and split
 * @param weights - what its datasets weigh
 * @returns the split call; `undefined` when the estimates did not choose the
 *   one call, or the run has no such split call to make — it does not split,
 *   or its split has a final step, which answers inline as one call does
 */
function pagedInstead(
    planned: Extract<QueryPlan, { kind: "one_shot" }>, draft: PlanDraft, weights: ReadonlyMap<string, SourceWeight>,
): Extract<QueryPlan, { kind: "split" }> | undefined {
    const path = planned.explanation.path;
    if (path.kind !== "one_shot" || path.why.kind !== "faster") return undefined;
    try {
        const again = weighPlan(draft, weights, { tooLarge: true });
        return "plan" in again && again.plan.kind === "split" && again.plan.request.then.type === "none" ? again.plan : undefined;
    } catch {
        // A split program the translator cannot express: the one call's answer stands.
        return undefined;
    }
}

/**
 * Runs a draft: weighs the datasets whose weights decide its path, plans its
 * call by them, and makes it — one call, or a split call, or a re-keyed
 * join's two — as the query builder runs a query and a Studio tile asks its
 * program.
 *
 * @param draft - the query, checked and split (`draftPlan`)
 * @param seams - how a one-shot call, a split call, an output's opening and a data source's status are made
 * @param signal - gives the run up: its one call is asked to stop, its split call's job is cancelled, and nothing more is asked
 * @param events - what the run is told as it goes, and a source to weigh besides
 * @returns how it ended
 *
 * @remarks
 * - **Weighing**: a dataset whose status cannot be read is not weighed, and
 *   the plan says its weight is not known.
 * - **One call** is a run's (`QueryCall`'s `run`), kept by e3 as a call of the
 *   workspace, so it runs as long as its limits allow. Its answer too large for
 *   one, when the estimates chose it and its split call has no final step,
 *   goes on as that split call, whose output is read a page at a time (#1113).
 * - **A split call** tells its progress as it goes; a re-keyed join's join
 *   call runs over the re-key call's output, by its hash (#942). An answer too
 *   large for one, which no final step made — the assembled output itself — has
 *   its output opened; one that cannot be opened stays too large.
 * - **Failing**: an `ApiError` or an `AuthError`, and from a split call
 *   anything but the `TypeError` `fetch` rejects with, is the server's
 *   refusal; else the server could not be reached. A seam the plan needs and
 *   lacks is unreachable.
 * - **Given up**: once the signal aborts, the run ends `abandoned` at its next step.
 *
 * @example
 * ```ts
 * const drafted = draftPlan(".orders | group_by(.region) | map({region: .[0].region, n: length})", root);
 * if ("result" in drafted) return drafted.result;                 // the checker's problems
 * const ran = await runDraft(drafted.draft, { call, split, collection, status }, controller.signal);
 * if (ran.kind === "answered") return queryResultOf(ran.reading, ran.answer);
 * ```
 */
export async function runDraft(draft: PlanDraft, seams: DraftRunSeams, signal: AbortSignal, events: DraftRunEvents = {}): Promise<DraftRun> {
    const { call, split, collection, status } = seams;
    const weights = await weigh(draft, events.source, draft.root, status);
    if (signal.aborted) return { kind: "abandoned" };
    let planned: QueryPlan;
    try {
        const weighed = weighPlan(draft, weights);
        if ("result" in weighed) return { kind: "refused", result: weighed.result };
        planned = weighed.plan;
    } catch (err) {
        return { kind: "failed", reason: "refused", message: messageOf(err), planned: undefined };
    }
    events.onPlanned?.(planned);

    if (planned.kind === "one_shot") {
        if (call === undefined) return { kind: "failed", reason: "unreachable", message: "", planned };
        let answer: ExecuteResult;
        try {
            // Started as a call of the workspace, held to no request's deadline, and stopped once the run is given up
            answer = await call(planned.prepared.request, { run: true, signal });
        } catch (err) {
            if (signal.aborted) return { kind: "abandoned" };
            return { kind: "failed", reason: refusedBy(err, false) ? "refused" : "unreachable", message: messageOf(err), planned };
        }
        if (signal.aborted) return { kind: "abandoned" };
        // Too large for one answer, a one call's result is never read a page at a time, and a split call's output is.
        const instead = answer.outcome.type === "too_large" && split !== undefined && collection !== undefined
            ? pagedInstead(planned, draft, weights) : undefined;
        if (instead === undefined) {
            return { kind: "answered", planned, reading: planned.prepared, answer, weights, opened: undefined, pieces: undefined, report: undefined, counted: undefined };
        }
        planned = instead;
        events.onPlanned?.(planned);
    }

    if (split === undefined) return { kind: "failed", reason: "unreachable", message: "", planned };
    let pieces: number | undefined;
    // The call whose pieces the read-out names: the split call, or a re-keyed join's join call.
    let counted: SplitCallRequest | undefined;
    // How it ran, when it reports so (#1105), and its assembled output's hash.
    let report: SplitCallReport | undefined;
    let output: string | null = null;
    /** A split call, its progress told as it goes. */
    const send = (request: SplitCallRequest) => split(request, {
        signal,
        onProgress: (progress) => {
            if (signal.aborted) return;
            if (progress.phase.type === "partition") pieces = Number(progress.units);
            events.onProgress?.(progress, pieces);
        },
    });
    let answer: ExecuteResult;
    try {
        if (planned.kind === "split") {
            counted = planned.request;
            const done = await send(counted);
            ({ result: answer, output } = done);
            report = done.report ?? undefined;
        } else {
            // A re-keyed join (#942): the re-key call, then the join call over its output, by its hash.
            const first = await send(planned.first);
            if (signal.aborted) return { kind: "abandoned" };
            pieces = undefined;
            if (first.output === null) {
                answer = planned.answer(first.result, undefined);
            } else {
                counted = planned.join(first.output);
                const joined = await send(counted);
                answer = planned.answer(first.result, joined.result);
                output = joined.output;
                report = joined.report ?? undefined;
            }
        }
    } catch (err) {
        if (signal.aborted) return { kind: "abandoned" };
        return { kind: "failed", reason: refusedBy(err, true) ? "refused" : "unreachable", message: messageOf(err), planned };
    }
    if (signal.aborted) return { kind: "abandoned" };
    // The pieces its report says it cut: which a call that never said them as it went says once it answered (#1105).
    if (report !== undefined) pieces = Number(report.pieces);
    // An answer too large for one, which no final step made — the assembled output itself — is opened, to be read a page at a time (#1113).
    let opened: RemoteCollection | undefined;
    if (answer.outcome.type === "too_large" && counted?.then.type === "none" && output !== null && collection !== undefined) {
        try {
            opened = await collection(output);
        } catch {
            // Not opened: the answer stays too large.
        }
        if (signal.aborted) return { kind: "abandoned" };
    }
    return { kind: "answered", planned, reading: planned.reading, answer, weights, opened, pieces, report, counted };
}
