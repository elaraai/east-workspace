/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The board's fit (`Allocation Spec.md` §12.2, F1–F4): the app's
 * `e3.function`, called by name through the shared `Func` runtime. The board
 * asks about its active subjects — the selected bin, the grip under a
 * pointer-down, an open Chooser's cell — and asks again when the drafts change.
 * Answers are kept by the drafts they were asked of and by question, matched
 * to their question by the `ask` each echoes. One question is in flight at a
 * time; the others wait, the latest asked first, and a question of drafts the
 * board has moved on from goes unasked — a drop's new drafts never re-ask the
 * subject its command selected away from. The renderer computes no fit of its
 * own.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { printFor } from "@elaraai/east";
import { AllocationFitAskType, AllocationFitResultType } from "@elaraai/e3-ui/internal";
import { useFuncCall } from "../shared/func/use-func-call.js";
import type { AllocationDomain, AllocationValue, Context, Day, FitAsk, FitResult } from "./model.js";

/** A question's key: its East text. */
const askKey = printFor(AllocationFitAskType);
/** How many questions wait at most: one older than these is no one's subject any more. */
const WAITING = 8;

/** The fit, as the board asks it. */
export interface AllocationFit {
    /**
     * The answer to a question, once it has landed (F1): about the day as
     * drafted now, or about a plan the board derives from it (a fill asks of
     * the day without the reservation it fills).
     */
    answer: (ask: FitAsk, of?: Day) => FitResult | undefined;
    /** Asks a question of the day as drafted now, or of a plan derived from it: answered from what is kept, else sent once nothing is in flight. */
    ask: (ask: FitAsk, of?: Day) => void;
    /** Whether a question asked of the drafts as they are is unanswered (F2). */
    pending: boolean;
    /** Why the last call failed (F3). */
    error: string | undefined;
    /** Asks the failed question again (F3). */
    retry: () => void;
}

/** A question waiting: what it asks, of which plan, and the drafts and context it was asked over. */
interface Wanted { key: string; ask: FitAsk; of: Day | undefined; base: Day; context: Context }

/**
 * The board's fit (see the module docs).
 *
 * @param value - The payload: the fit's name
 * @param domain - The plans at their bin values: the request's type
 * @param day - The plan day
 * @param plan - The day as drafted
 * @param context - Every event and resource
 * @returns The fit
 */
export function useAllocationFit(value: AllocationValue, domain: AllocationDomain, day: Date, plan: Day, context: Context): AllocationFit {
    const call = useFuncCall<FitResult>(value.fit.name, [domain.requestType], AllocationFitResultType);
    // Answers, by the context and the plan they were asked of, then by question: a new draft asks again.
    const kept = useRef(new WeakMap<Context, WeakMap<Day, Map<string, FitResult>>>());
    const [, changed] = useReducer((n: number) => n + 1, 0);
    // The questions waiting, the latest asked first.
    const waiting = useRef<Wanted[]>([]);
    const flight = useRef<{ key: string; plan: Day; context: Context } | undefined>(undefined);
    const keptFor = (forContext: Context, forPlan: Day) => {
        let byPlan = kept.current.get(forContext);
        if (byPlan === undefined) { byPlan = new WeakMap(); kept.current.set(forContext, byPlan); }
        let byAsk = byPlan.get(forPlan);
        if (byAsk === undefined) { byAsk = new Map(); byPlan.set(forPlan, byAsk); }
        return byAsk;
    };
    // An answer landing is kept for the plan it was asked of — if it answers the question in flight.
    useEffect(() => {
        const asked = flight.current, result = call.result;
        if (asked === undefined || result === null || call.pending || call.status !== "succeeded" || askKey(result.ask) !== asked.key) return;
        keptFor(asked.context, asked.plan).set(asked.key, result);
        flight.current = undefined;
        changed();
    }, [call.result, call.pending, call.status]);
    // The next question goes once nothing is in flight — after every effect of the commit has asked its own, so the
    // commit's latest goes first.
    const live = useRef({ call, plan, context, day });
    live.current = { call, plan, context, day };
    const scheduled = useRef(false), alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => {
        if (scheduled.current) return;
        scheduled.current = true;
        queueMicrotask(() => {
            scheduled.current = false;
            const now = live.current;
            if (!alive.current || now.call.pending) return;
            // A question of drafts or a context the board has moved on from is no one's any more; an answered one is done.
            waiting.current = waiting.current.filter(w => Object.is(w.base, now.plan) && Object.is(w.context, now.context)
                && !keptFor(now.context, w.of ?? now.plan).has(w.key));
            const next = waiting.current[0];
            if (next === undefined) return;
            const of = next.of ?? now.plan, asked = flight.current;
            // The same question of the same plan (the same objects) is already in flight.
            if (asked !== undefined && asked.key === next.key && Object.is(asked.plan, of) && Object.is(asked.context, now.context)) return;
            flight.current = { key: next.key, plan: of, context: now.context };
            now.call.call({ day: now.day, plan: of, ask: next.ask, context: now.context });
        });
    });
    const answer = useCallback((ask: FitAsk, of?: Day) => kept.current.get(context)?.get(of ?? plan)?.get(askKey(ask)), [context, plan]);
    const ask = useCallback((next: FitAsk, of?: Day) => {
        const key = askKey(next), now = live.current, first = waiting.current[0];
        if (first !== undefined && first.key === key && Object.is(first.of, of) && Object.is(first.base, now.plan)) return;
        waiting.current = [{ key, ask: next, of, base: now.plan, context: now.context },
            ...waiting.current.filter(w => !(w.key === key && Object.is(w.of, of)))].slice(0, WAITING);
        changed();
    }, []);
    const retry = useCallback(() => { flight.current = undefined; changed(); }, []);
    const error = call.status === "failed" ? call.error?.message ?? "the fit could not run" : undefined;
    // A question asked of the drafts as they are, still unanswered.
    const unanswered = waiting.current.some(w => Object.is(w.base, plan) && answer(w.ask, w.of) === undefined);
    return { answer, ask, pending: error === undefined && (call.pending || unanswered), error, retry };
}
