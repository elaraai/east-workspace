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
 * day, the question and the page's scope (`Allocation.Types.FitRequest()`), and
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
 * Over bins keyed by other than String (east-workspace#1709, ruling 12), the
 * function's question and answer are made over the bins' key type, each bin
 * named by its own key, while the board names a bin by its key's text, as its
 * session does: a question goes out with its bin's key read from that text,
 * and an answer comes back with each bin's key printed ({@link allocationFitWire});
 * a derived plan's draft names each bin it changes by its key so too. A free
 * slot's probe reservation stands under the key Reserve there would make
 * (ruling 13), so the fit is asked about it as about any bin.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import { SortedMap, printFor, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import {
    AllocationFitAskType, AllocationFitRequestType, AllocationFitRequestTypeFor, AllocationFitResultType, AllocationFitResultTypeFor,
} from "@elaraai/e3-ui/internal";
import { optimiseIdOf, optimiseKeyOf } from "../shared/func/optimise-diff.js";
import type { OptimiseSlice } from "../shared/func/optimise-slice.js";
import { recordPatchDrafts, type EntryChange } from "../shared/func/patch-draft.js";
import { useFit, useFitScope, type FitAnswers, type FitQuestions } from "../shared/func/use-fit.js";
import type { OptimiseSessions } from "../shared/func/use-optimise.js";
import { compareString, type AllocationDomain, type AllocationValue, type Context, type Day, type FitAsk, type FitResult } from "./model.js";

/** A question's key: its East text. */
const askKey = printFor(AllocationFitAskType);

/** A question as the app's function takes it, and an answer as it gives one: each bin by its own key, of the bins' key type. */
type WireAsk = ValueTypeOf<AllocationFitAskType<EastType>>;
type WireResult = ValueTypeOf<AllocationFitResultType<EastType>>;

/** How the board's questions go out to the app's fit, and its answers come back (see the module docs). */
export interface AllocationFitWire {
    /** What the function takes. */
    readonly requestType: EastType;
    /** What it answers. */
    readonly resultType: EastType;
    /**
     * A bin's key, from the text the board names it by.
     *
     * @param id - The bin's key's text
     * @returns The key, of the bins' key type; `undefined` for a text no key of the type prints as
     */
    readonly key: (id: string) => unknown;
    /**
     * A question as the function takes it, its bin by its key.
     *
     * @param ask - The question, its bin by its key's text
     * @returns The question; `undefined` where its bin's text is no key of the bins' type — no question can name it
     */
    readonly keyed: (ask: FitAsk) => WireAsk | undefined;
    /**
     * An answer as the board reads it: the question it echoes, and each bin's verdict, by the bin's key's text — one
     * object for one answer, as the board keeps what it reads of an answer by the answer.
     *
     * @param result - The function's answer
     */
    readonly text: (result: WireResult) => FitResult;
}

/** Over bins keyed by String, the board's own forms are the function's. */
const TEXT_WIRE: AllocationFitWire = {
    requestType: AllocationFitRequestType, resultType: AllocationFitResultType,
    key: (id) => id, keyed: (ask) => ask, text: (result) => result as FitResult,
};

/**
 * How the board's questions go out to the app's fit over bins of a key type, and its answers come back (see the module
 * docs).
 *
 * @param keyType - The bins' record's key type
 * @returns The fit's types over it, and the question and answer each way
 */
export function allocationFitWire(keyType: EastType): AllocationFitWire {
    if (keyType.type === "String") return TEXT_WIRE;
    const keyOf = optimiseKeyOf<unknown>(keyType), idOf = optimiseIdOf<unknown>(keyType);
    const texts = new WeakMap<object, FitResult>();
    return {
        requestType: AllocationFitRequestTypeFor({ key: keyType }), resultType: AllocationFitResultTypeFor({ key: keyType }),
        key: keyOf,
        keyed: (ask) => {
            if (ask.type !== "place" || ask.value.subject.type !== "bin") return ask;
            const key = keyOf(ask.value.subject.value);
            return key === undefined ? undefined : variant("place", { subject: variant("bin", key), quantity: ask.value.quantity });
        },
        text: (result) => {
            let read = texts.get(result);
            if (read === undefined) {
                const { ask } = result;
                const asked = ask.type === "place" && ask.value.subject.type === "bin"
                    ? variant("place", { subject: variant("bin", idOf(ask.value.subject.value)), quantity: ask.value.quantity }) : ask;
                read = { ...result, ask: asked, bins: new SortedMap([...result.bins].map(([key, fit]) => [idOf(key), fit] as const), compareString) } as FitResult;
                texts.set(result, read);
            }
            return read;
        },
    };
}

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
 * it adds, and one whose row it changes — each by its key, of the bins' key type.
 *
 * @param base - The day as drafted
 * @param of - The plan derived from it
 * @param keyOf - A bin's key, from the text the board names it by ({@link AllocationFitWire.key})
 * @returns Each changed bin's row before and after, by its key
 */
export function derivedChanges(base: Day, of: Day, keyOf: (id: string) => unknown): EntryChange[] {
    const changes: EntryChange[] = [];
    for (const [id, bin] of base.bins) changes.push({ key: keyOf(id), before: bin.row, after: of.bins.get(id)?.row });
    for (const [id, bin] of of.bins) if (!base.bins.has(id)) changes.push({ key: keyOf(id), before: undefined, after: bin.row });
    return changes;
}

/**
 * The board's fit (see the module docs).
 *
 * @param value - The payload: the fit's binding, the bins' record and the rail
 * @param domain - The bin row type's domain
 * @param keyType - The bins' record's key type: what the fit's question and answer name a bin by
 * @param day - The plan day
 * @param plan - The day as drafted
 * @param context - Every arrival and resource, as the board reads them
 * @param asked - The board's sessions and their drafts
 * @returns The fit
 */
export function useAllocationFit(value: AllocationValue, domain: AllocationDomain, keyType: EastType, day: Date, plan: Day, context: Context,
    asked: AllocationFitAsked): AllocationFit {
    const epoch = day.getTime();
    const scope = useFitScope(value.slice.type === "some" ? value.slice.value : undefined);
    const { sessions, drafts } = asked;
    const facts = useMemo<Facts>(() => ({ day: new Date(epoch), scope, page: context, drafts }), [epoch, scope, context, drafts]);
    const wire = useMemo(() => allocationFitWire(keyType), [keyType]);
    // A derived plan's change, as a draft of the bins' record's patch door at its own key type — for a function that lists the
    // bins in its drafts.
    const bins = value.bin.kind.editing.sourceId;
    const patchDraft = useMemo(() => recordPatchDrafts(bins, keyType, domain.rowType), [bins, keyType, domain.rowType]);
    const questions = useMemo((): FitQuestions<FitAsk, Day, Facts, WireResult> => ({
        name: value.fit.name, binding: value.fit, sessions,
        requestType: wire.requestType, resultType: wire.resultType,
        key: askKey, answers: result => askKey(wire.text(result).ask),
        // The day, the question and the scope, and no row (rule 1): the function reads the day's bins for itself.
        request: (ask, within) => ({ day: within.day, ask: wire.keyed(ask), scope: within.scope }),
        // A question naming a bin by a text no key of the bins' type prints as is asked of no fit over them.
        complete: ask => wire.keyed(ask) !== undefined,
        further: (of, base) => value.fit.drafts.includes(bins) ? patchDraft(derivedChanges(base, of, wire.key)) : undefined,
    }), [value.fit, sessions, bins, patchDraft, wire]);
    const fit = useFit(questions, plan, facts);
    const { answer: answered } = fit;
    const answer = useCallback((ask: FitAsk, of?: Day) => {
        const result = answered(ask, of);
        return result === undefined ? undefined : wire.text(result);
    }, [answered, wire]);
    return { ...fit, answer };
}
