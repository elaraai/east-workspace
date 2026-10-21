/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The board's fit (`Allocation Spec.md` §12.2, F1–F4): the app's
 * `e3.function`, asked through the shared fit (`shared/func/use-fit.ts`), as
 * the Roster's Find fixes ask theirs. The board asks about its active
 * subjects — the selected bin, the grip under a pointer-down, an open
 * Chooser's cell — and asks again when the drafts change, or the arrivals,
 * lanes and resources it reads. Answers are kept by what they were asked of
 * and by question, matched to their question by the `ask` each echoes. One
 * question is in flight at a time; the others wait, the latest asked first,
 * and a question of drafts the board has moved on from goes unasked — a
 * drop's new drafts never re-ask the subject its command selected away from.
 * The renderer computes no fit of its own.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { printFor } from "@elaraai/east";
import { AllocationFitAskType, AllocationFitResultType } from "@elaraai/e3-ui/internal";
import { useFit, type FitAnswers, type FitQuestions } from "../shared/func/use-fit.js";
import type { AllocationDomain, AllocationValue, Context, Day, FitAsk, FitResult } from "./model.js";

/** A question's key: its East text. */
const askKey = printFor(AllocationFitAskType);

/**
 * The fit, as the board asks it: of the day as drafted now, or of a plan the
 * board derives from it (a fill asks of the day without the reservation it
 * fills).
 */
export type AllocationFit = FitAnswers<FitAsk, Day, FitResult>;

/**
 * The board's fit (see the module docs).
 *
 * @param value - The payload: the fit's name
 * @param domain - The bin row type's domain: the request's type
 * @param day - The plan day
 * @param plan - The day as drafted
 * @param context - Every arrival and resource
 * @returns The fit
 */
export function useAllocationFit(value: AllocationValue, domain: AllocationDomain, day: Date, plan: Day, context: Context): AllocationFit {
    const epoch = day.getTime();
    const questions = useMemo((): FitQuestions<FitAsk, Day, Context, FitResult> => ({
        name: value.fit.name, requestType: domain.requestType, resultType: AllocationFitResultType,
        key: askKey, answers: result => askKey(result.ask),
        request: (ask, of, within) => ({ day: new Date(epoch), plan: of, ask, context: within }),
    }), [value.fit.name, domain.requestType, epoch]);
    return useFit(questions, plan, context);
}
