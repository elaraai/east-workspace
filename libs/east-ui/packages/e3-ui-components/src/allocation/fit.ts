/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The board's fit (`Allocation Spec.md` §12.2, F1–F4): the app's
 * `e3.function`, called by name through the shared `Func` runtime. The board
 * asks about its active subject — the selected bin, the bin under a
 * pointer-down, a dragged resource — and asks again when the drafts change.
 * Answers are kept by the drafts they were asked of and by question, matched
 * to their question by the `ask` each echoes; one question is in flight at a
 * time, and a new one waits for it. A commit that asks several — a drop's
 * new drafts re-asking the old subject as its command selects another —
 * sends only the last. The renderer computes no fit of its own.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { printFor } from "@elaraai/east";
import { AllocationFitAskType, AllocationFitResultType } from "@elaraai/e3-ui/internal";
import { useFuncCall } from "../shared/func/use-func-call.js";
import type { AllocationDomain, AllocationValue, Context, Day, FitAsk, FitResult } from "./model.js";

/** A question's key: its East text. */
const askKey = printFor(AllocationFitAskType);

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
    /** Whether the wanted question is unanswered (F2). */
    pending: boolean;
    /** Why the last call failed (F3). */
    error: string | undefined;
    /** Asks the failed question again (F3). */
    retry: () => void;
}

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
    const [, landed] = useReducer((n: number) => n + 1, 0);
    // The wanted question: its state draws the board, its ref is what the send reads once the commit's effects have asked.
    const [wanted, setWanted] = useState<{ ask: FitAsk; of: Day | undefined }>();
    const wantedRef = useRef<{ ask: FitAsk; of: Day | undefined } | undefined>(undefined);
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
        landed();
    }, [call.result, call.pending, call.status]);
    // The wanted question goes once it has no answer for its plan and nothing is in flight — after every effect of
    // the commit has asked its own, so the last subject asked is the one sent.
    const live = useRef({ call, plan, context, day });
    live.current = { call, plan, context, day };
    const scheduled = useRef(false), alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => {
        if (scheduled.current) return;
        scheduled.current = true;
        queueMicrotask(() => {
            scheduled.current = false;
            const want = wantedRef.current, now = live.current;
            if (!alive.current || want === undefined || now.call.pending) return;
            const of = want.of ?? now.plan, key = askKey(want.ask);
            if (keptFor(now.context, of).has(key)) return;
            const asked = flight.current;
            // The same question of the same plan (the same objects) is already in flight.
            if (asked !== undefined && asked.key === key && Object.is(asked.plan, of) && Object.is(asked.context, now.context)) return;
            flight.current = { key, plan: of, context: now.context };
            now.call.call({ day: now.day, plan: of, ask: want.ask, context: now.context });
        });
    });
    const answer = useCallback((ask: FitAsk, of?: Day) => kept.current.get(context)?.get(of ?? plan)?.get(askKey(ask)), [context, plan]);
    const ask = useCallback((next: FitAsk, of?: Day) => {
        const before = wantedRef.current;
        if (before !== undefined && Object.is(before.of, of) && askKey(before.ask) === askKey(next)) return;
        wantedRef.current = { ask: next, of };
        setWanted(wantedRef.current);
    }, []);
    const retry = useCallback(() => { flight.current = undefined; landed(); }, []);
    const error = call.status === "failed" ? call.error?.message ?? "the fit could not run" : undefined;
    const unanswered = wanted !== undefined && answer(wanted.ask, wanted.of) === undefined;
    return { answer, ask, pending: error === undefined && (call.pending || unanswered), error, retry };
}
