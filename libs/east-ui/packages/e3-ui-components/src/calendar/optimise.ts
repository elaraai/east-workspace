/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Optimise in the Calendar (#1409, #1417, east-workspace#1622; `Optimise
 * Spec.md` §5.1, §9.5, R24): the run's request — the window in view and what
 * kind of period it is, the run's number and the rail's narrowing, and no row
 * — and its answer, a patch of each event kind's record by slot, landed on the
 * calendar's events as one edit: each key the patches touch, on the row the
 * page holds, kind by kind, recorded as one step (`ScheduleEditing.record`,
 * origin `optimise`), and the operations the landing draws — an add on the
 * canvas, a change with a ghost where the event was, a remove — kept until
 * Apply. An event the answer changes that the page does not hold is read by
 * its key first (rule 8); one it changes outside the window it was asked of
 * refuses the answer whole (rule 11).
 *
 * @packageDocumentation
 */

import { StringType, equalFor, fromEastTypeValue, variant, type EastType, type ValueTypeOf, type option } from "@elaraai/east";
import { ScheduleOptimiseRequestType, ScheduleOptimiseResultTypeFor, scheduleOptimiseRecords, type ScheduleOptimiseRecords } from "@elaraai/e3-ui/internal";
import { opKey, opKeyUnder, recordOptimiseRun, scheduleOptimiseRecorder, type OptimiseLanded, type OptimiseOp } from "../shared/func/optimise-diff.js";
import type { OptimiseSlice } from "../shared/func/optimise-slice.js";
import type { OptimiseMissing, OptimiseRefused } from "../shared/func/use-optimise.js";
import type { ScheduleEditing } from "../shared/schedule/editing.js";
import { landOptimiseEvents } from "../shared/schedule/optimise-events.js";
import type { CalendarCommands } from "./actions.js";
import { viewPeriod, type CalendarItem, type CalendarKind, type CalendarRange, type CalendarValue, type CalendarView } from "./model.js";

/** The run's request: the window, what kind of period it is, the run's number and the rail's narrowing. */
export type CalendarOptimiseRequest = ValueTypeOf<typeof ScheduleOptimiseRequestType>;

/** The run's answer: each event kind's patch of its record, by slot. */
export interface CalendarOptimiseResult {
    readonly events: Readonly<Record<string, unknown>>;
}

/** One operation a run left on an event, and the run that made it — its provenance's `run #n`. */
export type CalendarOp = OptimiseOp & { readonly run: string };

/** An event's key, as East compares its text. */
const sameKey = equalFor(StringType);

/**
 * What the runs left on the Calendar's events, until Apply (R17): each
 * operation by event (`opKey`), a later run's over an earlier's on the same
 * event, and where a removed or a moved event stood before its run — its
 * ghost's place. Each is kept under the key its event stands under now: an
 * event a run's step moved under the key its fields build takes them with it
 * (east-workspace#1709, ruling 14).
 */
export interface CalendarOptimised {
    /** Each operation, under `opKey(kind, id)` of the key its event stands under now, with the run that made it. */
    readonly ops: ReadonlyMap<string, CalendarOp>;
    /**
     * Each changed or removed event as it stood before its run — its place and its words — under the key its operation
     * is kept under, and named by the key it stands under now: what its ghost is drawn from, beside the event now.
     */
    readonly previous: ReadonlyMap<string, CalendarItem>;
    /** Whether the latest run moved an event into or out of the backlog: the Backlog tab's count flashes. */
    readonly backlogChanged: boolean;
}

/** A kind's key and row types, from the kind on the wire. */
function typesOf(kind: { readonly editing: CalendarKind["editing"] }): { keyType: EastType; rowType: EastType } {
    return {
        keyType: kind.editing.keyType.type === "some" ? fromEastTypeValue(kind.editing.keyType.value) as EastType : StringType,
        rowType: fromEastTypeValue(kind.editing.entryType) as EastType,
    };
}

/** What the bound optimiser is called with, as the tag held it to, and each event kind's record type by slot. */
export interface CalendarOptimiseTypes {
    readonly request: EastType;
    readonly result: EastType;
    /** Each event kind's record type, `Dict<K, R>`, by slot: what its patch is read by. */
    readonly records: ScheduleOptimiseRecords;
}

/**
 * The request and result types over the Calendar's kinds: what the bound
 * optimiser is called with, as the tag held it to.
 *
 * @param value - The payload
 * @returns The request and result East types, and each kind's record type
 */
export function calendarOptimiseTypes(value: CalendarValue): CalendarOptimiseTypes {
    const records = scheduleOptimiseRecords(value.events.map((kind) => [kind.key, typesOf(kind)] as const));
    return { request: ScheduleOptimiseRequestType, result: ScheduleOptimiseResultTypeFor(records), records };
}

/**
 * The run's request (R1, R24, O3; east-workspace#1622, rule 1): the window in
 * view and the period it shows — a day on the resources layout, whatever its
 * period — the run's number and the rail's narrowing. No row: the function
 * reads the events it needs, the page's unsaved edits laid over them.
 *
 * @param range - The window in view
 * @param view - The view: its layout and its period
 * @param slice - Each rail source's narrowing now
 * @param run - The run's number
 * @returns The request
 */
export function calendarOptimiseRequest(range: CalendarRange, view: Pick<CalendarView, "layout" | "period">, slice: OptimiseSlice, run: number): CalendarOptimiseRequest {
    return { from: range.from, to: range.to, period: variant(viewPeriod(view), null), run: BigInt(run), slice };
}

/**
 * The result landed (R7, R8, R10, §12; east-workspace#1622, rules 7, 8, 10,
 * 11): each kind's patch landed key by key on the events the page holds, and
 * recorded as one step of the history, origin `optimise`. The operations the
 * landing draws are told by place (§9.5): a backlog row the answer gives a
 * time is an add on the canvas, a scheduled event it takes back to the backlog
 * a remove, a moved event a change with a ghost at its old slot. An answer
 * with no patch for a kind, or one that does not fit the events the page
 * holds, is invalid, and nothing is recorded. One that changes an event
 * outside the window it was asked of — where the event stood, or where the
 * answer puts it — is refused whole, naming the event. One that touches an
 * event the page does not hold names it, to be read by its key
 * (`landOptimiseEvents`, shared with the Plan). A result that changes nothing
 * records nothing and leaves what earlier runs left as it is (R10); one that
 * does lays its operations over theirs. An answer is an edit like any other
 * (east-workspace#1709, ruling 14): an event whose key it changes moves under
 * the key its fields build, with what the runs left on it; one a row's key
 * refuses records nothing, saying why.
 *
 * @param value - The payload
 * @param types - Each kind's record type by slot
 * @param editing - The editing the step is recorded in
 * @param held - A row as the page holds it, read by its key where it holds none: what the answer lands on
 * @param request - The request the result answers
 * @param result - The result
 * @param label - The step's label — `Elara run #7`
 * @param period - The window's words, which a refusal names
 * @param runText - The run's number, formatted, for the provenance
 * @param before - What earlier runs left on the events, still the session's drafts
 * @returns What the run counted, and what the runs have left on the events — unchanged by a run that changed nothing;
 *   the events to read first; a refusal, naming the event or the key refused; `undefined` for an invalid result, or one
 *   the session would not take
 */
export function landCalendarOptimise(value: CalendarValue, types: CalendarOptimiseTypes, editing: ScheduleEditing,
    held: (kind: string, id: string) => option<unknown> | undefined, request: CalendarOptimiseRequest,
    result: CalendarOptimiseResult, label: string, period: string, runText: string, before: CalendarOptimised | undefined,
): OptimiseLanded<CalendarOptimised> | OptimiseMissing | OptimiseRefused | undefined {
    const landed = landOptimiseEvents<CalendarItem>({
        kinds: value.events.map((kind) => kind.key), records: types.records, events: result.events, held,
        eventOf: (kind, id, row) => editing.eventOf(kind, id, row)?.item, window: request, period,
    });
    if (landed === undefined || "missing" in landed || "refused" in landed) return landed;
    const { diff, told, backlogChanged } = landed;
    return recordOptimiseRun(diff, scheduleOptimiseRecorder(editing), label, (under) => {
        // An event as it stood, named by the key it stands under now: what its ghost is told from the event by.
        const named = (was: CalendarItem): CalendarItem => {
            const key = under(was.kind, was.key);
            return sameKey(key, was.key) ? was : { ...was, key };
        };
        // This run's operations over the earlier runs', each under the key its event stands under now: an event it
        // touched again is its, with where it stood before this run — a changed or a removed event's ghost's place.
        const ops = new Map<string, CalendarOp>([...(before?.ops ?? [])].map(([key, op]) => [opKeyUnder(key, under), op]));
        const previous = new Map<string, CalendarItem>([...(before?.previous ?? [])].map(([key, was]) => [opKeyUnder(key, under), named(was)]));
        for (const [key, op] of diff.ops) {
            const at = opKeyUnder(key, under);
            ops.set(at, { ...op, run: runText });
            previous.delete(at);
            const was = told.get(key)?.was;
            if (was !== undefined && op.op !== "add") previous.set(at, named(was));
        }
        return { ops, previous, backlogChanged };
    });
}

/** The operation a run left on an event, if any, with the run that made it: what its block draws and its hover says. */
export function calendarOpOf(optimised: CalendarOptimised | undefined, item: Pick<CalendarItem, "kind" | "key">): CalendarOp | undefined {
    return optimised?.ops.get(opKey(item.kind, item.key));
}

/**
 * The commands while a run is out (R2): every gesture refused with the one
 * reason, the session they read kept — so the views keep drawing their drafts,
 * and the inspector stays live, while nothing is written.
 *
 * @param commands - The commands
 * @param refusal - Why a gesture is refused — `Elara is optimising Oct 5 – 9`
 * @returns The commands, locked
 */
export function lockCalendarCommands(commands: CalendarCommands, refusal: string): CalendarCommands {
    return {
        editing: commands.editing,
        place: () => refusal,
        move: () => refusal,
        remove: () => undefined,
        unschedule: () => refusal,
        duplicate: () => refusal,
        status: () => refusal,
        field: () => undefined,
        patch: () => undefined,
    };
}
