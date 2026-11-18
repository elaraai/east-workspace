/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a drop on the Plan would do, as its one `canDrop` is asked it (#1541,
 * U7): the candidate (`Plan.Types.Candidate`) of an event kind's gesture and
 * of a gesture on a data series' row, made here and nowhere else, and the
 * veto asked of it — its refusal's words, which the ghost says.
 *
 * A veto that throws lets the drop land, as every target's does: a check that
 * is broken must not stop the surface. Its answers are kept while the check is
 * the same function, by the candidate as East prints it, so a drag resting
 * over a bucket asks once — the drag layer's own rule for every East `canDrop`
 * (east-ui-components' `keptDropCheck`).
 *
 * @packageDocumentation
 */

import { none, printFor, some, variant, type ValueTypeOf, type option } from "@elaraai/east";
import { keptDropCheck } from "@elaraai/east-ui-components/internal";
import { PlanCandidateType } from "@elaraai/e3-ui/internal";
import type { PlanInstantValue } from "../instant.js";
import type { RowKey } from "../plan-state.js";
import { rowIdOfKey, rowKeyOf, type PlanRowId } from "../row-key.js";

/** What a drop would do: a `Plan.Types.Candidate`, decoded. */
export type PlanCandidateValue = ValueTypeOf<typeof PlanCandidateType>;
/** The Plan's drop veto, decoded: a candidate to its refusal's words, or `none` to let it land. */
export type PlanCanDropFn = (candidate: PlanCandidateValue) => option<string>;
/** What a drag does. */
export type PlanCandidateGesture = PlanCandidateValue["gesture"];
/** What is dragged. */
export type PlanCandidateFrom = PlanCandidateValue["from"];

/** Where a candidate would put what is dragged: the row, its lane, and its instants there; none of them for a `remove`. */
export interface PlanCandidatePlace {
    /** The row it would land on. */
    readonly row?: PlanRowId | undefined;
    /** The lane it would sit in, where its row has lanes. */
    readonly lane?: string | undefined;
    /** When it would start there. */
    readonly start?: PlanInstantValue | undefined;
    /** When it would end there: a point's instant again. Left out for a card whose item its series makes as it lands. */
    readonly end?: PlanInstantValue | undefined;
}

const opt = <T,>(value: T | undefined): option<T> => (value === undefined ? none : some(value));

/**
 * What a drop of the event kinds' would do: a template, a backlog card or an
 * author's card landing, or an event's element moved, resized or taken off the
 * canvas.
 *
 * @param gesture - What the drag does
 * @param kind - The event kind it lands in or leaves, by its slot
 * @param from - What is dragged
 * @param place - Where it would land: the resource's landing row (or the kind's Unassigned row), its lane and its times
 * @param onto - The event it lands on, where an author's card lands on one
 * @returns The candidate
 */
export function eventCandidate(
    gesture: PlanCandidateGesture, kind: string, from: PlanCandidateFrom, place: PlanCandidatePlace = {},
    onto?: { readonly kind: string; readonly key: string },
): PlanCandidateValue {
    return {
        gesture, from,
        into: variant("kind", kind),
        onto: onto === undefined ? none : some(variant("event", { kind: onto.kind, key: onto.key })),
        row: opt(place.row), lane: opt(place.lane), start: opt(place.start), end: opt(place.end),
    };
}

/**
 * An item of `data`'s, as a candidate names it: the row it is in, by the row's
 * id as East prints it, and its key there. A check reads the row back
 * (`Plan.Types.RowId`) and compares it with a row's own.
 *
 * @remarks
 * The canvas keys a row by its id's text, and a row repeating an earlier
 * row's id by that text with `#n` after it, which is no id: a candidate names
 * the id.
 *
 * @param rowKey - The canvas's key for the row
 * @param key - The item's key in its row
 * @returns The reference
 */
export function itemRef(rowKey: RowKey, key: string): { readonly row: string; readonly key: string } {
    const id = rowIdOfKey(rowKey);
    return { row: id === undefined ? rowKey : rowKeyOf(id), key };
}

/**
 * What a drop on a data series' row would do: a card landing, or one of the
 * series' items moved or resized.
 *
 * @param gesture - What the drag does
 * @param series - The data series it lands in, by its key
 * @param from - What is dragged: a library tab's card, or an item
 * @param place - Where it would land: the row, and its instants there
 * @param onto - The item it lands on ({@link itemRef}), where it lands on one
 * @returns The candidate
 */
export function itemCandidate(
    gesture: PlanCandidateGesture, series: string, from: PlanCandidateFrom, place: PlanCandidatePlace = {},
    onto?: { readonly row: string; readonly key: string },
): PlanCandidateValue {
    return {
        gesture, from,
        into: variant("series", series),
        onto: onto === undefined ? none : some(variant("item", { row: onto.row, key: onto.key })),
        row: opt(place.row), lane: opt(place.lane), start: opt(place.start), end: opt(place.end),
    };
}

/** The Plan's veto over what a drop would do. */
export interface PlanVeto {
    /**
     * Why a drop is refused.
     *
     * @param candidate - What the drop would do
     * @returns The refusal's words; `undefined` where it lands
     */
    refusal(candidate: PlanCandidateValue): string | undefined;
}

const printCandidate = printFor(PlanCandidateType);

/**
 * A Plan's veto over its `canDrop`, its answers kept while the check is the
 * same function: a check is a pure East function, so its answer to a
 * candidate moves only when the function does.
 *
 * @param canDrop - The Plan's `canDrop`, decoded; `undefined` for none
 * @returns The veto; `undefined` where the Plan has no check, and every drop its rows take lands
 */
export function createPlanVeto(canDrop: PlanCanDropFn | undefined): PlanVeto | undefined {
    if (canDrop === undefined) return undefined;
    const ask = keptDropCheck(canDrop, printCandidate, none, "[Plan] canDrop");
    return {
        refusal(candidate) {
            const answer = ask(candidate);
            return answer.type === "some" ? answer.value : undefined;
        },
    };
}
