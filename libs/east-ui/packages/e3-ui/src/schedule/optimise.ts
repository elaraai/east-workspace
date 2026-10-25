/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The optimiser's request and answer over a builder's event kinds (#1409,
 * `Optimise Spec.md` §5.1): what a Calendar's and a Plan's `optimise` asks and
 * answers — the window in view, the run number, every event kind's rows in the
 * window and its backlog by slot and by key, and every resource kind's rows as
 * context; the answer the events, complete. The types are constructors over
 * the kinds' rows by slot: the same kinds give the same East type, which the
 * tag holds the bound function to.
 *
 * @packageDocumentation
 */

import { DateTimeType, DictType, IntegerType, StringType, StructType, isTypeEqual, printType, type EastType, type ExprType } from "@elaraai/east";
import { FuncBindingType } from "../bind/func.js";
import { optimiseBinding } from "../utils/optimise.js";

/**
 * The kinds' rows by slot, as an app writes them: each slot's row type, for a
 * kind whose record is keyed by String, or its record type `DictType(K, R)`,
 * for one keyed otherwise.
 */
export type ScheduleOptimiseRows = Readonly<Record<string, EastType>>;

/**
 * The kinds' records by slot, as the East types the rows given make them: a
 * row type's slot a String-keyed record of it, a Dict type's slot the record
 * as it is.
 *
 * @typeParam Rows - The kinds' rows by slot
 */
export type ScheduleOptimiseRecordsOf<Rows extends ScheduleOptimiseRows> = StructType<{
    [S in keyof Rows & string]: Rows[S] extends DictType<infer K, infer V> ? DictType<K, V> : DictType<StringType, Rows[S]>;
}>;

/** The kinds' records by slot on the wire: `{ [slot]: DictType(K, R) }`, the slots in name order. */
export type ScheduleOptimiseRecordsType = ScheduleOptimiseRecordsOf<ScheduleOptimiseRows>;

/**
 * An optimiser's request over event kinds `E` and resource kinds `S` — what
 * {@link ScheduleOptimiseRequestTypeFor} constructs.
 *
 * @typeParam E - The event kinds' rows by slot
 * @typeParam S - The resource kinds' rows by slot
 */
export type ScheduleOptimiseRequestType<E extends ScheduleOptimiseRows = ScheduleOptimiseRows, S extends ScheduleOptimiseRows = ScheduleOptimiseRows> = StructType<{
    from: DateTimeType; to: DateTimeType; run: IntegerType; events: ScheduleOptimiseRecordsOf<E>; resources: ScheduleOptimiseRecordsOf<S>;
}>;

/**
 * An optimiser's answer over event kinds `E` — what
 * {@link ScheduleOptimiseResultTypeFor} constructs.
 *
 * @typeParam E - The event kinds' rows by slot
 */
export type ScheduleOptimiseResultType<E extends ScheduleOptimiseRows = ScheduleOptimiseRows> = StructType<{ events: ScheduleOptimiseRecordsOf<E> }>;

/**
 * The kinds' records by slot: each a `Dict` of the kind's rows by its key — a
 * row type given stands for a String-keyed kind's record, a Dict type for the
 * kind's record as it is — the slots in name order, so the same kinds give the
 * same type however they are listed.
 *
 * @param rows - The kinds' rows by slot
 * @returns The records by slot
 */
function recordsOf(rows: ScheduleOptimiseRows): ScheduleOptimiseRecordsType {
    return StructType(Object.fromEntries(Object.keys(rows).sort().map((slot) => {
        const given = rows[slot]!;
        return [slot, given.type === "Dict" ? given : DictType(StringType, given)];
    }))) as ScheduleOptimiseRecordsType;
}

/**
 * One request to the app's optimiser (#1409): the window in view and the
 * kinds' rows, as drafted, for the optimiser to schedule or improve — the
 * Elara eye's one call.
 *
 * @typeParam E - The event kinds' rows by slot
 * @typeParam S - The resource kinds' rows by slot
 * @param events - The event kinds' rows by slot: each slot's row type (a String-keyed kind's), or its record type `DictType(K, R)`
 * @param resources - The resource kinds' rows by slot, the same way; none by default
 * @returns `StructType({ from, to, run, events, resources })`
 *
 * @property from - The window's start
 * @property to - The window's end, exclusive
 * @property run - The run's number, from 1 per builder per browser
 * @property events - Each event kind's rows by slot, by key: the kind's rows in the window and its backlog's, the app's own rows as the session holds them — the base with every unapplied draft in place, every row whatever the rail shows
 * @property resources - Each resource kind's rows by slot, by key, as context
 */
export function ScheduleOptimiseRequestTypeFor<E extends ScheduleOptimiseRows, S extends ScheduleOptimiseRows = Record<never, never>>(
    events: E, resources?: S,
): ScheduleOptimiseRequestType<E, S> {
    return StructType({
        from: DateTimeType, to: DateTimeType, run: IntegerType, events: recordsOf(events), resources: recordsOf(resources ?? {}),
    }) as unknown as ScheduleOptimiseRequestType<E, S>;
}

