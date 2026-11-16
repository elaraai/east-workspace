/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The board's fit (`Allocation Spec.md` §12.2, F1–F4; east-workspace#1624):
 * the app's `e3.function`, asked through the shared fit
 * (`shared/func/use-fit.ts`), as the Roster's Find fixes ask theirs. The board
 * asks about its active subjects — the selected bin, the grip under a
 * pointer-down, an open Chooser's cell — and asks again when the drafts
 * change, or the arrivals, lanes and resources it reads. A request is the plan
 * day, the question and the page's scope (`Allocation.Types.FitRequest`), and
 * no row: the call carries the board's unsaved edits as drafts, and the
 * function reads the day's bins for itself. A question about the day as it
 * would be — without a reservation a fill replaces, with a probe reservation
 * in a free slot, with a removed bin back on it — carries that change as one
 * more draft of the bins' record, laid after the pending Save (rule 10). The
 * rail's own choices are not sent, so a choice on the rail asks nothing again.
 * Answers are kept by what they were asked of and by question, matched to
 * their question by the `ask` each echoes. One question is in flight at a
 * time; the others wait, the latest asked first, and a question of drafts the
 * board has moved on from goes unasked — a drop's new drafts never re-ask the
 * subject its command selected away from. The renderer computes no fit of its
 * own.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { StringType, equalFor, printFor } from "@elaraai/east";
import { AllocationFitAskType, AllocationFitRequestType, AllocationFitResultType, OptimiseSliceType } from "@elaraai/e3-ui/internal";
import { useDataStable } from "@elaraai/east-ui-components";
import { fitScope, type OptimiseSlice } from "../shared/func/optimise-slice.js";
import { recordPatchDrafts, type EntryChange } from "../shared/func/patch-draft.js";
import { useFit, type FitAnswers, type FitQuestions } from "../shared/func/use-fit.js";
import type { OptimiseSessions } from "../shared/func/use-optimise.js";
import type { AllocationDomain, AllocationValue, Context, Day, FitAsk, FitRequest, FitResult } from "./model.js";

/** A question's key: its East text. */
const askKey = printFor(AllocationFitAskType);
const sameScope = equalFor(OptimiseSliceType);

/**
 * The fit, as the board asks it: of the day as drafted now, or of a plan the
 * board derives from it (a fill asks of the day without the reservation it
 * fills).
 */
export type AllocationFit = FitAnswers<FitAsk, Day, FitResult>;

/**
 * Why a question has no answer and none is coming: the board's fit failed (F3), or the record refused the day the
 * question is asked of (rule 10), that question alone.
 *
 * @param fit - The board's fit
 * @param ask - The question
 * @param of - The day it is asked of, where it is one the board derives
 * @returns The fit's words; `undefined` while an answer may yet come
 */
export function fitFailure(fit: AllocationFit, ask: FitAsk, of?: Day): string | undefined {
    return fit.error ?? fit.refused(ask, of);
}

/** What an ask takes beside its question: the board's sessions and their drafts. */
export interface AllocationFitAsked {
    /** The board's sessions over the records it edits — the bins' and the periods': what an ask takes its drafts from. */
    readonly sessions: OptimiseSessions;
    /** The sessions' drafts, the same object while their bytes hold: an answer is kept for the drafts it was asked of. */
    readonly drafts: object;
}

/**
 * What every question is asked in: the plan day and the page's scope, which the request carries; and what the board
 * reads and its sessions' drafts, a change of either asking again.
 */
interface Facts { day: Date; scope: OptimiseSlice; page: Context; drafts: object }

/**
 * The change from the day as drafted to a plan derived from it, entry by entry: a bin the derived plan leaves out, one
 * it adds, and one whose row it changes.
 *
 * @param base - The day as drafted
 * @param of - The plan derived from it
 * @returns Each changed bin's row before and after, by its key
 */
export function derivedChanges(base: Day, of: Day): EntryChange[] {
    const changes: EntryChange[] = [];
    for (const [id, bin] of base.bins) changes.push({ key: id, before: bin.row, after: of.bins.get(id)?.row });
    for (const [id, bin] of of.bins) if (!base.bins.has(id)) changes.push({ key: id, before: undefined, after: bin.row });
    return changes;
}

/**
 * The board's fit (see the module docs).
 *
 * @param value - The payload: the fit's binding, the bins' record and the rail
 * @param domain - The bin row type's domain
 * @param day - The plan day
 * @param plan - The day as drafted
 * @param context - Every arrival and resource, as the board reads them
 * @param asked - The board's sessions and their drafts
 * @returns The fit
 */
export function useAllocationFit(value: AllocationValue, domain: AllocationDomain, day: Date, plan: Day, context: Context, asked: AllocationFitAsked): AllocationFit {
    const epoch = day.getTime();
    const scope = useDataStable(fitScope(value.slice.type === "some" ? value.slice.value : undefined), sameScope);
    const { sessions, drafts } = asked;
    const facts = useMemo<Facts>(() => ({ day: new Date(epoch), scope, page: context, drafts }), [epoch, scope, context, drafts]);
    // A derived plan's change, as a draft of the bins' record's patch door — for a function that lists the bins in its drafts.
    const bins = value.bin.kind.editing.sourceId;
    const patchDraft = useMemo(() => recordPatchDrafts(bins, StringType, domain.rowType), [bins, domain.rowType]);
    const questions = useMemo((): FitQuestions<FitAsk, Day, Facts, FitResult> => ({
        name: value.fit.name, binding: value.fit, sessions,
        requestType: AllocationFitRequestType, resultType: AllocationFitResultType,
        key: askKey, answers: result => askKey(result.ask),
        // The day, the question and the scope, and no row (rule 1): the function reads the day's bins for itself.
        request: (ask, within): FitRequest => ({ day: within.day, ask, scope: within.scope }),
        further: (of, base) => value.fit.drafts.includes(bins) ? patchDraft(derivedChanges(base, of)) : undefined,
    }), [value.fit, sessions, bins, patchDraft]);
    return useFit(questions, plan, facts);
}
