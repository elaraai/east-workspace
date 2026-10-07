/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Plan.eventRef(kind, key)` (#1191, `Plan Builder Spec.md` PB10): an event of
 * one of a Plan's event kinds, named for a link's end.
 *
 * Where an event draws is not known when the Plan is built: its row is the
 * resource it is on, and a draft can move it. So the ref names the event, not
 * its row: a run ref whose row is an `entry` of the kind's slot with no path
 * — a row no series makes, since every row's path holds at least its entry's
 * key — and whose run is the event's key. The canvas finds the event's
 * element where it draws.
 *
 * @packageDocumentation
 */

import { East, variant, type ExprType, type StringType, type SubtypeExprOrValue } from "@elaraai/east";
import { PlanRunRefType } from "./types.js";

/** The kind of each ref `Plan.eventRef` made, by the value it returned. */
const EVENT_REFS = new WeakMap<object, string>();

/**
 * Names an event for a link's end — `Plan.eventRef("job", "J-4642")`.
 *
 * @param kind - The event kind's slot name, as the Plan's `events` names it
 * @param key - The event's record key, as text (a String key as it is, any other key as East prints it)
 * @returns The run ref a link's `from` or `to` takes
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { ArrayType, DateTimeType, DictType, East, FloatType, NullType, OptionType, StringType, StructType, VariantType, some, variant } from "@elaraai/east";
 * import { EventStateType, Format, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const PrintPress = StructType({ name: StringType, hall: StringType, sheets_per_hour: FloatType });
 * export const PrintJob = StructType({
 *     title: StringType,
 *     start: OptionType(DateTimeType),
 *     end: OptionType(DateTimeType),
 *     press: OptionType(StringType),
 *     state: EventStateType,
 *     sheets: FloatType,
 *     customer: StringType,
 *     stock: VariantType({ coated: NullType, uncoated: NullType, board: NullType }),
 *     due: OptionType(DateTimeType),
 * });
 * export const PrintStock = StructType({ name: StringType, weekly: ArrayType(FloatType) });
 * export const planPrintPresses = e3.record("plan_print_presses", DictType(StringType, PrintPress), new Map([
 *     ["a1", { name: "Press A1", hall: "Hall A", sheets_per_hour: 12000.0 }],
 *     ["a2", { name: "Press A2", hall: "Hall A", sheets_per_hour: 10000.0 }],
 *     ["a3", { name: "Press A3", hall: "Hall A", sheets_per_hour: 8000.0 }],
 *     ["b1", { name: "Press B1", hall: "Hall B", sheets_per_hour: 15000.0 }],
 *     ["b2", { name: "Press B2", hall: "Hall B", sheets_per_hour: 12000.0 }],
 *     ["b3", { name: "Press B3", hall: "Hall B", sheets_per_hour: 6000.0 }],
 * ]));
 * export const planLinkJobs = e3.record("plan_link_jobs", DictType(StringType, PrintJob), new Map([
 *     ["J-2001", { title: "Handbook covers", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T08:00:00Z")), press: some("b3"), state: variant("confirmed", null), sheets: 12000.0, customer: "Elmway College", stock: variant("board", null), due: some(new Date("2026-10-07T00:00:00Z")) }],
 *     ["J-2002", { title: "Course handbook", start: some(new Date("2026-10-13T06:00:00Z")), end: some(new Date("2026-10-13T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 144000.0, customer: "Elmway College", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *     ["J-2003", { title: "Box sleeves", start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T09:00:00Z")), press: some("b3"), state: variant("proposed", variant("recommended", null)), sheets: 18000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-21T00:00:00Z")) }],
 *     ["J-2004", { title: "Gift boxes", start: some(new Date("2026-10-27T06:00:00Z")), end: some(new Date("2026-10-27T12:00:00Z")), press: some("a1"), state: variant("proposed", variant("recommended", null)), sheets: 48000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
 * ]));
 * export const planLinkJobsPatch = e3.mutation.patch(planLinkJobs);
 * export const planLinkStock = e3.input("plan_link_stock", DictType(StringType, PrintStock), variant("value", new Map([
 *     ["board", { name: "Board", weekly: [40.0, 22.0, 31.0, 18.0] }],
 *     ["coated", { name: "Coated", weekly: [520.0, 410.0, 460.0, 380.0] }],
 *     ["uncoated", { name: "Uncoated", weekly: [300.0, 260.0, 280.0, 240.0] }],
 * ])));
 *
 * const planEventRefs = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const presses = $.let(Record.bind(planPrintPresses, []));
 *         const jobs = $.let(Record.bind(planLinkJobs, [planLinkJobsPatch]));
 *         const stock = $.let(Data.bind(planLinkStock));
 *         // The window's first Monday: each stock reading runs from it, a week apiece.
 *         const first = $.const(new Date("2026-10-05T00:00:00Z"), DateTimeType);
 *         const StockWeek = StructType({ at: DateTimeType, value: OptionType(FloatType) });
 *         const weekly = $.const(East.function([ArrayType(FloatType)], ArrayType(StockWeek), (_$2, readings) =>
 *             East.Array.generate(readings.size(), StockWeek, (_$3, i) => ({ at: first.addWeeks(i), value: some(readings.get(i)) }))));
 *         const axis = $.let(Plan.axis({
 *             window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
 *             resolution: "week",
 *         }));
 *         return (
 *             <Plan
 *                 axis={axis}
 *                 resources={{
 *                     presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name, group: p => p.hall }),
 *                 }}
 *                 events={{
 *                     job: Schedule.events(jobs, {
 *                         name: "Print job", icon: "file-lines",
 *                         title: "title", start: "start", end: "end",
 *                         resource: { field: "press", of: "presses" },
 *                         state: "state", quantity: { field: "sheets", unit: "sheets" },
 *                     }),
 *                 }}
 *                 rows={[
 *                     Plan.over(stock, [
 *                         Plan.series.table(PrintStock, {
 *                             key: "stock", title: "Paper stock", label: s => s.name,
 *                             cells: s => Plan.tableCells(weekly(s.weekly)),
 *                             format: Format.Number({ maximumFractionDigits: 0n }),
 *                         }),
 *                     ]),
 *                 ]}
 *                 links={[
 *                     Plan.link({
 *                         key: "covers", from: Plan.eventRef("job", "J-2001"), to: Plan.eventRef("job", "J-2002"),
 *                         quantity: Plan.quantity(12000.0, { unit: "covers" }),
 *                     }),
 *                     Plan.link({
 *                         key: "sleeves", from: Plan.eventRef("job", "J-2003"), to: Plan.eventRef("job", "J-2004"),
 *                         quantity: Plan.quantity(18000.0, { unit: "sleeves" }),
 *                     }),
 *                 ]}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function createEventRef(kind: string, key: SubtypeExprOrValue<StringType>): ExprType<PlanRunRefType> {
    const ref = East.value({ row: variant("entry", { series: kind, path: [] }), run: key }, PlanRunRefType);
    EVENT_REFS.set(ref, kind);
    return ref;
}

/**
 * The kind an event ref names, when `Plan.eventRef` made it — what a Plan
 * checks its links' ends against.
 *
 * @param ref - A link end
 * @returns The kind's slot name, or `undefined` for any other value
 * @internal
 */
export function eventRefKind(ref: unknown): string | undefined {
    return typeof ref === "object" && ref !== null ? EVENT_REFS.get(ref) : undefined;
}
