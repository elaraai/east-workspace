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
 * export const PrintCentre = StructType({ name: StringType });
 * export const PrintPlates = StructType({ title: StringType, at: DateTimeType, setter: StringType });
 * export const PrintBinding = StructType({ title: StringType, start: DateTimeType, end: DateTimeType, line: StringType, state: EventStateType });
 * export const PrintDelivery = StructType({ title: StringType, at: DateTimeType, bay: StringType });
 * export const planPrintPresses = e3.record("plan_print_presses", DictType(StringType, PrintPress), new Map([
 *     ["a1", { name: "Press A1", hall: "Hall A", sheets_per_hour: 12000.0 }],
 *     ["a2", { name: "Press A2", hall: "Hall A", sheets_per_hour: 10000.0 }],
 *     ["a3", { name: "Press A3", hall: "Hall A", sheets_per_hour: 8000.0 }],
 *     ["b1", { name: "Press B1", hall: "Hall B", sheets_per_hour: 15000.0 }],
 *     ["b2", { name: "Press B2", hall: "Hall B", sheets_per_hour: 12000.0 }],
 *     ["b3", { name: "Press B3", hall: "Hall B", sheets_per_hour: 6000.0 }],
 * ]));
 * export const planLinkStock = e3.input("plan_link_stock", DictType(StringType, PrintStock), variant("value", new Map([
 *     ["board", { name: "Board", weekly: [40.0, 22.0, 31.0, 18.0] }],
 *     ["coated", { name: "Coated", weekly: [520.0, 410.0, 460.0, 380.0] }],
 *     ["uncoated", { name: "Uncoated", weekly: [300.0, 260.0, 280.0, 240.0] }],
 * ])));
 * export const planLinkSetters = e3.record("plan_link_setters", DictType(StringType, PrintCentre), new Map([
 *     ["ps", { name: "Platesetter" }],
 * ]));
 * export const planLinkLines = e3.record("plan_link_lines", DictType(StringType, PrintCentre), new Map([
 *     ["fold", { name: "Folder" }],
 *     ["bind", { name: "Binder" }],
 * ]));
 * export const planLinkBays = e3.record("plan_link_bays", DictType(StringType, PrintCentre), new Map([
 *     ["bay", { name: "Dispatch bay" }],
 * ]));
 * export const planLinkPlates = e3.record("plan_link_plates", DictType(StringType, PrintPlates), new Map([
 *     ["P-01", { title: "Catalogue plates", at: new Date("2026-10-05T12:00:00Z"), setter: "ps" }],
 * ]));
 * export const planLinkPlatesPatch = e3.mutation.patch(planLinkPlates);
 * export const planLinkCaseJobs = e3.record("plan_link_case_jobs", DictType(StringType, PrintJob), new Map([
 *     ["J-2001", { title: "Catalogue covers", start: some(new Date("2026-10-08T06:00:00Z")), end: some(new Date("2026-10-08T08:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 12000.0, customer: "Larkspur Home", stock: variant("board", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
 *     ["J-2002", { title: "Shop posters", start: some(new Date("2026-10-10T06:00:00Z")), end: some(new Date("2026-10-11T06:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 24000.0, customer: "Orchard Street Market", stock: variant("uncoated", null), due: some(new Date("2026-10-20T00:00:00Z")) }],
 *     ["J-2003", { title: "Catalogue inserts", start: some(new Date("2026-10-15T06:00:00Z")), end: some(new Date("2026-10-17T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 96000.0, customer: "Larkspur Home", stock: variant("coated", null), due: some(new Date("2026-10-19T00:00:00Z")) }],
 *     ["J-2004", { title: "Price lists", start: some(new Date("2026-10-07T12:00:00Z")), end: some(new Date("2026-10-08T18:00:00Z")), press: some("a2"), state: variant("confirmed", null), sheets: 16000.0, customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
 *     ["J-2005", { title: "Menu cards", start: some(new Date("2026-10-11T06:00:00Z")), end: some(new Date("2026-10-11T18:00:00Z")), press: some("a2"), state: variant("confirmed", null), sheets: 30000.0, customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-13T00:00:00Z")) }],
 *     ["J-2006", { title: "Gift tags", start: some(new Date("2026-10-25T06:00:00Z")), end: some(new Date("2026-10-25T18:00:00Z")), press: some("a2"), state: variant("proposed", variant("recommended", null)), sheets: 20000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-28T00:00:00Z")) }],
 *     ["J-2007", { title: "Gift boxes", start: some(new Date("2026-10-27T06:00:00Z")), end: some(new Date("2026-10-27T14:00:00Z")), press: some("a2"), state: variant("proposed", variant("recommended", null)), sheets: 48000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
 *     ["J-2008", { title: "Proof run", start: some(new Date("2026-10-02T06:00:00Z")), end: some(new Date("2026-10-05T18:00:00Z")), press: some("a3"), state: variant("actual", null), sheets: 16000.0, customer: "Meridian Monthly", stock: variant("coated", null), due: some(new Date("2026-10-06T00:00:00Z")) }],
 *     ["J-2009", { title: "Annual report", start: some(new Date("2026-10-19T18:00:00Z")), end: some(new Date("2026-10-21T06:00:00Z")), press: some("a3"), state: variant("confirmed", null), sheets: 48000.0, customer: "Harbour Arts Society", stock: variant("coated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
 *     ["J-2010", { title: "Desk calendars", start: some(new Date("2026-10-28T06:00:00Z")), end: some(new Date("2026-10-29T06:00:00Z")), press: some("a3"), state: variant("proposed", variant("added", null)), sheets: 36000.0, customer: "Foxglove Gardens", stock: variant("board", null), due: some(new Date("2026-11-02T00:00:00Z")) }],
 *     ["J-2011", { title: "Calendar pads", start: some(new Date("2026-10-29T06:00:00Z")), end: some(new Date("2026-10-30T18:00:00Z")), press: some("a3"), state: variant("proposed", variant("added", null)), sheets: 72000.0, customer: "Foxglove Gardens", stock: variant("uncoated", null), due: some(new Date("2026-11-02T00:00:00Z")) }],
 *     ["J-2012", { title: "Proof sheets", start: some(new Date("2026-09-28T06:00:00Z")), end: some(new Date("2026-09-30T18:00:00Z")), press: some("b1"), state: variant("actual", null), sheets: 8000.0, customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-01T00:00:00Z")) }],
 *     ["J-2013", { title: "Catalogue", start: some(new Date("2026-10-12T06:00:00Z")), end: some(new Date("2026-10-13T18:00:00Z")), press: some("b1"), state: variant("confirmed", null), sheets: 144000.0, customer: "Larkspur Home", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *     ["J-2014", { title: "Seed catalogue", start: some(new Date("2026-10-22T06:00:00Z")), end: some(new Date("2026-10-23T12:00:00Z")), press: some("b1"), state: variant("confirmed", null), sheets: 100000.0, customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-26T00:00:00Z")) }],
 *     ["J-2015", { title: "Night run", start: some(new Date("2026-10-05T00:00:00Z")), end: some(new Date("2026-10-05T08:00:00Z")), press: some("b2"), state: variant("actual", null), sheets: 16000.0, customer: "Meridian Monthly", stock: variant("coated", null), due: some(new Date("2026-10-06T00:00:00Z")) }],
 *     ["J-2016", { title: "Store flyers", start: some(new Date("2026-10-16T06:00:00Z")), end: some(new Date("2026-10-16T20:00:00Z")), press: some("b2"), state: variant("confirmed", null), sheets: 96000.0, customer: "Larkspur Home", stock: variant("uncoated", null), due: some(new Date("2026-10-19T00:00:00Z")) }],
 *     ["J-2017", { title: "Seed packets", start: some(new Date("2026-10-23T06:00:00Z")), end: some(new Date("2026-10-24T06:00:00Z")), press: some("b2"), state: variant("confirmed", null), sheets: 72000.0, customer: "Foxglove Gardens", stock: variant("board", null), due: some(new Date("2026-10-27T00:00:00Z")) }],
 *     ["J-2018", { title: "Exhibition book", start: some(new Date("2026-10-26T06:00:00Z")), end: some(new Date("2026-10-27T18:00:00Z")), press: some("b2"), state: variant("proposed", variant("recommended", null)), sheets: 54000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
 *     ["J-2019", { title: "Ticket books", start: some(new Date("2026-10-29T06:00:00Z")), end: some(new Date("2026-10-30T06:00:00Z")), press: some("b2"), state: variant("estimated", null), sheets: 60000.0, customer: "Heathfield Theatre", stock: variant("uncoated", null), due: some(new Date("2026-11-02T00:00:00Z")) }],
 *     ["J-2020", { title: "Card stock", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T14:00:00Z")), press: some("b3"), state: variant("actual", null), sheets: 30000.0, customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-08T00:00:00Z")) }],
 *     ["J-2021", { title: "Book sections", start: some(new Date("2026-10-11T06:00:00Z")), end: some(new Date("2026-10-12T12:00:00Z")), press: some("b3"), state: variant("confirmed", null), sheets: 84000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-14T00:00:00Z")) }],
 *     ["J-2022", { title: "Report covers", start: some(new Date("2026-10-19T06:00:00Z")), end: some(new Date("2026-10-20T18:00:00Z")), press: some("b3"), state: variant("confirmed", null), sheets: 48000.0, customer: "Harbour Arts Society", stock: variant("board", null), due: some(new Date("2026-10-21T00:00:00Z")) }],
 *     ["J-2023", { title: "Spring brochure", start: some(new Date("2026-11-03T06:00:00Z")), end: some(new Date("2026-11-04T18:00:00Z")), press: some("b3"), state: variant("estimated", null), sheets: 60000.0, customer: "Heathfield Theatre", stock: variant("coated", null), due: some(new Date("2026-11-09T00:00:00Z")) }],
 * ]));
 * export const planLinkCaseJobsPatch = e3.mutation.patch(planLinkCaseJobs);
 * export const planLinkBindings = e3.record("plan_link_bindings", DictType(StringType, PrintBinding), new Map([
 *     ["B-01", { title: "Fold sections", start: new Date("2026-10-15T06:00:00Z"), end: new Date("2026-10-16T06:00:00Z"), line: "fold", state: variant("confirmed", null) }],
 *     ["B-02", { title: "Fold sections", start: new Date("2026-10-17T06:00:00Z"), end: new Date("2026-10-18T06:00:00Z"), line: "fold", state: variant("confirmed", null) }],
 *     ["B-03", { title: "Bind books", start: new Date("2026-10-20T18:00:00Z"), end: new Date("2026-10-21T18:00:00Z"), line: "bind", state: variant("confirmed", null) }],
 *     ["B-04", { title: "Bind exhibition book", start: new Date("2026-10-25T06:00:00Z"), end: new Date("2026-10-26T06:00:00Z"), line: "bind", state: variant("proposed", variant("recommended", null)) }],
 * ]));
 * export const planLinkBindingsPatch = e3.mutation.patch(planLinkBindings);
 * export const planLinkDeliveries = e3.record("plan_link_deliveries", DictType(StringType, PrintDelivery), new Map([
 *     ["D-01", { title: "Books", at: new Date("2026-10-28T10:00:00Z"), bay: "bay" }],
 *     ["D-02", { title: "Posters", at: new Date("2026-10-20T10:00:00Z"), bay: "bay" }],
 * ]));
 * export const planLinkDeliveriesPatch = e3.mutation.patch(planLinkDeliveries);
 *
 * const planEventLinks = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const setters = $.let(Record.bind(planLinkSetters, []));
 *         const presses = $.let(Record.bind(planPrintPresses, []));
 *         const lines = $.let(Record.bind(planLinkLines, []));
 *         const bays = $.let(Record.bind(planLinkBays, []));
 *         const plates = $.let(Record.bind(planLinkPlates, [planLinkPlatesPatch]));
 *         const jobs = $.let(Record.bind(planLinkCaseJobs, [planLinkCaseJobsPatch]));
 *         const bindings = $.let(Record.bind(planLinkBindings, [planLinkBindingsPatch]));
 *         const deliveries = $.let(Record.bind(planLinkDeliveries, [planLinkDeliveriesPatch]));
 *         const stock = $.let(Data.bind(planLinkStock));
 *         // The window's first Monday: each stock reading runs from it, a week apiece.
 *         const first = $.const(new Date("2026-10-05T00:00:00Z"), DateTimeType);
 *         const StockWeek = StructType({ at: DateTimeType, value: OptionType(FloatType) });
 *         const weekly = $.const(East.function([ArrayType(FloatType)], ArrayType(StockWeek), (_$2, readings) =>
 *             East.Array.generate(readings.size(), StockWeek, (_$3, i) => ({ at: first.addWeeks(i), value: some(readings.get(i)) }))));
 *         const axis = $.let(Plan.axis({
 *             window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
 *             resolution: "week", now: new Date("2026-10-14T09:00:00Z"),
 *         }));
 *         return (
 *             <Plan
 *                 axis={axis}
 *                 resources={{
 *                     setters: Schedule.resources(setters.read(), { name: "Plate room", icon: "layer-group", label: s => s.name }),
 *                     presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name, group: p => p.hall }),
 *                     lines: Schedule.resources(lines.read(), { name: "Bindery", icon: "book", label: l => l.name }),
 *                     bays: Schedule.resources(bays.read(), { name: "Dispatch", icon: "warehouse", label: b => b.name }),
 *                 }}
 *                 events={{
 *                     plate: Schedule.events(plates, {
 *                         name: "Plates", icon: "clone",
 *                         title: "title", at: "at",
 *                         resource: { field: "setter", of: "setters" },
 *                     }),
 *                     job: Schedule.events(jobs, {
 *                         name: "Print job", icon: "file-lines",
 *                         title: "title", start: "start", end: "end",
 *                         resource: { field: "press", of: "presses" },
 *                         state: "state", quantity: { field: "sheets", unit: "sheets" },
 *                     }),
 *                     binding: Schedule.events(bindings, {
 *                         name: "Bindery job", icon: "book-open", draw: "cards",
 *                         title: "title", start: "start", end: "end",
 *                         resource: { field: "line", of: "lines" }, state: "state",
 *                     }),
 *                     delivery: Schedule.events(deliveries, {
 *                         name: "Delivery", icon: "truck", draw: "buckets",
 *                         title: "title", at: "at",
 *                         resource: { field: "bay", of: "bays" },
 *                     }),
 *                 }}
 *                 // The paper in stock: a table over a dataset, read only.
 *                 rows={[
 *                     Plan.over(stock, [
 *                         Plan.series.table(PrintStock, {
 *                             key: "stock", title: "Paper stock", label: s => s.name,
 *                             cells: s => Plan.tableCells(weekly(s.weekly)),
 *                             format: Format.Number({ maximumFractionDigits: 0n }),
 *                         }),
 *                     ]),
 *                 ]}
 *                 // Each quantity in thousands of sheets, its third of the family's largest setting the link's
 *                 // weight; the plates' link carries none.
 *                 links={[
 *                     Plan.link({ key: "plates", from: Plan.eventRef("plate", "P-01"), to: Plan.eventRef("job", "J-2001") }),
 *                     Plan.link({ key: "covers", from: Plan.eventRef("job", "J-2001"), to: Plan.eventRef("job", "J-2013"), quantity: Plan.quantity(12, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "card", from: Plan.eventRef("job", "J-2020"), to: Plan.eventRef("job", "J-2005"), quantity: Plan.quantity(30, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "inserts", from: Plan.eventRef("job", "J-2003"), to: Plan.eventRef("job", "J-2016"), quantity: Plan.quantity(96, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "report-covers", from: Plan.eventRef("job", "J-2022"), to: Plan.eventRef("job", "J-2009"), quantity: Plan.quantity(48, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "seed-prints", from: Plan.eventRef("job", "J-2014"), to: Plan.eventRef("job", "J-2017"), quantity: Plan.quantity(72, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "tags", from: Plan.eventRef("job", "J-2006"), to: Plan.eventRef("job", "J-2007"), quantity: Plan.quantity(20, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "pads", from: Plan.eventRef("job", "J-2010"), to: Plan.eventRef("job", "J-2011"), quantity: Plan.quantity(36, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "proofs", from: Plan.eventRef("job", "J-2008"), to: Plan.eventRef("job", "J-2015"), quantity: Plan.quantity(16, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "proof-sheets", from: Plan.eventRef("job", "J-2012"), to: Plan.eventRef("job", "J-2004"), quantity: Plan.quantity(8, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "tickets", from: Plan.eventRef("job", "J-2019"), to: Plan.eventRef("job", "J-2023"), quantity: Plan.quantity(60, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "sections", from: Plan.eventRef("job", "J-2021"), to: Plan.eventRef("binding", "B-01"), quantity: Plan.quantity(40, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "sections-more", from: Plan.eventRef("job", "J-2021"), to: Plan.eventRef("binding", "B-02"), quantity: Plan.quantity(44, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "folded", from: Plan.eventRef("binding", "B-02"), to: Plan.eventRef("binding", "B-03"), quantity: Plan.quantity(40, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "books", from: Plan.eventRef("binding", "B-03"), to: Plan.eventRef("delivery", "D-01"), quantity: Plan.quantity(36, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "posters", from: Plan.eventRef("job", "J-2002"), to: Plan.eventRef("delivery", "D-02"), quantity: Plan.quantity(24, { unit: "k sheets" }) }),
 *                     Plan.link({ key: "book-blocks", from: Plan.eventRef("job", "J-2018"), to: Plan.eventRef("binding", "B-04"), quantity: Plan.quantity(54, { unit: "k sheets" }) }),
 *                 ]}
 *                 style={{ height: "400px" }}
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
