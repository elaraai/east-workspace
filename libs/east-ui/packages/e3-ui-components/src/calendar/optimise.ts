/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Optimise in the Calendar (#1409, #1417; `Optimise Spec.md` §5.1, §9.5, R24):
 * the window in view and its backlog as the run's request — every event kind's
 * rows in the window and its backlog by slot and by key, as the session holds
 * them, drafts in place, and every resource kind's rows as context — and the
 * result landed on the calendar's events as one edit: the diff by key, kind
 * by kind, recorded as one step (`ScheduleEditing.record`, origin
 * `optimise`), and the operations the landing draws — an add on the canvas,
 * a change with a ghost where the event was, a remove — kept until Apply.
 *
 * @packageDocumentation
 */

import { DictType, SortedMap, StringType, compareFor, decodeBeast2For, fromEastTypeValue, type EastType } from "@elaraai/east";
import { ScheduleOptimiseRequestTypeFor, ScheduleOptimiseResultTypeFor, scheduleOptimiseRows } from "@elaraai/e3-ui/internal";
import { diffOptimiseRows, mergeOptimiseDiffs, opKey, optimiseIdOf, optimiseKeyOf, optimisePlacementOps, type OptimiseOp } from "../shared/func/optimise-diff.js";
import type { OptimiseCounts } from "../shared/func/use-optimise.js";
import type { ScheduleEditing } from "../shared/schedule/editing.js";
import { rowCodec } from "../shared/schedule/records.js";
import type { CalendarCommands } from "./actions.js";
import type { CalendarItem, CalendarKind, CalendarRange, CalendarValue } from "./model.js";

/** A kind's rows by key, as the request and the result carry them. */
type Rows = SortedMap<unknown, unknown>;

/** The run's request: the window, the run's number, each event kind's rows by slot, and each resource kind's. */
export interface CalendarOptimiseRequest {
    readonly from: Date;
    readonly to: Date;
    readonly run: bigint;
    readonly events: Readonly<Record<string, Rows>>;
    readonly resources: Readonly<Record<string, Rows>>;
}

/** The run's answer: each event kind's rows by slot, complete. */
export interface CalendarOptimiseResult {
    readonly events: Readonly<Record<string, Rows>>;
}

/** One operation a run left on an event, and the run that made it — its provenance's `run #n`. */
export type CalendarOp = OptimiseOp & { readonly run: string };

/**
 * What the runs left on the Calendar's events, until Apply (R17): each
 * operation by event (`opKey`), a later run's over an earlier's on the same
 * event, and where a removed or a moved event stood before its run — its
 * ghost's place.
 */
export interface CalendarOptimised {
    /** Each operation, under `opKey(kind, id)`, with the run that made it. */
    readonly ops: ReadonlyMap<string, CalendarOp>;
    /** Each changed or removed event as it stood before its run, under `opKey(kind, id)`. */
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

/**
 * The request and result types over the Calendar's kinds: what the bound
 * optimiser is called with, as the tag held it to.
 *
 * @param value - The payload
 * @returns The request and result East types
 */
export function calendarOptimiseTypes(value: CalendarValue): { request: EastType; result: EastType } {
    const events = scheduleOptimiseRows(value.events.map((kind) => [kind.key, typesOf(kind)] as const));
    const resources = scheduleOptimiseRows(value.resources.map((kind) => [kind.key, { keyType: fromEastTypeValue(kind.keyType) as EastType, rowType: fromEastTypeValue(kind.rowType) as EastType }] as const));
    return { request: ScheduleOptimiseRequestTypeFor(events, resources), result: ScheduleOptimiseResultTypeFor(events) };
}

/**
 * The run's request (R1, R24, O3, O5): the window, the run's number, every
 * event kind's rows in the window and its backlog by key, as the session
 * holds them — base plus every unapplied draft, every row whatever the rail
 * shows — and every resource kind's rows, read whole.
 *
 * @param value - The payload
 * @param editing - The editing: where each event's row is read, drafts in place
 * @param range - The window in view
 * @param items - The window's events, as read
 * @param backlog - The kinds' backlog, as read
 * @param run - The run's number
 * @returns The request
 */
export function calendarOptimiseRequest(value: CalendarValue, editing: ScheduleEditing, range: CalendarRange, items: readonly CalendarItem[],
    backlog: readonly CalendarItem[], run: number): CalendarOptimiseRequest {
    const events: Record<string, Rows> = {};
    for (const kind of value.events) {
        const { keyType } = typesOf(kind);
        const key = optimiseKeyOf(keyType);
        const decode = rowCodec(kind.editing.entryType);
        const rows: Rows = new SortedMap([], compareFor(keyType) as (a: unknown, b: unknown) => number);
        for (const item of [...items, ...backlog]) {
            if (item.kind !== kind.key) continue;
            const read = editing.read(kind.key, item.key);
            const at = key(item.key);
            if (read === undefined || at === undefined) continue;
            rows.set(at, decode.decode(read.row));
        }
        events[kind.key] = rows;
    }
    const resources: Record<string, Rows> = {};
    for (const kind of value.resources) {
        const keyType = fromEastTypeValue(kind.keyType) as EastType;
        const rowType = fromEastTypeValue(kind.rowType) as EastType;
        const compare = compareFor(keyType) as (a: unknown, b: unknown) => number;
        if (kind.records.type === "none") { resources[kind.key] = new SortedMap([], compare); continue; }
        // The kind's records read whole, as the run starts: its rows by key, as the request carries them.
        const decoded = decodeBeast2For(DictType(keyType, rowType))(kind.records.value()) as ReadonlyMap<unknown, unknown>;
        resources[kind.key] = decoded instanceof SortedMap ? decoded : new SortedMap([...decoded], compare);
    }
    return { from: range.from, to: range.to, run: BigInt(run), events, resources };
}

/**
 * Where an event's day and place are told from, for a ghost: the event as it
 * stood before the run, among the window's events and the backlog.
 */
function itemOf(kind: string, id: string, items: readonly CalendarItem[], backlog: readonly CalendarItem[]): CalendarItem | undefined {
    return items.find((item) => item.kind === kind && item.key === id) ?? backlog.find((item) => item.kind === kind && item.key === id);
}

/**
 * The result landed (R7, R8, R10, §12): diffed against the request by key,
 * kind by kind, and recorded as one step of the history, origin `optimise`.
 * The operations the landing draws are told by place (§9.5): a backlog row
 * the result gives a time is an add on the canvas, a scheduled event it takes
 * back to the backlog a remove, a moved event a change with a ghost at its old
 * slot. A result that answers no rows for a kind the request asked is
 * invalid, and nothing is recorded. A result that changes nothing records
 * nothing and leaves what earlier runs left as it is (R10); one that does
 * lays its operations over theirs.
 *
 * @param value - The payload
 * @param editing - The editing the step is recorded in
 * @param request - The request the result answers
 * @param result - The result
 * @param label - The step's label — `Elara run #7`
 * @param items - The window's events as they stood before the run: where a ghost goes
 * @param backlog - The backlog as it stood before the run
 * @param runText - The run's number, formatted, for the provenance
 * @param before - What earlier runs left on the events, still the session's drafts
 * @returns What the run counted, and what the runs have left on the events — unchanged by a run that changed nothing; `undefined` for an invalid result, or one the session would not take
 */
export function landCalendarOptimise(value: CalendarValue, editing: ScheduleEditing, request: CalendarOptimiseRequest, result: CalendarOptimiseResult,
    label: string, items: readonly CalendarItem[], backlog: readonly CalendarItem[], runText: string, before: CalendarOptimised | undefined,
): { counts: OptimiseCounts; optimised: CalendarOptimised | undefined } | undefined {
    const diffs = [];
    let backlogChanged = false;
    const previous = new Map<string, CalendarItem>();
    for (const kind of value.events) {
        const before = request.events[kind.key];
        const after = result.events[kind.key];
        if (before === undefined || after === undefined) return undefined;
        const { keyType, rowType } = typesOf(kind);
        const startField = kind.schedule.start;
        const unscheduled = (row: unknown): boolean => {
            const start = (row as Record<string, { type: string }>)[startField];
            return start !== undefined && start.type === "none";
        };
        const diff = optimisePlacementOps(diffOptimiseRows(kind.key, rowType, optimiseIdOf(keyType), before as ReadonlyMap<unknown, unknown>, after as ReadonlyMap<unknown, unknown>),
            (row) => !unscheduled(row));
        diffs.push(diff);
        for (const [key, op] of diff.ops) {
            const id = key.slice(kind.key.length + 1);
            const was = itemOf(kind.key, id, items, backlog);
            if (was !== undefined && op.op !== "add") previous.set(key, was);
            if ((was !== undefined && was.start.type === "none") || ("row" in op && unscheduled(op.row))) backlogChanged = true;
        }
    }
    const merged = mergeOptimiseDiffs(diffs);
    if (merged.changes.length === 0) return { counts: merged.counts, optimised: undefined };
    if (!editing.record(merged.changes, "optimise", label)) return undefined;
    // This run's operations over the earlier runs': an event it touched again is its, with where it stood before this run.
    const ops = new Map<string, CalendarOp>(before?.ops ?? []);
    for (const [key, op] of merged.ops) ops.set(key, { ...op, run: runText });
    const kept = new Map<string, CalendarItem>(before?.previous ?? []);
    for (const key of merged.ops.keys()) kept.delete(key);
    for (const [key, was] of previous) kept.set(key, was);
    return { counts: merged.counts, optimised: { ops, previous: kept, backlogChanged } };
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
