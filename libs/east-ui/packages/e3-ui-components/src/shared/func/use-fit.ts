/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An app's fit, as a builder asks it (`Allocation Spec.md` §12.2, F1–F4, and
 * §13): the app's `e3.function`, called by name through the shared `Func`
 * runtime (`useFuncCall`). A builder asks questions about its drafts. Each
 * answer is kept by the context and the drafts it was asked of, then by
 * question — its key, which the answer echoes, so an answer lands only on the
 * question it answers. One question is in flight at a time; the others wait,
 * the latest asked first, and a question of drafts or a context the builder has
 * moved on from goes unasked. A failed call keeps its question until it is
 * asked again (`retry`). The builder computes no fit of its own.
 *
 * The Roster's Find fixes ask through this (#1334); the Allocation's board
 * keeps the same machinery over its own questions (`allocation/fit.ts`).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { EastType } from "@elaraai/east";
import { useFuncCall } from "./use-func-call.js";

/** How many questions wait at most: one older than these is no one's any more. */
const WAITING = 8;

/**
 * What a builder's fit asks, and how.
 *
 * @typeParam Q - A question
 * @typeParam P - The plan a question is asked of: the builder's drafts
 * @typeParam C - The context it is asked in
 * @typeParam R - An answer
 */
export interface FitQuestions<Q, P extends object, C extends object, R> {
    /** The app's function's name; `null` with none, and nothing is asked. */
    name: string | null;
    /** What the function takes. */
    requestType: EastType;
    /** What it answers. */
    resultType: EastType;
    /** A question's key: its East text. */
    key: (question: Q) => string;
    /** The key of the question an answer answers, from what it echoes. */
    answers: (result: R) => string;
    /** The function's argument for a question about a plan, in a context. */
    request: (question: Q, plan: P, context: C) => unknown;
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
    /** Asks a question of the plan as it stands, or of one derived from it: answered from what is kept, else sent once nothing is in flight. */
    ask: (question: Q, of?: P) => void;
    /** Whether a question asked of the plan as it stands is unanswered (F2). */
    pending: boolean;
    /** Why the last call failed (F3). */
    error: string | undefined;
    /** Asks the failed question again (F3). */
    retry: () => void;
}

/** A question waiting: what it asks, of which plan, and the plan and context it was asked over. */
interface Wanted<Q, P, C> { key: string; question: Q; of: P | undefined; base: P; context: C }

/**
 * A builder's fit (see the module docs).
 *
 * @typeParam Q - A question
 * @typeParam P - The plan a question is asked of, kept by identity: a new plan, new answers
 * @typeParam C - The context it is asked in, kept by identity: a new context, new answers
 * @typeParam R - An answer
 * @param questions - The function, and how a question is keyed, answered and asked
 * @param plan - The builder's drafts as they stand
 * @param context - What every question is asked in
 * @returns The fit
 */
export function useFit<Q, P extends object, C extends object, R>(questions: FitQuestions<Q, P, C, R>, plan: P, context: C): FitAnswers<Q, P, R> {
    const call = useFuncCall<R>(questions.name, questions.name === null ? null : [questions.requestType], questions.resultType);
    // Answers, by the context and the plan they were asked of, then by question: new drafts ask again.
    const kept = useRef(new WeakMap<C, WeakMap<P, Map<string, R>>>());
    const [, changed] = useReducer((n: number) => n + 1, 0);
    // The questions waiting, the latest asked first.
    const waiting = useRef<Wanted<Q, P, C>[]>([]);
    const flight = useRef<{ key: string; plan: P; context: C } | undefined>(undefined);
    const live = useRef({ call, plan, context, questions });
    live.current = { call, plan, context, questions };
    const keptFor = useCallback((forContext: C, forPlan: P) => {
        let byPlan = kept.current.get(forContext);
        if (byPlan === undefined) { byPlan = new WeakMap(); kept.current.set(forContext, byPlan); }
        let byQuestion = byPlan.get(forPlan);
        if (byQuestion === undefined) { byQuestion = new Map(); byPlan.set(forPlan, byQuestion); }
        return byQuestion;
    }, []);
    // An answer landing is kept for the plan it was asked of — if it answers the question in flight.
    useEffect(() => {
        const asked = flight.current, result = call.result;
        if (asked === undefined || result === null || call.pending || call.status !== "succeeded" || live.current.questions.answers(result) !== asked.key) return;
        keptFor(asked.context, asked.plan).set(asked.key, result);
        flight.current = undefined;
        changed();
    }, [call.result, call.pending, call.status, keptFor]);
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
            // A question of drafts or a context the builder has moved on from is no one's any more; an answered one is done.
            waiting.current = waiting.current.filter(w => Object.is(w.base, now.plan) && Object.is(w.context, now.context)
                && !keptFor(now.context, w.of ?? now.plan).has(w.key));
            const next = waiting.current[0];
            if (next === undefined) return;
            const of = next.of ?? now.plan, asked = flight.current;
            // The same question of the same plan (the same objects) is in flight, or failed and waits for a retry.
            if (asked !== undefined && asked.key === next.key && Object.is(asked.plan, of) && Object.is(asked.context, now.context)) return;
            flight.current = { key: next.key, plan: of, context: now.context };
            now.call.call(now.questions.request(next.question, of, now.context));
        });
    });
    const answer = useCallback((question: Q, of?: P) => kept.current.get(context)?.get(of ?? plan)?.get(live.current.questions.key(question)), [context, plan]);
    const ask = useCallback((question: Q, of?: P) => {
        const now = live.current, key = now.questions.key(question), first = waiting.current[0];
        if (first !== undefined && first.key === key && Object.is(first.of, of) && Object.is(first.base, now.plan) && Object.is(first.context, now.context)) return;
        waiting.current = [{ key, question, of, base: now.plan, context: now.context },
            ...waiting.current.filter(w => !(w.key === key && Object.is(w.of, of)))].slice(0, WAITING);
        changed();
    }, []);
    const retry = useCallback(() => { flight.current = undefined; changed(); }, []);
    const error = call.status === "failed" ? call.error?.message ?? "the fit could not run" : undefined;
    // A question asked of the drafts as they are, still unanswered.
    const unanswered = waiting.current.some(w => Object.is(w.base, plan) && answer(w.question, w.of) === undefined);
    return { answer, ask, pending: error === undefined && (call.pending || unanswered), error, retry };
}