/**
 * The app's optimiser's answer (#1409): every event kind's rows, complete, by
 * slot and by key. The builder diffs it against the request by key — a key the
 * request did not hold is an event added, one it held with another row an
 * event changed, one missing an event removed — and records the diff as one
 * step of its history.
 *
 * @typeParam E - The event kinds' rows by slot
 * @param events - The event kinds' rows by slot, as the request took them
 * @returns `StructType({ events })`
 *
 * @property events - Each event kind's rows by slot, by key, complete; a new event's key the optimiser's own
 */
export function ScheduleOptimiseResultTypeFor<E extends ScheduleOptimiseRows>(events: E): ScheduleOptimiseResultType<E> {
    return StructType({ events: recordsOf(events) }) as unknown as ScheduleOptimiseResultType<E>;
}

/** A kind's key and row types: what `Schedule.events` and `Schedule.resources` hold of their records. */
interface ScheduleKeyed {
    /** The kind's key type. */
    readonly keyType: EastType;
    /** The kind's row type. */
    readonly rowType: EastType;
}

/**
 * The kinds' records by slot, from the kinds themselves: what a builder's
 * request and answer are built over, and the renderer builds a run's request
 * type from.
 *
 * @param kinds - The kinds, by slot
 * @returns Each slot's record type, `DictType(K, R)`
 * @internal
 */
export function scheduleOptimiseRows(kinds: readonly (readonly [string, ScheduleKeyed])[]): ScheduleOptimiseRows {
    return Object.fromEntries(kinds.map(([slot, kind]) => [slot, DictType(kind.keyType, kind.rowType)]));
}

/**
 * The kinds' rows by slot, printed as an app writes them: a String-keyed
 * kind's row type, another kind's record type.
 *
 * @param records - The records by slot
 * @returns `{ job: .Struct […], … }`
 */
function printRows(records: ScheduleOptimiseRecordsType): string {
    const fields = records.fields as Record<string, DictType<EastType, EastType>>;
    return `{ ${Object.entries(fields).map(([slot, record]) => `${slot}: ${printType(record.key.type === "String" ? record.value : record)}`).join(", ")} }`;
}

/**
 * A Calendar's or a Plan's `optimise` binding, checked (#1409): `Func.bind` of
 * an `e3.function` from `OptimiseRequest(E, S)` to `OptimiseResult(E)` over the
 * builder's kinds' rows by slot.
 *
 * @param builder - The builder, as the refusals name it
 * @param optimise - What the app passed as `optimise`
 * @param events - The event kinds, by slot
 * @param resources - The resource kinds, by slot
 * @returns The binding's descriptor, which names the function
 * @throws {Error} When it is not a `Func.bind` handle, or its function asks or answers another type, naming it — one bound
 *   over the same slots' other rows naming both
 * @internal
 */
export function scheduleOptimiseBinding(
    builder: "Calendar" | "Plan",
    optimise: unknown,
    events: readonly (readonly [string, ScheduleKeyed])[],
    resources: readonly (readonly [string, ScheduleKeyed])[],
): ExprType<typeof FuncBindingType> {
    const eventRows = scheduleOptimiseRows(events);
    const resourceRows = scheduleOptimiseRows(resources);
    const request: ScheduleOptimiseRequestType = ScheduleOptimiseRequestTypeFor(eventRows, resourceRows);
    const result: ScheduleOptimiseResultType = ScheduleOptimiseResultTypeFor(eventRows);
    const slotsOf = (s: StructType): string => Object.keys(s.fields).sort().join("\u0000");
    const records = (s: StructType): boolean => Object.values(s.fields as Record<string, EastType>).every((f) => f.type === "Dict");
    return optimiseBinding(optimise, {
        builder, request, result,
        signature: `from ${builder}.Types.OptimiseRequest(E, S) to ${builder}.Types.OptimiseResult(E), E the event kinds' row types by slot and S the resource kinds'`,
        names: { request: `${builder}.Types.OptimiseRequest`, result: `${builder}.Types.OptimiseResult` },
        rows: { request: `${printRows(request.fields.events)}, ${printRows(request.fields.resources)}`, result: printRows(result.fields.events) },
        noun: { theirs: "event rows", ours: "the kinds' rows" }, of: "the kinds' row types by slot",
        otherRows: (asked) => {
            // A request of this shape over other rows: the same slots, each a record, another row type in one of them.
            if (asked.type !== "Struct") return undefined;
            const theirEvents = asked.fields["events"], theirResources = asked.fields["resources"];
            if (theirEvents?.type !== "Struct" || theirResources?.type !== "Struct") return undefined;
            if (slotsOf(theirEvents) !== slotsOf(request.fields.events) || slotsOf(theirResources) !== slotsOf(request.fields.resources)) return undefined;
            if (!records(theirEvents) || !records(theirResources)) return undefined;
            const rebuilt = ScheduleOptimiseRequestTypeFor(theirEvents.fields as ScheduleOptimiseRows, theirResources.fields as ScheduleOptimiseRows);
            return isTypeEqual(asked, rebuilt)
                ? `${printRows(theirEvents as ScheduleOptimiseRecordsType)}, ${printRows(theirResources as ScheduleOptimiseRecordsType)}`
                : undefined;
        },
    });
}
