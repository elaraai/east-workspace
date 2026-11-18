/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's fit (#1334, east-workspace#1624; `Allocation Spec.md` §13,
 * R1–R4): the app's `e3.function`, asked through the shared fit
 * (`shared/func/use-fit.ts`) who fits a Find fix's need on its issue's slot.
 * Its request is the question — the need, the slot and the week's first day —
 * and the page's scope (`Roster.Types.FitRequest`), and no row: the call
 * carries the Roster's unsaved edits as drafts, and the function reads the
 * week's duties, the people it asks about and the configuration for itself.
 * The rail's own choices are not sent, so a choice on the rail asks nothing
 * again. The find asks again when the drafts change, or what the page reads;
 * one question is in flight at a time, the latest asked first, and answers
 * are kept by question and drafts (F1). While a find's answer for the drafts
 * as they are is on its way, it has none to show (F2). The Roster decides no
 * one itself: the People tab shows the answer, each person it names.
 *
 * @packageDocumentation
 */

import { useEffect, useMemo } from "react";
import { StructType, equalFor, printFor, type ValueTypeOf } from "@elaraai/east";
import { RosterContextType, RosterFitRequestType, RosterFitResultType, RosterNeedType, RosterSlotType } from "@elaraai/e3-ui/internal";
import { useDataStable } from "@elaraai/east-ui-components";
import type { OptimiseSlice } from "../shared/func/optimise-slice.js";
import { useFit, useFitScope } from "../shared/func/use-fit.js";
import { PLAIN_FUNC_BINDING } from "../shared/func/use-func-call.js";
import type { OptimiseSessions } from "../shared/func/use-optimise.js";
import type { SourcesChrome } from "../shared/schedule/visibility.js";
import { rosterDomain, type Context, type RosterValue, type Slot, type Week } from "./model.js";

/** What a Find fix looks for: a lead, a trainer, or a holder of a skill. */
export type Need = ValueTypeOf<typeof RosterNeedType>;
/** The fit's answer: a verdict for each person the function considered, by staff key. */
export type FitResult = ValueTypeOf<typeof RosterFitResultType>;
/** The fit's request: the question and the page's scope. */
export type FitRequest = ValueTypeOf<typeof RosterFitRequestType>;
/** A find: a need on an issue's slot — the question the fit is asked. */
export interface RosterFind { need: Need; slot: Slot }

/** A find as East holds it: what its key prints, and what an answer echoes. */
const FindType = StructType({ need: RosterNeedType, slot: RosterSlotType });
const findText = printFor(FindType);
/** Whether two finds ask the same question. */
export const sameFind: (a: RosterFind, b: RosterFind) => boolean = equalFor(FindType);
const sameContext = equalFor(RosterContextType);

/** The Roster's fit, for its one find. */
export interface RosterFit {
    /** Whether the app bound a fit: a Find fix is offered only then (R2). */
    offered: boolean;
    /** The find's answer for the drafts as they are, which the People tab shows; none while it is on its way (F2) or failed. */
    shown: FitResult | undefined;
    /** Whether the find is asked and its answer for the drafts as they are has not landed (R4: its fix reads `Finding…`). */
    pending: boolean;
    /** Why the fit's last call failed (R4: a warning banner with Retry). */
    error: string | undefined;
    /** Asks the failed question again. */
    retry: () => void;
}

/** What an ask takes beside its question: the page's rail, its sessions and their drafts. */
export interface RosterFitAsked {
    /** The Roster's rail, as its payload carries it: the page's scope is each source's of it. */
    readonly chrome: SourcesChrome | undefined;
    /** The Roster's sessions over the records it edits — the duties', the periods' and the targets': what an ask takes its drafts from. */
    readonly sessions: OptimiseSessions;
    /** The sessions' drafts, the same object while their bytes hold: an answer is kept for the drafts it was asked of. */
    readonly drafts: object;
}

/**
 * What every question is asked in: the week's first day and the page's scope, which the request carries; and what the
 * page reads and its sessions' drafts, a change of either asking again.
 */
interface Facts { start: Date; scope: OptimiseSlice; page: Context; drafts: object }

/**
 * The Roster's fit (see the module docs).
 *
 * @param value - The payload: the fit's binding, `none` without one, and the duty kind's row type
 * @param start - The week's first day
 * @param week - The drafted week, as the page reads it
 * @param context - The complete staff and configuration, as the page reads them
 * @param asked - The page's rail, its sessions and their drafts
 * @param find - The find the People tab shows, if any
 * @returns The fit, for that find
 */
export function useRosterFit(value: RosterValue, start: Date, week: Week, context: Context, asked: RosterFitAsked, find: RosterFind | undefined): RosterFit {
    const domain = rosterDomain(value.duty.rowType);
    // The drafts and the context by their data: a render that builds them again asks nothing again.
    const plan = useDataStable(week, domain.sameWeek);
    const complete = useDataStable(context, sameContext);
    const scope = useFitScope(asked.chrome);
    const epoch = start.getTime();
    const { drafts, sessions } = asked;
    const facts = useMemo<Facts>(() => ({ start: new Date(epoch), scope, page: complete, drafts }), [epoch, scope, complete, drafts]);
    const bound = value.fit.type === "some" ? value.fit.value : undefined;
    const name = bound?.name ?? null;
    const fit = useFit<RosterFind, Week, Facts, FitResult>({
        name, binding: bound ?? PLAIN_FUNC_BINDING, sessions,
        requestType: RosterFitRequestType, resultType: RosterFitResultType,
        key: findText, answers: result => findText({ need: result.need, slot: result.slot }),
        // The question and the scope, and no row (rule 1): the function reads the week for itself, the drafts laid over it.
        request: (question, at): FitRequest => ({ need: question.need, slot: question.slot, start: at.start, scope: at.scope }),
    }, plan, facts);
    const { ask } = fit;
    // The find asks of the drafts as they are, and again when they change (F1).
    useEffect(() => { if (find !== undefined && name !== null) ask(find); }, [find, name, plan, facts, ask]);
    // An answer asked of other drafts is no verdict on these: the tab shows none until theirs lands (F2).
    const answer = find === undefined ? undefined : fit.answer(find);
    return {
        offered: name !== null, shown: answer,
        pending: find !== undefined && name !== null && answer === undefined && fit.error === undefined,
        error: fit.error, retry: fit.retry,
    };
}
