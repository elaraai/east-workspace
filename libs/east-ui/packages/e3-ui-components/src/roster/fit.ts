/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's fit (#1334, `Allocation Spec.md` §13, R1–R4): the app's
 * `e3.function`, asked through the shared fit (`shared/func/use-fit.ts`) who
 * fits a Find fix's need on its issue's slot, over the drafted week and the
 * complete staff, whatever the rail shows — its question over the app's own
 * duty rows (`Roster.Types.FitRequest(R)`, #1369), each duty carrying its row.
 * The find asks again when the drafts change; one question is in flight at a
 * time, the latest asked first, and answers are kept by question and drafts
 * (F1). While a find's answer for the drafts as they are is on its way, it has
 * none to show (F2). The Roster decides no one itself: the People tab shows
 * the answer.
 *
 * @packageDocumentation
 */

import { useEffect, useMemo } from "react";
import { StructType, equalFor, printFor, type SortedMap, type ValueTypeOf } from "@elaraai/east";
import { RosterContextType, RosterFitResultType, RosterNeedType, RosterSlotType } from "@elaraai/e3-ui/internal";
import { useDataStable } from "@elaraai/east-ui-components";
import { useFit } from "../shared/func/use-fit.js";
import { rosterDomain, type Context, type Coverage, type RosterValue, type Slot, type Week } from "./model.js";

/** What a Find fix looks for: a lead, a trainer, or a holder of a skill. */
export type Need = ValueTypeOf<typeof RosterNeedType>;
/** The fit's answer: a verdict for every person, by staff key. */
export type FitResult = ValueTypeOf<typeof RosterFitResultType>;
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

/** What every question is asked in: the complete context, the week's first day, and the drafted week's coverage. */
interface Facts { context: Context; start: Date; coverage: SortedMap<Slot, Coverage> }

/**
 * The Roster's fit (see the module docs).
 *
 * @param value - The payload: the fit's name, `none` without one, and the duty kind's row type
 * @param start - The week's first day
 * @param week - The drafted week
 * @param context - The complete staff and configuration
 * @param coverage - The drafted week's coverage, its costs the pay's
 * @param find - The find the People tab shows, if any
 * @returns The fit, for that find
 */
export function useRosterFit(value: RosterValue, start: Date, week: Week, context: Context, coverage: SortedMap<Slot, Coverage>, find: RosterFind | undefined): RosterFit {
    const domain = rosterDomain(value.duty.rowType);
    // The drafts and the context by their data: a render that builds them again asks nothing again.
    const plan = useDataStable(week, domain.sameWeek);
    const complete = useDataStable(context, sameContext);
    const epoch = start.getTime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const facts = useMemo<Facts>(() => ({ context: complete, start: new Date(epoch), coverage }), [complete, epoch, plan]);
    const name = value.fit.type === "some" ? value.fit.value.name : null;
    const fit = useFit<RosterFind, Week, Facts, FitResult>({
        name, requestType: domain.fitRequestType, resultType: RosterFitResultType,
        key: findText, answers: result => findText({ need: result.need, slot: result.slot }),
        request: (asked, drafted, at) => ({ need: asked.need, slot: asked.slot, start: at.start, week: drafted, context: at.context, coverage: at.coverage }),
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
