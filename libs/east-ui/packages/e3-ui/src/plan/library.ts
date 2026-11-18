/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Plan.library` — the Plan's library pane, the author's (#1195,
 * `Plan Builder Spec.md` §4.3, §8, §9.6, PB26–PB30, PB61, PB62). `library`
 * lists the pane's tabs, in order, each built here:
 *
 * - `Plan.library.events()`: every event kind's templates, by kind;
 * - `Plan.library.backlog()`: every event kind's unscheduled events, by when
 *   they are due;
 * - `Plan.library.series()`: what the canvas shows that a viewer can hide,
 *   each with an eye — the resource kinds and their measures, the event
 *   kinds, `data`'s `series`, and the Plan's `rows`;
 * - `Plan.library.tab(rows, { … })`: cards of the author's own.
 *
 * Left out, or empty, the Plan has no library pane.
 *
 * An author's tab reads its rows as `Schedule.resources` does: a `Dict<K, R>`,
 * usually a record's `read()`, its accessors `(row, key) => …` reified once
 * into a describe function the map then calls, each card keyed by its row's
 * key as text. Its cards drag onto the rows of `data` whose series makes an
 * item of a dropped card (`edit.create`, #1259), as a Library's card beside
 * the Plan does — the Plan takes its own panel's cards with no `id` or
 * `sources`. Its `drop` returns what a card dropped on an event sets:
 * `Schedule.patch` over one event kind's row type, whose type names that kind.
 * The patch crosses the closed payload as that kind's field writes — each
 * field it sets, its path and its value as bytes — which a drop writes through
 * the kind's own `write` (#1196). Its `create` makes an event of a kind from a
 * card dropped on a resource's row, as a template does (#1541, U1): each card
 * a template its kind knows and lists nowhere, so the one function that makes
 * a template's event makes a card's.
 *
 * @packageDocumentation
 */

import {
    ArrayType, DictType, East, NullType, OptionType, StringType, StructType, VariantType, none,
    some, variant,
    type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { PickItemType } from "@elaraai/east-ui";
import type { ScheduleEventKind } from "../schedule/events.js";
import { ScheduleAuthorTabType, buildScheduleTab, scheduleTabRows, type ScheduleLibraryTabConfig } from "../schedule/library.js";
export { ScheduleLibraryCardType as PlanLibraryCardType } from "../schedule/library.js";
import { ScheduleCardMadeType, ScheduleCardTemplateType, scheduleCardTemplates, scheduleCardsMade, type ScheduleCardTemplatesConfig } from "../schedule/templates.js";
import { ScheduleTemplateType } from "../schedule/types.js";
import { overSeries } from "./over.js";
import { KIND_ICONS } from "./pick.js";
import { PlanRowsCollectionType } from "./types.js";

// ============================================================================
// The wire
// ============================================================================

/**
 * One card of an author's tab on the wire.
 *
 * @property key - Its row's key, as text
 * @property label - Its name
 * @property meta - The line under its name
 * @property group - The tab's group the card sits under
 * @property sets - What a drop writes into the event it lands on: each field the tab's `drop` patch sets; empty without a `drop`
 */
/**
 * The id the Series tab lists a thing by, and a viewer's hidden set holds it by
 * (PB29): one namespace per source, so no two collide — an event kind by slot,
 * a hand-built row and a `Plan.over` series by key. `data`'s series — the
 * resources among them (#1541) — are the canvas's pick's own, by their bare
 * keys.
 *
 * @internal
 */
export const planHideId = {
    /** An event kind, by slot: hiding it hides its elements everywhere. */
    events: (slot: string): string => `events.${slot}`,
    /** A hand-built row, by key: hiding it hides it and the rows under it. */
    rows: (key: string): string => `rows.${key}`,
    /** A `Plan.over` series, by key: hiding it hides its rows and its nested series'. */
    series: (key: string): string => `series.${key}`,
} as const;

/**
 * What hiding one of a Plan's `rows` hides on the canvas: a `Plan.over`
 * series' rows, by the keys they carry — its own and every series' nested in
 * it — or a hand-built row and the rows under it, by its key, the first step
 * of their ids' paths.
 */
export const PlanLibraryHidesType = VariantType({
    series: ArrayType(StringType),
    rows: StringType,
});

/** Type representing {@link PlanLibraryHidesType}. */
export type PlanLibraryHidesType = typeof PlanLibraryHidesType;

/**
 * One of a Plan's `rows` as the Series tab lists it.
 *
 * @property item - Its line in the tab, an eye beside it
 * @property hides - What hiding it hides
 */
export const PlanLibraryRowsItemType = StructType({
    item: PickItemType,
    hides: PlanLibraryHidesType,
});

/** Type representing {@link PlanLibraryRowsItemType}. */
export type PlanLibraryRowsItemType = typeof PlanLibraryRowsItemType;

/**
 * What the Series tab lists (PB29), each a pick item with its eye, in the
 * order the canvas draws them. `data`'s series sit between the two lists:
 * they are the canvas's pick's own (the root's `pick`, #1541), a `views` as
 * its members.
 *
 * @property kinds - The resource kinds, each followed by its measures, then the event kinds
 * @property rows - The Plan's `rows`: a hand-built row by its key, each series of a `Plan.over` by its own
 */
export const PlanLibrarySeriesType = StructType({
    kinds: ArrayType(PickItemType),
    rows: ArrayType(PlanLibraryRowsItemType),
});

/** Type representing {@link PlanLibrarySeriesType}. */
export type PlanLibrarySeriesType = typeof PlanLibrarySeriesType;

/**
 * What an author's tab's cards make (#1541, U1): events of one kind, each
 * card's from the template its kind knows it by.
 *
 * @property kind - The event kind, by its slot
 * @property makes - Each card's key with what a drop reads of its template: its values stay with its kind, whose `write` makes the event
 */
export const PlanTabCreateType = StructType({
    kind: StringType,
    makes: ArrayType(ScheduleCardMadeType),
});

/** Type representing {@link PlanTabCreateType}. */
export type PlanTabCreateType = typeof PlanTabCreateType;

/**
 * An author's tab on a Plan: the tab every builder's library takes, and what
 * its cards make of an event kind when dropped on a resource's row.
 *
 * @property create - The events its cards make; none, its cards make none
 */
export const PlanAuthorTabType = StructType({
    ...ScheduleAuthorTabType.fields,
    create: OptionType(PlanTabCreateType),
});

/** Type representing {@link PlanAuthorTabType}. */
export type PlanAuthorTabType = typeof PlanAuthorTabType;

/**
 * One tab of the library pane on the wire, in the order `library` lists them.
 *
 * - `events` — every event kind's templates, read off the kinds;
 * - `backlog` — every event kind's unscheduled events, read off the kinds;
 * - `series` — what the canvas shows that a viewer can hide;
 * - `tab` — the author's own: its name, its icon, the event kind its cards
 *   land on, its cards, and the events they make.
 */
export const PlanLibraryTabType = VariantType({
    events: NullType,
    backlog: NullType,
    series: PlanLibrarySeriesType,
    tab: PlanAuthorTabType,
});

/** Type representing {@link PlanLibraryTabType}. */
export type PlanLibraryTabType = typeof PlanLibraryTabType;

// ============================================================================
// The author's surface
// ============================================================================

/**
 * What a card of an author's tab makes when dropped on a resource's row
 * (#1541, U1): an event of a kind, as a template of that kind does.
 *
 * @typeParam K - The rows' key type
 * @typeParam R - Their row type
 */
export interface PlanTabCreateConfig<K extends EastType, R extends EastType> extends Pick<ScheduleCardTemplatesConfig<K, R>, "at" | "duration" | "values"> {
    /** The event kind its cards make an event of, by its slot in `events`. */
    kind: string;
}

/**
 * An author's tab on a Plan: every builder's tab, and `create`.
 *
 * @typeParam K - The rows' key type
 * @typeParam R - Their row type
 * @typeParam P - The patch `drop` returns: `Schedule.Types.Patch` of one event kind's row type
 */
export interface PlanLibraryTabConfig<K extends EastType, R extends EastType, P extends EastType = EastType> extends ScheduleLibraryTabConfig<K, R, P> {
    /**
     * What a card dropped on a resource's row makes (#1541, U1): an event of `kind`, there, as a template of the kind
     * does — as long as `duration` says (a span kind's; an instant kind's gives none), from `at` when dropped on a
     * whole day, its own fields `values`: every field of the kind's row but its start, its end and its resource. A
     * tab may take `drop` beside it: a card over an event of the patch's kind sets what the patch sets, and anywhere
     * else on a row of `kind`'s it makes an event.
     */
    create?: PlanTabCreateConfig<K, R>;
}

/** One tab of the library pane — what each `Plan.library.*` call returns, and `library` lists. */
export type PlanLibraryTab =
    | { readonly kind: "events" }
    | { readonly kind: "backlog" }
    | { readonly kind: "series" }
    | { readonly kind: "tab"; readonly rows: unknown; readonly config: PlanLibraryTabConfig<EastType, EastType> };

/**
 * The library's Events tab — `Plan.library.events()`: every event kind's
 * templates, under the kind's name and icon, then by a template's `group`
 * (PB27). A card dropped on a resource's row creates an event of its kind
 * (#1196).
 *
 * @returns The tab
 */
export function libraryEvents(): PlanLibraryTab {
    return { kind: "events" };
}

/**
 * The library's Backlog tab — `Plan.library.backlog()`: every event kind's
 * unscheduled events (a kind whose times are Options), by when they are due:
 * this week, next week, later, or no date (PB28). A card dropped on a
 * resource's row schedules it (#1196).
 *
 * @returns The tab
 */
export function libraryBacklog(): PlanLibraryTab {
    return { kind: "backlog" };
}

/**
 * The library's Series tab — `Plan.library.series()`: what the canvas shows
 * that a viewer can hide, each with an eye (PB29). Hiding an event kind hides
 * its elements everywhere, a resource kind its rows, a measure or one of the
 * Plan's `rows` that row; each of `data`'s `series` its rows — a section or a
 * group with its subtree, a `views` one member at a time — the Plan's `hidden`
 * naming the ones off to start (#1541). What a viewer hides is kept for them,
 * under the Plan's `id`.
 *
 * @returns The tab
 */
export function librarySeries(): PlanLibraryTab {
    return { kind: "series" };
}

/**
 * A tab of the author's own cards — `Plan.library.tab(rows, { … })` (PB62):
 * one card per row, its label and meta, grouped by its `group`, searched by
 * its key, label and meta. Each card drags onto the rows of `data` whose
 * series makes an item of it (`edit.create`, #1259) — the drop's `from.key`
 * its row's key as text, so `canDrop` and `create` read it as a Library card's
 * — and, given a `drop`, onto an event (#1196), setting the fields the patch
 * sets.
 *
 * @typeParam K - The rows' key type
 * @typeParam R - Their row type
 * @typeParam P - The patch `drop` returns
 * @param rows - The rows — a `Dict<K, R>` value or expression, usually a record's `read()`
 * @param config - The tab's name and icon, and the accessors ({@link PlanLibraryTabConfig})
 * @returns The tab
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { DateTimeType, DictType, East, FloatType, NullType, OptionType, StringType, StructType, VariantType, none, some, variant } from "@elaraai/east";
 * import { EventStateType, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Plan, Record, Schedule } from "@elaraai/e3-ui";
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
 * export const PrintCustomer = StructType({ name: StringType, district: StringType, trade: StringType });
 * export const PrintOrder = StructType({ title: StringType, customer: StringType, sheets: FloatType });
 * export const planPrintPresses = e3.record("plan_print_presses", DictType(StringType, PrintPress), {
 *     initial: new Map([
 *         ["a1", { name: "Press A1", hall: "Hall A", sheets_per_hour: 12000.0 }],
 *         ["a2", { name: "Press A2", hall: "Hall A", sheets_per_hour: 10000.0 }],
 *         ["a3", { name: "Press A3", hall: "Hall A", sheets_per_hour: 8000.0 }],
 *         ["b1", { name: "Press B1", hall: "Hall B", sheets_per_hour: 15000.0 }],
 *         ["b2", { name: "Press B2", hall: "Hall B", sheets_per_hour: 12000.0 }],
 *         ["b3", { name: "Press B3", hall: "Hall B", sheets_per_hour: 6000.0 }],
 *     ]),
 *     indexes: (index) => ({
 *         plan_print_presses_by_hall: index.on(["hall"]),
 *     }),
 *     mutations: (mutation) => ({
 *         // The presses' patch door: the works edits its presses elsewhere, and a Plan reads them live.
 *         patch: mutation.patch(),
 *     }),
 * });
 * export const planPrintCustomers = e3.record("plan_print_customers", DictType(StringType, PrintCustomer), {
 *     initial: new Map([
 *         ["alder-finch", { name: "Alder & Finch", district: "Old Town", trade: "Retail" }],
 *         ["bluewater-tours", { name: "Bluewater Tours", district: "North Quay", trade: "Travel" }],
 *         ["copperleaf-cafe", { name: "Copperleaf Cafe", district: "Old Town", trade: "Hospitality" }],
 *         ["driftwood-museum", { name: "Driftwood Museum", district: "North Quay", trade: "Arts" }],
 *         ["elmway-college", { name: "Elmway College", district: "Riverside", trade: "Education" }],
 *         ["foxglove-gardens", { name: "Foxglove Gardens", district: "Riverside", trade: "Retail" }],
 *         ["granite-hall", { name: "Granite Hall", district: "Old Town", trade: "Events" }],
 *         ["harbour-arts", { name: "Harbour Arts Society", district: "North Quay", trade: "Arts" }],
 *         ["heathfield", { name: "Heathfield Theatre", district: "Old Town", trade: "Arts" }],
 *         ["ivy-lane", { name: "Ivy Lane Studio", district: "Riverside", trade: "Design" }],
 *         ["juniper-toys", { name: "Juniper Toys", district: "Riverside", trade: "Retail" }],
 *         ["kestrel-cycling", { name: "Kestrel Cycling Club", district: "Riverside", trade: "Sport" }],
 *         ["larkspur-home", { name: "Larkspur Home", district: "Old Town", trade: "Retail" }],
 *         ["meridian-monthly", { name: "Meridian Monthly", district: "North Quay", trade: "Publishing" }],
 *         ["northwind", { name: "Northwind Outfitters", district: "North Quay", trade: "Retail" }],
 *         ["orchard-market", { name: "Orchard Street Market", district: "Old Town", trade: "Markets" }],
 *     ]),
 *     indexes: (index) => ({
 *         plan_print_customers_by_district: index.on(["district"]),
 *     }),
 *     mutations: (mutation) => ({
 *         // The customers' patch door: the works edits its customers elsewhere, and a Plan reads them live.
 *         patch: mutation.patch(),
 *     }),
 * });
 * export const planEventOrders = e3.record("plan_event_orders", DictType(StringType, PrintOrder), {
 *     initial: new Map([
 *         ["O-501", { title: "Market flyers", customer: "Orchard Street Market", sheets: 16000.0 }],
 *         ["O-502", { title: "Season programme", customer: "Heathfield Theatre", sheets: 48000.0 }],
 *         ["O-503", { title: "Trail maps", customer: "Kestrel Cycling Club", sheets: 24000.0 }],
 *     ]),
 *     mutations: (mutation) => ({
 *         // The orders' patch door: the works takes its orders elsewhere, and a Plan reads them live.
 *         patch: mutation.patch(),
 *     }),
 * });
 * export const planEventJobs = e3.record("plan_event_jobs", DictType(StringType, PrintJob), {
 *     initial: new Map([
 *         ["J-3001", { title: "Spring catalogue", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T14:00:00Z")), press: some("a1"), state: variant("actual", null), sheets: 96000.0, customer: "Alder & Finch", stock: variant("coated", null), due: some(new Date("2026-10-08T00:00:00Z")) }],
 *         ["J-3002", { title: "Course handbook", start: some(new Date("2026-10-19T06:00:00Z")), end: some(new Date("2026-10-19T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 144000.0, customer: "Elmway College", stock: variant("uncoated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
 *         ["J-3003", { title: "Annual report", start: some(new Date("2026-10-14T06:00:00Z")), end: some(new Date("2026-10-14T12:00:00Z")), press: some("a2"), state: variant("in-progress", null), sheets: 60000.0, customer: "Harbour Arts Society", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *         ["J-3004", { title: "Club newsletter", start: some(new Date("2026-10-08T06:00:00Z")), end: some(new Date("2026-10-08T08:00:00Z")), press: some("a3"), state: variant("actual", null), sheets: 16000.0, customer: "Kestrel Cycling Club", stock: variant("uncoated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
 *         ["J-3005", { title: "Store flyers", start: some(new Date("2026-10-15T06:00:00Z")), end: some(new Date("2026-10-15T16:00:00Z")), press: some("b1"), state: variant("confirmed", null), sheets: 150000.0, customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *         ["J-3006", { title: "Market posters", start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T12:00:00Z")), press: some("b2"), state: variant("confirmed", null), sheets: 72000.0, customer: "Orchard Street Market", stock: variant("coated", null), due: some(new Date("2026-10-22T00:00:00Z")) }],
 *         ["J-3007", { title: "Loyalty cards", start: some(new Date("2026-10-20T10:00:00Z")), end: some(new Date("2026-10-20T13:00:00Z")), press: some("b2"), state: variant("proposed", variant("added", null)), sheets: 36000.0, customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
 *         ["J-3008", { title: "Gift boxes", start: some(new Date("2026-10-27T06:00:00Z")), end: some(new Date("2026-10-27T12:00:00Z")), press: some("b3"), state: variant("proposed", variant("recommended", null)), sheets: 48000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
 *         ["J-3009", { title: "Ticket books", start: some(new Date("2026-10-22T06:00:00Z")), end: some(new Date("2026-10-22T09:00:00Z")), press: none, state: variant("proposed", variant("added", null)), sheets: 24000.0, customer: "Heathfield Theatre", stock: variant("uncoated", null), due: some(new Date("2026-10-26T00:00:00Z")) }],
 *         ["J-3010", { title: "Guide reprint", start: none, end: none, press: none, state: variant("estimated", null), sheets: 24000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *         ["J-3011", { title: "Wall calendars", start: none, end: none, press: none, state: variant("estimated", null), sheets: 50000.0, customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
 *         ["J-3012", { title: "Spare covers", start: none, end: none, press: none, state: variant("estimated", null), sheets: 8000.0, customer: "Meridian Monthly", stock: variant("board", null), due: none }],
 *     ]),
 *     indexes: (index) => ({
 *         // The jobs over their interval index: what the print works' optimiser reads the window's jobs and the backlog through (#1622).
 *         plan_event_jobs_by_time: index.interval({ from: "start", to: "end" }),
 *     }),
 *     mutations: (mutation) => ({
 *         // The smallest builder's jobs' patch door: its Save commits through it.
 *         patch: mutation.patch(),
 *     }),
 * });
 *
 * const planEvents = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const presses = $.let(Record.bind(planPrintPresses, []));
 *         const jobs = $.let(Record.bind(planEventJobs));
 *         const customers = $.let(Record.bind(planPrintCustomers, []));
 *         const orders = $.let(Record.bind(planEventOrders, []));
 *         const axis = $.let(Plan.axis({
 *             window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
 *             resolution: "day", now: new Date("2026-10-14T09:00:00Z"),
 *         }));
 *         return (
 *             <Plan
 *                 id="jobs"
 *                 axis={axis}
 *                 // The presses are its rows: each a landing row its jobs land on, by `press`.
 *                 data={presses.read()}
 *                 series={[Plan.series.resources(PrintPress, { key: "presses", title: "Presses", icon: "print", label: p => p.name })]}
 *                 events={{
 *                     job: Schedule.events(jobs, {
 *                         name: "Print job", icon: "file-lines",
 *                         title: "title", start: "start", end: "end",
 *                         resource: { field: "press", of: "presses" },
 *                         state: "state",
 *                         // A job with no start waits in the backlog: placed, it runs as long as its sheets take at
 *                         // 8,000 an hour.
 *                         backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
 *                         fields: {
 *                             customer: Schedule.field.text({ label: "Customer" }),
 *                             stock: Schedule.field.select({ labels: { coated: "Coated", uncoated: "Uncoated", board: "Board" } }),
 *                         },
 *                     }),
 *                 }}
 *                 library={[
 *                     Plan.library.backlog(),
 *                     // The orders to plan, by customer: a card dropped on a press makes a job there, as a
 *                     // template would, running as long as its sheets take at 8,000 an hour.
 *                     Plan.library.tab(orders.read(), {
 *                         name: "Orders", icon: "inbox",
 *                         label: o => o.title, group: o => o.customer,
 *                         create: {
 *                             kind: "job",
 *                             duration: o => variant("hours", o.sheets.divide(8000.0)),
 *                             values: o => ({
 *                                 title: o.title, customer: o.customer, sheets: o.sheets,
 *                                 state: variant("proposed", variant("added", null)), stock: variant("coated", null), due: none,
 *                             }),
 *                         },
 *                     }),
 *                     // The customers, by district: a card dropped on a job sets its customer.
 *                     Plan.library.tab(customers.read(), {
 *                         name: "Customers", icon: "building",
 *                         label: c => c.name, meta: c => some(c.trade), group: c => c.district,
 *                         drop: c => Schedule.patch(PrintJob, { customer: c.name }),
 *                     }),
 *                 ]}
 *                 inspector
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function libraryTab<K extends EastType, R extends EastType, P extends EastType = EastType>(
    rows: SubtypeExprOrValue<DictType<K, R>>,
    config: PlanLibraryTabConfig<K, R, P>,
): PlanLibraryTab {
    return { kind: "tab", rows, config: config as unknown as PlanLibraryTabConfig<EastType, EastType> };
}

// ============================================================================
// The build
// ============================================================================

/** A resource kind, its types erased. */

/** An event kind, its types erased. */
type AnyEventKind = ScheduleEventKind<EastType, EastType>;

/**
 * What a Plan's library is built against.
 *
 * @internal
 */
export interface PlanLibraryContext {
    /** The event kinds, by slot, in order. */
    readonly events: readonly (readonly [string, AnyEventKind])[];
    /** The Plan's `rows`, when given. */
    readonly rows: readonly unknown[] | undefined;
    /** Whether the Plan has `data`'s `series`: the Series tab lists them too, through the canvas's pick (#1541). */
    readonly picked: boolean;
    /** The Plan's `Slice.bindRecords` sources, which an author's tab's `source` must be one of; none, a tab may name none (#1343, #1344). */
    readonly sources?: readonly string[] | undefined;
    /**
     * Holds a value once in the Plan's own block: what several parts of its payload read — a tab's cards' templates,
     * its wire and its kind's `write` — is worked out once as the Plan is evaluated, never again at each read.
     */
    readonly bind: <T extends EastType>(value: ExprType<T>) => ExprType<T>;
}

/** How a tab names itself in a refusal. */
function tabName(tab: PlanLibraryTab): string {
    return tab.kind === "tab" ? `the "${tab.config.name}" tab` : `Plan.library.${tab.kind}()`;
}

/** A pick item of the Series tab, known at build. */
function item(id: string, title: string, subtitle: string | undefined, icon: string): ExprType<PickItemType> {
    return East.value({
        id,
        title,
        subtitle: subtitle === undefined ? none : some(subtitle),
        icon: some({ name: icon, prefix: "fas", label: none, style: none }),
        count: none,
        narrowed: false,
    }, PickItemType);
}

/** The glyph a hand-built row's kind is listed with: its series kind's. */
const ROW_ICONS = {
    group: KIND_ICONS.group,
    span: KIND_ICONS.span,
    buckets: KIND_ICONS.buckets,
    chart: KIND_ICONS.chart,
    heat: KIND_ICONS.heat,
    table: KIND_ICONS.table,
    cards: KIND_ICONS.cards,
    events: KIND_ICONS.events,
} as const;

/**
 * A hand-built row stream's Series items: each row at its top by its key, the
 * one step of its id's path (`Plan.chart({ key })`), and its name.
 */
const handItems = East.function([PlanRowsCollectionType], ArrayType(PlanLibraryRowsItemType), ($, rows) => {
    const out = $.let([], ArrayType(PlanLibraryRowsItemType));
    $.for(rows, ($2, row) => {
        const path = $2.let(row.id.match({
            entry: (_$3, at) => at.path,
            section: (_$3, at) => at.path,
        }), ArrayType(StringType));
        $2.if(row.parent.hasTag("none").and(() => path.size().greater(0n)), ($3) => {
            const key = $3.let(path.get(0n), StringType);
            const icon = $3.let(row.kind.match({
                group: () => ROW_ICONS.group,
                span: () => ROW_ICONS.span,
                buckets: () => ROW_ICONS.buckets,
                chart: () => ROW_ICONS.chart,
                heat: () => ROW_ICONS.heat,
                table: () => ROW_ICONS.table,
                cards: () => ROW_ICONS.cards,
                events: () => ROW_ICONS.events,
            }), StringType);
            $3(out.pushLast({
                item: {
                    id: East.str`rows.${key}`,
                    title: row.gutter.label,
                    subtitle: none,
                    icon: some({ name: icon, prefix: "fas", label: none, style: none }),
                    count: none,
                    narrowed: false,
                },
                hides: variant("rows", key),
            }));
        });
    });
    return out;
});

/**
 * The Series tab on the wire (PB29): the event kinds, and the Plan's `rows`.
 * `data`'s series, the resources among them, are the canvas's pick's (#1541).
 *
 * @param ctx - What the library is built against
 * @returns The tab's wire value
 */
function seriesTab(ctx: PlanLibraryContext): ExprType<PlanLibraryTabType> {
    const kinds: ExprType<PickItemType>[] = [];
    for (const [slot, kind] of ctx.events) kinds.push(item(planHideId.events(slot), kind.name, undefined, kind.icon));
    const rows = (ctx.rows ?? []).map((one): ExprType<ArrayType<PlanLibraryRowsItemType>> => {
        const over = overSeries(one);
        if (over !== undefined) {
            return East.value(over.map(({ facts, keys }) => East.value({
                item: item(planHideId.series(facts.key), facts.title, undefined, KIND_ICONS[facts.arm]),
                hides: variant("series", [...keys]),
            }, PlanLibraryRowsItemType)), ArrayType(PlanLibraryRowsItemType));
        }
        return handItems(East.value(one as SubtypeExprOrValue<typeof PlanRowsCollectionType>, PlanRowsCollectionType));
    }).reduce<ExprType<ArrayType<PlanLibraryRowsItemType>>>(
        (all, part) => all.concat(part) as ExprType<ArrayType<PlanLibraryRowsItemType>>,
        East.value([], ArrayType(PlanLibraryRowsItemType)));
    return East.value(variant("series", { kinds: East.value(kinds, ArrayType(PickItemType)), rows }), PlanLibraryTabType);
}

/** The library pane built: its tabs on the wire, and what its tabs' cards make of each event kind. */
export interface PlanLibraryBuilt {
    /** The tabs on the wire, in the order `library` lists them. */
    readonly tabs: ExprType<ArrayType<PlanLibraryTabType>>;
    /**
     * The templates the tabs' cards make each event kind's events from (#1541, U1), by the kind's slot: what its
     * `buildPlan` takes, so its own `write` makes a card's event. A kind no tab makes events of has none.
     */
    readonly made: ReadonlyMap<string, ExprType<ArrayType<ScheduleTemplateType>>>;
}

/**
 * An author's tab's `create`, checked and reified (#1541, U1): each of its
 * cards a template of the kind it names.
 *
 * @param tab - The tab
 * @param ctx - What the library is built against
 * @returns The kind's slot and each card's key with its template; `undefined` for a tab with no `create`
 * @throws {Error} Naming the tab: a kind the Plan has not; a span kind's with no `duration`, or an instant kind's with one; `values` that are not the kind's
 */
function tabCreate(tab: Extract<PlanLibraryTab, { kind: "tab" }>, ctx: PlanLibraryContext): { slot: string; makes: ExprType<ArrayType<ScheduleCardTemplateType>> } | undefined {
    const create = tab.config.create;
    if (create === undefined) return undefined;
    const where = `Plan: the "${tab.config.name}" tab`;
    const kind = ctx.events.find(([slot]) => slot === create.kind)?.[1];
    if (kind === undefined) {
        const slots = ctx.events.map(([slot]) => slot).join(", ");
        throw new Error(`${where}'s \`create\` makes events of "${create.kind}", and this Plan has no such event kind — \`kind\` names one of ` +
            `\`events\` by its slot (${slots === "" ? "this Plan has no event kinds" : slots})`);
    }
    if (!kind.instant && create.duration === undefined) {
        throw new Error(`${where}'s \`create\` gives how long the event a card makes runs — create: { kind: "${create.kind}", duration: (row) => ` +
            'variant("hours", …), values }, as a template of the kind does');
    }
    if (kind.instant && create.duration !== undefined) {
        throw new Error(`${where}'s \`create\` gives a \`duration\`, and "${create.kind}" is an instant kind, whose events are one time — leave it out`);
    }
    const { source, keyType, rowType } = scheduleTabRows(tab, where);
    const group = tab.config.group;
    const makes = scheduleCardTemplates(
        source as unknown as ExprType<DictType<EastType, EastType>>, keyType, rowType,
        {
            name: tab.config.label,
            ...(group === undefined ? {} : { group: (row, key) => some(group(row, key)) }),
            ...(create.at === undefined ? {} : { at: create.at }),
            ...(create.duration === undefined ? {} : { duration: create.duration }),
            values: create.values,
        },
        kind.templateValues, tab.config.name, where);
    return { slot: create.kind, makes };
}

