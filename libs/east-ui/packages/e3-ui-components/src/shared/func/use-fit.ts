/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An app's fit, as a builder asks it (`Allocation Spec.md` §12.2, F1–F4, and
 * §13; east-workspace#1624): the app's `e3.function`, called by name through
 * the shared `Func` runtime (`useFuncCall`). A builder asks questions about
 * its drafts.
 *
 * **What an ask sends** (rules 1 and 10). The function's argument is the
 * question and the page's scope ({@link FitQuestions.request}), and no row.
 * After it go the pending Save of each of the builder's sessions over a record
 * the function lists in `drafts`, as a draft — every unsaved edit that is
 * complete, the ones a narrowing hides and the ones off screen among them,
 * whether or not a check holds Save ({@link OptimiseSessions.drafts}, the
 * sessions an optimiser's run asks) — and, for a question about a plan the
 * builder derives from its drafts, the derived change as one more draft
 * ({@link FitQuestions.further}), laid in order. e3 lays them over the
 * records, the function reads what it needs so, and nothing is saved.
 *
 * **What is kept** (rule 11). Each answer is kept by the context and the plan
 * it was asked of, then by question — its key, which the answer echoes, so an
 * answer lands only on the question it answers. The context is the builder's:
 * what the page itself reads, and its sessions' drafts, each by identity — a
 * new one, new answers. One question is in flight at a time; the others wait,
 * the latest asked first, and a question of a plan or a context the builder
 * has moved on from goes unasked. `ask` is the plan's and the context's: an
 * effect that asks, listing it, asks again when either changes. A failed call
 * keeps its question until it is asked again (`retry`). The builder computes
 * no fit of its own.
 *
 * **Edits that cannot be asked about.** While a session cannot hand its edits
 * over — a Save of its own on its way, its drafts being carried over to a
 * record that moved ({@link OptimiseSessions.standing}) — the question waits,
 * whatever drafts were handed over in its context before, and goes once the
 * sessions stand. Where the record refuses the pending Save (rule 9), the fit
 * has failed in its words — what the record said of the draft as e3 laid it,
 * as a refused Save says it: there is no state of the record with those edits
 * to ask about. Where it refuses only a derived plan's change (rule 10), that
 * question alone has failed, in the record's words ({@link FitAnswers.refused}),
 * and is not asked again until the plan or the context moves on — the record
 * would refuse it as it stands — while the drafts as they stand are still
 * asked about. A question whose own subject
 * is an edit not yet complete (rule 8) is not asked until it is
 * ({@link FitQuestions.complete}).
 *
 * **A record that changed under the edits** (rule 12). A call the source
 * refused because another write got there first takes the optimiser's path
 * (`conflict.ts`): the page reads the records again, the sessions carry their
 * edits over the newer saves, and with nothing to choose the question is asked
 * again by itself; with a conflict to choose the fit has failed in the refused
 * Save's words, until the person chooses — and once the sessions hold no
 * conflict it is asked again, whatever was chosen. A question goes again as many
 * times in a row as a refused Save is sent again, each question counting its
 * own.
 *
 * The Roster's Find fixes (#1334) and the Allocation's board
 * (`allocation/fit.ts`) ask through this.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { IntegerType, equalFor, type EastType } from "@elaraai/east";
import { OptimiseSliceType } from "@elaraai/e3-ui/internal";
import { useDataStable } from "@elaraai/east-ui-components";
import { draftRefusal, failedDraft } from "../../platform/index.js";
import type { SourcesChrome } from "../schedule/visibility.js";
import { afterConflict, readRecordsAgain } from "./conflict.js";
import { fitScope, type OptimiseSlice } from "./optimise-slice.js";
import { useFuncCall, type FuncCallBinding, type FuncCallDraft, type FuncCallError } from "./use-func-call.js";
import type { OptimiseSessions } from "./use-optimise.js";

/** How many questions wait at most: one older than these is no one's any more. */
const WAITING = 8;

const sameInteger = equalFor(IntegerType);
const sameScope = equalFor(OptimiseSliceType);

/**
 * The page's scope a builder's fit asks in ({@link fitScope}, rule 1), the same object while each source's scope holds:
 * the builder's questions are asked in it by identity, so a choice on the rail — never sent to a fit — asks nothing
 * again, and a new scope asks anew.
 *
 * @param chrome - The builder's rail, as its payload carries it; `undefined` for a builder with no rail
 * @returns Each source's scope, by the source's name
 */
export function useFitScope(chrome: SourcesChrome | undefined): OptimiseSlice {
    return useDataStable(fitScope(chrome), sameScope);
}

/**
 * What a record said of a derived plan's change it refused as e3 laid it (rule 10): a call's error where the draft
 * whose mutation failed, ending the call before the function ran, is that change.
 *
 * @param error - The call's error
 * @param place - The derived plan's change's place among the call's drafts, from 1: the last
 * @returns The record's words, else the call's own summary; `undefined` for a call that change did not end
 */
function derivedRefusal(error: FuncCallError, place: number): string | undefined {
    const failed = failedDraft(error);
    if (failed === undefined || !sameInteger(failed.place, BigInt(place))) return undefined;
    return draftRefusal(error) ?? error.message;
}

/**
 * What a builder's fit asks, and how.
 *
 * @typeParam Q - A question
 * @typeParam P - The plan a question is asked of: the builder's drafts as it reads them, or a plan it derives from them
 * @typeParam C - The context it is asked in
 * @typeParam R - An answer
 */
export interface FitQuestions<Q, P extends object, C extends object, R> {
    /** The app's function's name; `null` with none, and nothing is asked. */
    name: string | null;
    /** What the function lists in `drafts` and reads, as its binding names them: one that lists none is called with its request alone. */
    binding: FuncCallBinding;
    /** The builder's sessions over the records it edits: an ask takes its drafts from them as they stand. */
    sessions: OptimiseSessions;
    /** What the function takes. */
    requestType: EastType;
    /** What it answers. */
    resultType: EastType;
    /** A question's key: its East text. */
    key: (question: Q) => string;
    /** The key of the question an answer answers, from what it echoes. */
    answers: (result: R) => string;
    /** The function's argument for a question, in a context: the question and the page's scope, and no row (rule 1). */
    request: (question: Q, context: C) => unknown;
    /**
     * A plan the builder derives from its drafts, as one more draft laid after its sessions' (rule 10): the change from
     * the drafts to it, of a record the function lists in `drafts`.
     *
     * @param of - The derived plan
     * @param base - The drafts it was derived from
     * @returns The draft; `undefined` where the function lists no record the change is of — it reads none of it, and
     *   is asked of the drafts — or the two hold the same rows
     */
    further?: (of: P, base: P) => FuncCallDraft | undefined;
    /**
     * Whether a question's own subject is complete (rule 8): one whose edit has a field still missing is in no draft,
     * so the question is not asked until it is complete, and shows no verdict meanwhile. Every question's is, unless given.
     */
    complete?: (question: Q) => boolean;
}

/**
 * A builder's fit (see the module docs).
 *
 * @typeParam Q - A question
 * @typeParam P - A plan
 * @typeParam R - An answer
 */
export interface FitAnswers<Q, P, R> {
    /** The answer to a question about the plan as it stands, or about one derived from it, once it has landed (F1). */
    answer: (question: Q, of?: P) => R | undefined;
    /**
     * Asks a question of the plan as it stands, or of one derived from it: answered from what is kept, else sent once nothing is in
     * flight. A new plan or context is a new `ask`, so an effect that asks, listing it, asks again then (F1).
     */
    ask: (question: Q, of?: P) => void;
    /**
     * Why a question about a derived plan has no answer, and none is coming: its record refused the plan's change as e3
     * laid it (rule 10), in the record's words. That question alone has failed — the board's fit has not, and the drafts
     * as they stand are still asked about — until the plan or the context moves on, when it is asked anew; `undefined`
     * for any other question.
     */
    refused: (question: Q, of?: P) => string | undefined;
    /** Whether a question asked of the plan as it stands is unanswered (F2). */
    pending: boolean;
    /** Why the last call failed, or why the sessions' edits could not be asked about (F3; rules 9 and 12). */
    error: string | undefined;
    /** Asks the failed question again (F3). */
    retry: () => void;
}

/** A question waiting: what it asks, of which plan, and the plan and context it was asked over. */
interface Wanted<Q, P, C> { key: string; question: Q; of: P | undefined; base: P; context: C }

/** The question out, or the one that failed and waits for a retry: what it asked, of which plan, in which context. */
interface Flight<P, C> {
    readonly key: string;
    readonly plan: P;
    readonly context: C;
    /** The records the call passed drafts of, by name. */
    readonly drafted: readonly string[];
    /** The derived plan's change's place among the call's drafts, from 1 — the last — where it carried one (rule 10). */
    readonly derived: number | undefined;
    /** What the channel held before the call, a failure of this call told from it. */
    readonly errorBefore: unknown;
    /** Whether the channel was seen running for this call. */
    seenRunning: boolean;
    /** The call was refused because a record moved under its drafts (rule 12): the source's words, and whether the page has read the records again. */
    conflict?: { readonly message: string; read: boolean };
    /** Why it failed before it was sent, or after its conflict: the sessions' words. */
    refused?: string;
    /** The records whose sessions held a conflict to choose as it failed: once they hold none, it is asked again. */
    choosing?: readonly string[];
}

/**
 * A builder's fit (see the module docs).
 *
 * @typeParam Q - A question
 * @typeParam P - The plan a question is asked of, kept by identity: a new plan, new answers
 * @typeParam C - The context it is asked in, kept by identity: a new context, new answers. It holds what the page
 *   reads and its sessions' drafts, so the drafts an ask takes from the sessions are made once for each
 * @typeParam R - An answer
 * @param questions - The function and what it lists, the builder's sessions, and how a question is keyed, answered and asked
 * @param plan - The builder's drafts as they stand
 * @param context - What every question is asked in
 * @returns The fit
 */
export function useFit<Q, P extends object, C extends object, R>(questions: FitQuestions<Q, P, C, R>, plan: P, context: C): FitAnswers<Q, P, R> {
    const call = useFuncCall<R>(questions.name, questions.name === null ? null : [questions.requestType], questions.resultType, questions.binding);
    // Answers, by the context and the plan they were asked of, then by question: new drafts ask again.
    const kept = useRef(new WeakMap<C, WeakMap<P, Map<string, R>>>());
    // The questions that failed alone — a derived plan's change its record refused (rule 10) — kept as answers are, in the record's words.
    const failures = useRef(new WeakMap<C, WeakMap<P, Map<string, string>>>());
    // The sessions' pending Save as drafts, made once for each context: the same drafts, the same patch.
    const handed = useRef(new WeakMap<C, readonly FuncCallDraft[]>());
    const [, changed] = useReducer((n: number) => n + 1, 0);
    // Why the question in flight failed before it was sent, or after its conflict: what `error` says beside a failed call's own.
    const [refused, setRefused] = useState<string | undefined>(undefined);
    // The questions waiting, the latest asked first.
    const waiting = useRef<Wanted<Q, P, C>[]>([]);
    const flight = useRef<Flight<P, C> | undefined>(undefined);
    // How many times in a row a question went again because a record moved under its drafts (rule 12), and which question:
    // a different one counts from none.
    const resent = useRef(0);
    const resentFor = useRef<string | undefined>(undefined);
    // The failure of a call that went again for a conflict: the channel holds it until the next call is out, and it is no failure of the fit's.
    const passed = useRef<unknown>(undefined);
    const live = useRef({ call, plan, context, questions });
    live.current = { call, plan, context, questions };
    const keptFor = useCallback((forContext: C, forPlan: P) => byQuestionOf(kept.current, forContext, forPlan), []);
    const failuresFor = useCallback((forContext: C, forPlan: P) => byQuestionOf(failures.current, forContext, forPlan), []);
    // An answer landing is kept for the plan it was asked of — if it answers the question in flight.
    useEffect(() => {
        const asked = flight.current, result = call.result;
        if (asked === undefined || result === null || call.pending || call.status !== "succeeded" || live.current.questions.answers(result) !== asked.key) return;
        keptFor(asked.context, asked.plan).set(asked.key, result);
        flight.current = undefined;
        resent.current = 0;
        changed();
    }, [call.result, call.pending, call.status, keptFor]);
    // A call refused because a record moved under its drafts lands nothing (rule 12): the page reads those records again. One
    // whose derived plan's change its record refused fails that question alone (rule 10).
    useEffect(() => {
        const asked = flight.current;
        if (asked === undefined || asked.conflict !== undefined || asked.refused !== undefined) return;
        if (call.pending) { asked.seenRunning = true; return; }
        // The same error the channel held before: this call has not failed yet (a new failure is a new object).
        if (!asked.seenRunning && Object.is(call.error, asked.errorBefore)) return;
        if (call.status !== "failed" || call.error === null) return;
        const alone = asked.derived === undefined ? undefined : derivedRefusal(call.error, asked.derived);
        if (alone !== undefined) {
            failuresFor(asked.context, asked.plan).set(asked.key, alone);
            // The channel holds the failure until the next call is out: the question's, no failure of the fit's.
            passed.current = call.error;
            flight.current = undefined;
            changed();
            return;
        }
        if (call.error.kind.type !== "conflict") return;
        const conflict = { message: call.error.message, read: false };
        asked.conflict = conflict;
        changed();
        void readRecordsAgain(asked.drafted).then(() => {
            if (flight.current !== asked || asked.conflict !== conflict) return;
            conflict.read = true;
            changed();
        });
    }, [call.pending, call.status, call.error, failuresFor]);
    // The next question goes once nothing is in flight — after every effect of the commit has asked its own, so the commit's
    // latest goes first.
    const scheduled = useRef(false), alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => {
        if (scheduled.current) return;
        scheduled.current = true;
        queueMicrotask(() => {
            scheduled.current = false;
            const now = live.current;
            if (!alive.current || now.call.pending) return;
            const { sessions, binding } = now.questions;
            const listed = binding.drafts;
            // The question whose call a record moved under goes on once the page has read the records again and the sessions
            // stand on what it read: asked again with the new drafts, or failed where a conflict is to choose (rule 12).
            const conflicted = flight.current;
            if (conflicted?.conflict !== undefined) {
                if (!conflicted.conflict.read || !sessions.standing(conflicted.drafted)) return;
                const next = afterConflict(sessions, conflicted.drafted, resent.current, conflicted.conflict.message);
                delete conflicted.conflict;
                if ("again" in next) {
                    resent.current++;
                    passed.current = now.call.error;
                    flight.current = undefined;
                    // The drafts the sessions hand over now are the carried ones, whatever was made for this context before.
                    handed.current.delete(conflicted.context);
                } else {
                    conflicted.refused = next.failed;
                    if (next.refused !== undefined) conflicted.choosing = conflicted.drafted;
                    setRefused(next.failed);
                    return;
                }
            }
            // A question that failed for a conflict to choose is asked again once the person has chosen: whatever they chose,
            // the sessions stand on the newer saves, and hand over their edits as they are now.
            const chosen = flight.current;
            if (chosen?.choosing !== undefined && sessions.standing(chosen.choosing) && sessions.conflicts(chosen.choosing) === undefined) {
                handed.current.delete(chosen.context);
                flight.current = undefined;
                resent.current = 0;
                setRefused(undefined);
            }
            // A question of drafts or a context the builder has moved on from is no one's any more; an answered one is done, and
            // so is one that failed alone (rule 10).
            waiting.current = waiting.current.filter(w => Object.is(w.base, now.plan) && Object.is(w.context, now.context)
                && !keptFor(now.context, w.of ?? now.plan).has(w.key) && !failuresFor(now.context, w.of ?? now.plan).has(w.key));
            // A question whose own subject is an edit not yet complete is not asked until it is (rule 8).
            const next = waiting.current.find(w => now.questions.complete?.(w.question) !== false);
            if (next === undefined) return;
            const of = next.of ?? now.plan, asked = flight.current;
            // The same question of the same plan (the same objects) is in flight, or failed and waits for a retry.
            if (asked !== undefined && asked.key === next.key && Object.is(asked.plan, of) && Object.is(asked.context, now.context)) return;
            // The sessions' pending Save, as drafts — for a function that lists none, its request alone.
            let drafts: readonly FuncCallDraft[] = [];
            let derived: number | undefined;
            if (listed.length > 0) {
                // A Save of a session's own on its way, or its drafts being carried over to a record that moved: the question
                // waits until the sessions stand, whatever drafts were handed over in this context before.
                if (!sessions.standing(listed)) return;
                let pending = handed.current.get(now.context);
                if (pending === undefined) {
                    const made = sessions.drafts(listed);
                    if ("refused" in made) {
                        // The record's refusal of the edits as they stand (rule 9), or a conflict to choose: in its words.
                        const toChoose = sessions.conflicts(listed);
                        const why = toChoose ?? made.refused;
                        flight.current = {
                            key: next.key, plan: of, context: now.context, drafted: [], derived: undefined, errorBefore: now.call.error, seenRunning: false,
                            refused: why, ...(toChoose === undefined ? {} : { choosing: listed }),
                        };
                        setRefused(why);
                        return;
                    }
                    pending = made;
                    handed.current.set(now.context, pending);
                }
                // A derived plan's change, as one more draft laid after the pending Save (rule 10).
                const more = next.of === undefined ? undefined : now.questions.further?.(next.of, next.base);
                drafts = more === undefined ? pending : [...pending, more];
                if (more !== undefined) derived = drafts.length;
            }
            // How many times a question goes again is its own to count (rule 12): a different question counts from none.
            if (resentFor.current !== next.key) { resentFor.current = next.key; resent.current = 0; }
            flight.current = {
                key: next.key, plan: of, context: now.context, drafted: [...new Set(drafts.map(draft => draft.record))], derived,
                errorBefore: now.call.error, seenRunning: false,
            };
            setRefused(undefined);
            const request = now.questions.request(next.question, now.context);
            if (listed.length === 0) now.call.call(request);
            else now.call.call(request, [...drafts]);
        });
    });
    const answer = useCallback((question: Q, of?: P) => kept.current.get(context)?.get(of ?? plan)?.get(live.current.questions.key(question)), [context, plan]);
    const refusedOf = useCallback((question: Q, of?: P) => failures.current.get(context)?.get(of ?? plan)?.get(live.current.questions.key(question)), [context, plan]);
    // A new plan or context, a new `ask`: an effect that asks, listing it, asks again (F1). It asks of them as they stand when it
    // runs, so a caller holding an older one still asks of these.
    const ask = useCallback((question: Q, of?: P) => {
        const now = live.current, key = now.questions.key(question), first = waiting.current[0];
        if (first !== undefined && first.key === key && Object.is(first.of, of) && Object.is(first.base, now.plan) && Object.is(first.context, now.context)) return;
        waiting.current = [{ key, question, of, base: now.plan, context: now.context },
            ...waiting.current.filter(w => !(w.key === key && Object.is(w.of, of)))].slice(0, WAITING);
        changed();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [plan, context]);
    const retry = useCallback(() => { flight.current = undefined; resent.current = 0; setRefused(undefined); changed(); }, []);
    // A call refused for a conflict has not failed while the page reads the records again and the sessions carry their edits over.
    const carrying = flight.current?.conflict !== undefined;
    const failed = call.status === "failed" && !carrying && !(call.error !== null && Object.is(call.error, passed.current));
    // A draft its record refused as it was laid fails the fit in the record's words, as a Save of the edit is refused (rule 9).
    const error = refused ?? (failed ? (call.error === null ? undefined : draftRefusal(call.error) ?? call.error.message) ?? "the fit could not run" : undefined);
    // A question asked of the drafts as they are, still unanswered — but one waiting on its own subject's edit, which shows no verdict,
    // and one that failed alone (rule 10).
    const unanswered = waiting.current.some(w => Object.is(w.base, plan) && questions.complete?.(w.question) !== false && answer(w.question, w.of) === undefined
        && refusedOf(w.question, w.of) === undefined);
    return { answer, ask, refused: refusedOf, pending: error === undefined && (call.pending || unanswered), error, retry };
}

/**
 * What a store keeps for a context and a plan, by question: made the first time either is asked of.
 *
 * @param store - The store, by context then by plan
 * @param context - The context
 * @param plan - The plan
 * @returns Its map of questions
 */
function byQuestionOf<C extends object, P extends object, V>(store: WeakMap<C, WeakMap<P, Map<string, V>>>, context: C, plan: P): Map<string, V> {
    let byPlan = store.get(context);
    if (byPlan === undefined) { byPlan = new WeakMap(); store.set(context, byPlan); }
    let byQuestion = byPlan.get(plan);
    if (byQuestion === undefined) { byQuestion = new Map(); byPlan.set(plan, byQuestion); }
    return byQuestion;
}
