/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The optimiser's request and answer over a builder's event kinds (#1409,
 * east-workspace#1622): what a Calendar's and a Plan's `optimise` asks and
 * answers. The request is the window in view and what kind of period it is,
 * the run's number and the rail's narrowing — no event, no resource, nothing the page read: the function
 * reads the events it needs through its record's indexes, the page's unsaved
 * edits laid over them, and the data behind the resources. The answer is a
 * patch of each event kind's record, by slot.
 *
 * @packageDocumentation
 */

import {
    DateTimeType, DictType, IntegerType, PatchType, StructType, printType,
    type EastType, type ExprType, type PatchTypeOf, type StringType,
} from "@elaraai/east";
import { FuncBindingType } from "../bind/func.js";
import { OptimisePeriodType, OptimiseSliceType, optimiseBinding, optimisedRecordType } from "../utils/optimise.js";

/** The event kinds' records by slot, as an app writes them: each slot's record type, `DictType(K, R)`. */
export type ScheduleOptimiseRecords = Readonly<Record<string, DictType<EastType, EastType>>>;

/**
 * One request to the app's optimiser (#1409, east-workspace#1622): the window
 * in view, for the optimiser to schedule or improve — the Elara eye's one call.
 * It carries no row. The function lists each event kind's record it reads in
 * its `drafts`, and reads it — through an index, over the window it chooses —
 * with the page's unsaved edits laid over it.
 *
 * @property from - The window's start
 * @property to - The window's end, exclusive
 * @property period - What kind of period the planner is looking at ({@link OptimisePeriodType}): the period a Calendar
 *   shows, `from` and `to` its start and end; the unit a Plan's axis is zoomed to, `from` and `to` its window
 * @property run - The run's number, from 1 per builder per browser
 * @property slice - The rail's narrowing: each source's, by the source's name ({@link OptimiseSliceType}), the page's
 *   scope among it; empty for a builder with no rail
 */
export const ScheduleOptimiseRequestType = StructType({
    from: DateTimeType, to: DateTimeType, period: OptimisePeriodType, run: IntegerType, slice: OptimiseSliceType,
});
/** Type representing {@link ScheduleOptimiseRequestType}. */
export type ScheduleOptimiseRequestType = typeof ScheduleOptimiseRequestType;

/**
 * An optimiser's answer over event kinds' records `E` — what
 * {@link ScheduleOptimiseResultTypeFor} constructs.
 *
 * @typeParam E - The event kinds' records by slot
 */
export type ScheduleOptimiseResultType<E extends ScheduleOptimiseRecords = ScheduleOptimiseRecords> = StructType<{
    events: StructType<{ [S in keyof E & string]: PatchTypeOf<E[S]> }>;
}>;

/**
 * The app's optimiser's answer (#1409, east-workspace#1622): a patch of each
 * event kind's record, by slot — for each key, an event inserted, deleted, or
 * updated by a patch of its row. It is what `East.diff` gives of the events
 * before and after, and what a Save sends. A kind the run leaves as it is
 * answers `East.diff` of the same rows twice, an unchanged patch.
 *
 * @typeParam E - The event kinds' records by slot
 * @param events - Each event kind's record type by slot, `DictType(K, R)`: `{ job: JobsType }`
 * @returns `StructType({ events })`, the slots in name order
 * @throws {Error} Naming a slot given a type that is no record of events by key
 *
 * @property events - Each event kind's patch by slot; a new event's key is the optimiser's own
 */
export function ScheduleOptimiseResultTypeFor<E extends ScheduleOptimiseRecords>(events: E): ScheduleOptimiseResultType<E> {
    // A list, in name order: an object would list a slot named like an integer first (#1574)
    return StructType({
        events: StructType(Object.keys(events).sort().map((slot): readonly [string, EastType] => {
            const record = optimisedRecordType(events[slot], (given) =>
                `OptimiseResult: \`${slot}\` is given ${given} — a result takes each event kind's record type, a Dict of its rows by key: { ${slot}: DictType(StringType, Row) }`);
            return [slot, PatchType(record)];
        })),
    }) as unknown as ScheduleOptimiseResultType<E>;
}

/** A kind's record: what `Schedule.events` holds of it. */
interface ScheduleEdited {
    /** The kind's key type. */
    readonly keyType: EastType;
    /** The kind's row type. */
    readonly rowType: EastType;
    /** The record's name in the deployed package, as its binding carries it. */
    readonly record: ExprType<StringType>;
}

/**
 * The event kinds' records by slot, from the kinds themselves: what a
 * builder's answer is built over, and the renderer lands a run's answer by.
 *
 * @param kinds - The event kinds, by slot
 * @returns Each slot's record type, `DictType(K, R)`
 * @internal
 */
export function scheduleOptimiseRecords(kinds: readonly (readonly [string, Pick<ScheduleEdited, "keyType" | "rowType">])[]): ScheduleOptimiseRecords {
    return Object.fromEntries(kinds.map(([slot, kind]) => [slot, DictType(kind.keyType, kind.rowType)]));
}

/**
 * A Calendar's or a Plan's `optimise` binding, checked (#1409,
 * east-workspace#1622): `Func.bind` of an `e3.function` from `OptimiseRequest`
 * to `OptimiseResult(E)` over the builder's event kinds' records by slot,
 * which lists in `drafts` each of those records it reads.
 *
 * @param builder - The builder, as the refusals name it
 * @param optimise - What the app passed as `optimise`
 * @param events - The event kinds, by slot
 * @returns The binding's descriptor, which names the function; evaluated, it fails where the function reads an event
 *   kind's record and does not list it in `drafts`
 * @throws {Error} When it is not a `Func.bind` handle, or its function asks or answers another type, naming it
 * @internal
 */
export function scheduleOptimiseBinding(
    builder: "Calendar" | "Plan",
    optimise: unknown,
    events: readonly (readonly [string, ScheduleEdited])[],
): ExprType<typeof FuncBindingType> {
    const records = scheduleOptimiseRecords(events);
    const result: ScheduleOptimiseResultType = ScheduleOptimiseResultTypeFor(records);
    const given = `{ ${Object.keys(records).sort().map((slot) => `${slot}: ${printType(records[slot]!)}`).join(", ")} }`;
    return optimiseBinding(optimise, {
        builder, request: ScheduleOptimiseRequestType, result,
        signature: `from ${builder}.Types.OptimiseRequest to ${builder}.Types.OptimiseResult(E), E the event kinds' record types by slot`,
        names: { request: `${builder}.Types.OptimiseRequest`, result: `${builder}.Types.OptimiseResult(${given})` },
        edits: events.map(([, kind]) => kind.record),
    });
}