/**
 * Builds the library pane on the wire (PB26, PB61, PB62): its tabs in the
 * order `library` lists them; none when it is left out.
 *
 * @param tabs - The tabs, each a `Plan.library.*` call
 * @param ctx - What the library is built against
 * @returns The tabs on the wire, and what their cards make of each event kind
 * @throws {Error} Naming the tab: a tab listed twice (an author's tab by its name); the Events or Backlog tab on a Plan
 *   with no event kinds; the Series tab on a Plan with nothing a viewer can hide; and each of an author's tab's refusals
 * @internal
 */
export function buildLibrary(tabs: readonly PlanLibraryTab[] | undefined, ctx: PlanLibraryContext): PlanLibraryBuilt {
    const seen = new Set<string>();
    for (const tab of tabs ?? []) {
        const id = tab.kind === "tab" ? `tab:${tab.config.name}` : tab.kind;
        if (seen.has(id)) {
            throw new Error(tab.kind === "tab"
                ? `Plan: the library lists two tabs named "${tab.config.name}" — each tab's name is its own`
                : `Plan: the library lists ${tabName(tab)} twice — each tab once`);
        }
        seen.add(id);
        if ((tab.kind === "events" || tab.kind === "backlog") && ctx.events.length === 0) {
            throw new Error(`Plan: the library lists ${tabName(tab)}, and this Plan has no event kinds — ` +
                `its ${tab.kind === "events" ? "templates" : "unscheduled events"} are its event kinds' (Schedule.events)`);
        }
        if (tab.kind === "series" && ctx.events.length === 0 && (ctx.rows ?? []).length === 0 && !ctx.picked) {
            throw new Error("Plan: the library lists Plan.library.series(), and this Plan has nothing a viewer can hide — it lists " +
                "event kinds, `rows`, and `data`'s `series`");
        }
    }
    // Each kind's cards' templates, tab by tab, each tab's held once.
    const cardsOf = new Map<string, ExprType<ArrayType<ScheduleCardTemplateType>>[]>();
    const wires = (tabs ?? []).map((tab): ExprType<PlanLibraryTabType> => {
        switch (tab.kind) {
            case "events":
            case "backlog":
                return East.value(variant(tab.kind, null), PlanLibraryTabType);
            case "series":
                return seriesTab(ctx);
            case "tab": {
                // Every builder's tab, then what its cards make: read once, its fields the Plan's tab's.
                const shared = buildScheduleTab(tab, ctx.events, "Plan", ctx.sources ?? []);
                const create = tabCreate(tab, ctx);
                // Its cards' templates, worked out once: the tab carries what a drop reads of each, and its kind's `write`
                // holds their values.
                const cards = create === undefined ? undefined : ctx.bind(create.makes);
                if (create !== undefined && cards !== undefined) cardsOf.set(create.slot, [...(cardsOf.get(create.slot) ?? []), cards]);
                const whole = East.function([], PlanAuthorTabType, ($) => {
                    const own = $.const(shared);
                    return {
                        name: own.name, icon: own.icon, drop: own.drop, cards: own.cards, source: own.source,
                        create: create === undefined || cards === undefined ? East.value(none, OptionType(PlanTabCreateType))
                            : some({ kind: create.slot, makes: scheduleCardsMade(cards) }),
                    };
                });
                return East.value(variant("tab", whole()), PlanLibraryTabType);
            }
        }
    });
    // What each kind's `write` makes a card's event from: its tabs' cards' templates together, held once.
    const made = new Map<string, ExprType<ArrayType<ScheduleTemplateType>>>();
    for (const [slot, tabsCards] of cardsOf) {
        const templates = tabsCards.map((cards) => cards.map((_$, one) => one.template) as ExprType<ArrayType<ScheduleTemplateType>>);
        made.set(slot, ctx.bind(templates.reduce((all, more) => all.concat(more) as ExprType<ArrayType<ScheduleTemplateType>>)));
    }
    return { tabs: East.value(wires, ArrayType(PlanLibraryTabType)), made };
}
