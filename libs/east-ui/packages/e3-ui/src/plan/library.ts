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
 *   kinds, `data`'s series when they are picked (`pick`), and the Plan's
 *   `rows`;
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
 * the kind's own `write` (#1196).
 *
 * @packageDocumentation
 */

import {
    ArrayType, DictType, East, Expr, NullType, OptionType, StringType, StructType, VariantType, isTypeEqual, none, printType,
    some, variant,
    type EastType, type ExprType, type FunctionType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { PickItemType } from "@elaraai/east-ui";
import type { ScheduleEventKind } from "../schedule/events.js";
import { SchedulePatchTypeFor } from "../schedule/patch.js";
import type { ScheduleResourceKind } from "../schedule/resources.js";
import { ScheduleFieldWriteType } from "../schedule/types.js";
import { overSeries } from "./over.js";
import { KIND_ICONS } from "./pick.js";
import { planSeriesFacts } from "./series.js";
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
export const PlanLibraryCardType = StructType({
    key: StringType,
    label: StringType,
    meta: OptionType(StringType),
    group: OptionType(StringType),
    sets: ArrayType(ScheduleFieldWriteType),
});

/** Type representing {@link PlanLibraryCardType}. */
export type PlanLibraryCardType = typeof PlanLibraryCardType;

/**
 * The id the Series tab lists a thing by, and a viewer's hidden set holds it by
 * (PB29): one namespace per source, so no two collide — a resource kind and an
 * event kind by slot, a measure, a hand-built row and a `Plan.over` series by
 * key. `data`'s picked series are the pick's own, by their bare keys.
 *
 * @internal
 */
export const planHideId = {
    /** A resource kind, by slot: hiding it hides its rows. */
    resources: (slot: string): string => `resources.${slot}`,
    /** An event kind, by slot: hiding it hides its elements everywhere. */
    events: (slot: string): string => `events.${slot}`,
    /** A measure, by key: hiding it hides its row under each resource. */
    measures: (key: string): string => `measures.${key}`,
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
 * order the canvas draws them. `data`'s series, when they are picked, sit
 * between the two lists: they are the pick's own (the root's `pick`).
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
 * One tab of the library pane on the wire, in the order `library` lists them.
 *
 * - `events` — every event kind's templates, read off the kinds;
 * - `backlog` — every event kind's unscheduled events, read off the kinds;
 * - `series` — what the canvas shows that a viewer can hide;
 * - `tab` — the author's own: its name, its icon, the event kind its cards
 *   land on, and its cards.
 */
export const PlanLibraryTabType = VariantType({
    events: NullType,
    backlog: NullType,
    series: PlanLibrarySeriesType,
    tab: StructType({
        name: StringType,
        icon: OptionType(StringType),
        drop: OptionType(StringType),
        cards: ArrayType(PlanLibraryCardType),
    }),
});

/** Type representing {@link PlanLibraryTabType}. */
export type PlanLibraryTabType = typeof PlanLibraryTabType;

// ============================================================================
// The author's surface
// ============================================================================

/**
 * An author's tab: its name and icon, and the accessors over one of its rows —
 * its value and its key — as `Schedule.resources` takes them.
 *
 * @typeParam K - The rows' key type
 * @typeParam R - Their row type
 * @typeParam P - The patch `drop` returns: `Schedule.Types.Patch` of one event kind's row type
 */
export interface PlanLibraryTabConfig<K extends EastType, R extends EastType, P extends EastType = EastType> {
    /** The tab's name: its label in the tab row. */
    name: string;
    /** A Font Awesome solid icon name for the tab's cards. */
    icon?: string;
    /** The card's name. */
    label: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<StringType>;
    /** The line under it — return the field's `Option`. */
    meta?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** The tab's group the card sits under. */
    group?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<StringType>;
    /** What a card dropped on an event sets: `Schedule.patch(KindRowType, …)`, whose type names the event kind it lands on. */
    drop?: (row: ExprType<R>, key: ExprType<K>) => ExprType<P>;
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
 * Plan's `rows` that row; `data`'s series show and hide through their `pick`.
 * What a viewer hides is kept for them.
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
 * export const planPrintPresses = e3.record("plan_print_presses", DictType(StringType, PrintPress), new Map([
 *     ["a1", { name: "Press A1", hall: "Hall A", sheets_per_hour: 12000.0 }],
 *     ["a2", { name: "Press A2", hall: "Hall A", sheets_per_hour: 10000.0 }],
 *     ["a3", { name: "Press A3", hall: "Hall A", sheets_per_hour: 8000.0 }],
 *     ["b1", { name: "Press B1", hall: "Hall B", sheets_per_hour: 15000.0 }],
 *     ["b2", { name: "Press B2", hall: "Hall B", sheets_per_hour: 12000.0 }],
 *     ["b3", { name: "Press B3", hall: "Hall B", sheets_per_hour: 6000.0 }],
 * ]));
 * export const planPrintCustomers = e3.record("plan_print_customers", DictType(StringType, PrintCustomer), new Map([
 *     ["alder-finch", { name: "Alder & Finch", district: "Old Town", trade: "Retail" }],
 *     ["bluewater-tours", { name: "Bluewater Tours", district: "North Quay", trade: "Travel" }],
 *     ["copperleaf-cafe", { name: "Copperleaf Cafe", district: "Old Town", trade: "Hospitality" }],
 *     ["driftwood-museum", { name: "Driftwood Museum", district: "North Quay", trade: "Arts" }],
 *     ["elmway-college", { name: "Elmway College", district: "Riverside", trade: "Education" }],
 *     ["foxglove-gardens", { name: "Foxglove Gardens", district: "Riverside", trade: "Retail" }],
 *     ["granite-hall", { name: "Granite Hall", district: "Old Town", trade: "Events" }],
 *     ["harbour-arts", { name: "Harbour Arts Society", district: "North Quay", trade: "Arts" }],
 *     ["heathfield", { name: "Heathfield Theatre", district: "Old Town", trade: "Arts" }],
 *     ["ivy-lane", { name: "Ivy Lane Studio", district: "Riverside", trade: "Design" }],
 *     ["juniper-toys", { name: "Juniper Toys", district: "Riverside", trade: "Retail" }],
 *     ["kestrel-cycling", { name: "Kestrel Cycling Club", district: "Riverside", trade: "Sport" }],
 *     ["larkspur-home", { name: "Larkspur Home", district: "Old Town", trade: "Retail" }],
 *     ["meridian-monthly", { name: "Meridian Monthly", district: "North Quay", trade: "Publishing" }],
 *     ["northwind", { name: "Northwind Outfitters", district: "North Quay", trade: "Retail" }],
 *     ["orchard-market", { name: "Orchard Street Market", district: "Old Town", trade: "Markets" }],
 * ]));
 * export const planEventJobs = e3.record("plan_event_jobs", DictType(StringType, PrintJob), new Map([
 *     ["J-3001", { title: "Spring catalogue", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T14:00:00Z")), press: some("a1"), state: variant("actual", null), sheets: 96000.0, customer: "Alder & Finch", stock: variant("coated", null), due: some(new Date("2026-10-08T00:00:00Z")) }],
 *     ["J-3002", { title: "Course handbook", start: some(new Date("2026-10-19T06:00:00Z")), end: some(new Date("2026-10-19T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 144000.0, customer: "Elmway College", stock: variant("uncoated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
 *     ["J-3003", { title: "Annual report", start: some(new Date("2026-10-14T06:00:00Z")), end: some(new Date("2026-10-14T12:00:00Z")), press: some("a2"), state: variant("in-progress", null), sheets: 60000.0, customer: "Harbour Arts Society", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *     ["J-3004", { title: "Club newsletter", start: some(new Date("2026-10-08T06:00:00Z")), end: some(new Date("2026-10-08T08:00:00Z")), press: some("a3"), state: variant("actual", null), sheets: 16000.0, customer: "Kestrel Cycling Club", stock: variant("uncoated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
 *     ["J-3005", { title: "Store flyers", start: some(new Date("2026-10-15T06:00:00Z")), end: some(new Date("2026-10-15T16:00:00Z")), press: some("b1"), state: variant("confirmed", null), sheets: 150000.0, customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *     ["J-3006", { title: "Market posters", start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T12:00:00Z")), press: some("b2"), state: variant("confirmed", null), sheets: 72000.0, customer: "Orchard Street Market", stock: variant("coated", null), due: some(new Date("2026-10-22T00:00:00Z")) }],
 *     ["J-3007", { title: "Loyalty cards", start: some(new Date("2026-10-20T10:00:00Z")), end: some(new Date("2026-10-20T13:00:00Z")), press: some("b2"), state: variant("proposed", variant("added", null)), sheets: 36000.0, customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
 *     ["J-3008", { title: "Gift boxes", start: some(new Date("2026-10-27T06:00:00Z")), end: some(new Date("2026-10-27T12:00:00Z")), press: some("b3"), state: variant("proposed", variant("recommended", null)), sheets: 48000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
 *     ["J-3009", { title: "Ticket books", start: some(new Date("2026-10-22T06:00:00Z")), end: some(new Date("2026-10-22T09:00:00Z")), press: none, state: variant("proposed", variant("added", null)), sheets: 24000.0, customer: "Heathfield Theatre", stock: variant("uncoated", null), due: some(new Date("2026-10-26T00:00:00Z")) }],
 *     ["J-3010", { title: "Guide reprint", start: none, end: none, press: none, state: variant("estimated", null), sheets: 24000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *     ["J-3011", { title: "Wall calendars", start: none, end: none, press: none, state: variant("estimated", null), sheets: 50000.0, customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
 *     ["J-3012", { title: "Spare covers", start: none, end: none, press: none, state: variant("estimated", null), sheets: 8000.0, customer: "Meridian Monthly", stock: variant("board", null), due: none }],
 * ]));
 * export const planEventJobsPatch = e3.mutation.patch(planEventJobs);
 *
 * const planEvents = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const presses = $.let(Record.bind(planPrintPresses, []));
 *         const jobs = $.let(Record.bind(planEventJobs, [planEventJobsPatch]));
 *         const customers = $.let(Record.bind(planPrintCustomers, []));
 *         const axis = $.let(Plan.axis({
 *             window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
 *             resolution: "day", now: new Date("2026-10-14T09:00:00Z"),
 *         }));
 *         return (
 *             <Plan
 *                 id="jobs"
 *                 axis={axis}
 *                 resources={{
 *                     presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name }),
 *                 }}
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
type AnyResourceKind = ScheduleResourceKind<EastType, EastType>;

/** An event kind, its types erased. */
type AnyEventKind = ScheduleEventKind<EastType, EastType>;

/**
 * What a Plan's library is built against.
 *
 * @internal
 */
export interface PlanLibraryContext {
    /** The resource kinds, by slot, in order. */
    readonly resources: readonly (readonly [string, AnyResourceKind])[];
    /** The event kinds, by slot, in order. */
    readonly events: readonly (readonly [string, AnyEventKind])[];
    /** The Plan's `rows`, when given. */
    readonly rows: readonly unknown[] | undefined;
    /** Whether `data`'s series are picked (`pick`), so the Series tab lists them too. */
    readonly picked: boolean;
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

/** The glyph a hand-built row's kind is listed with: its series kind's (`Plan.pick`'s). */
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
 * The Series tab on the wire (PB29): the resource kinds, each followed by its
 * measures, then the event kinds; and the Plan's `rows`.
 *
 * @param ctx - What the library is built against
 * @returns The tab's wire value
 */
function seriesTab(ctx: PlanLibraryContext): ExprType<PlanLibraryTabType> {
    const kinds: ExprType<PickItemType>[] = [];
    for (const [slot, kind] of ctx.resources) {
        kinds.push(item(planHideId.resources(slot), kind.name, undefined, kind.icon));
        const collection = DictType(kind.keyType, kind.rowType);
        kind.measures.forEach((measure, i) => {
            // Checked when the kind was declared: a measure is a series written in place.
            const facts = planSeriesFacts(measure, collection, `Plan: resources.${slot}.measures[${i}]`)!;
            kinds.push(item(planHideId.measures(facts.key), facts.title, kind.name, KIND_ICONS[facts.arm]));
        });
    }
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

/**
 * An author's tab on the wire: its cards, read through its accessors, and the
 * event kind its `drop` lands on, named by the patch's type (PB62).
 *
 * @param tab - The tab
 * @param ctx - What the library is built against
 * @returns The tab's wire value
 * @throws {Error} Naming the tab: rows that are not a `Dict`, or a `drop` over no event kind's row type, or over one two
 *   kinds share
 */
function authorTab(tab: Extract<PlanLibraryTab, { kind: "tab" }>, ctx: PlanLibraryContext): ExprType<PlanLibraryTabType> {
    const cfg = tab.config;
    const where = `Plan: ${tabName(tab)}`;
    const source = East.value(tab.rows as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const type = Expr.type(source as unknown as Expr) as EastType;
    if (type.type !== "Dict") {
        throw new Error(`${where} reads its rows as Schedule.resources does — a Dict, usually a record's read() — and these are ${printType(type)}`);
    }
    const keyType = type.key as EastType;
    const rowType = type.value as EastType;

    // The drop: reified once, its patch's type naming the event kind it lands on.
    let lands: string | undefined;
    let writes: ExprType<FunctionType<[EastType, EastType], ArrayType<typeof ScheduleFieldWriteType>>> | undefined;
    if (cfg.drop !== undefined) {
        const drop = cfg.drop;
        const dropFn = East.function([rowType, keyType], undefined, (_$, row, key) => drop(row, key));
        const patchType = (Expr.type(dropFn as unknown as Expr) as FunctionType).output as EastType;
        const takers = ctx.events.filter(([, kind]) => (kind.rowType as EastType).type === "Struct"
            && isTypeEqual(patchType, SchedulePatchTypeFor(kind.rowType as StructType)));
        if (takers.length === 0) {
            const kinds = ctx.events.map(([slot]) => slot).join(", ");
            throw new Error(`${where}'s \`drop\` returns a patch over no event kind's row type — build it with Schedule.patch(RowType, { … }) ` +
                `over the row type of the kind its cards land on (${kinds === "" ? "this Plan has no event kinds" : kinds})`);
        }
        if (takers.length > 1) {
            throw new Error(`${where}'s \`drop\` returns a patch over a row type ${takers.length} event kinds share ` +
                `(${takers.map(([slot]) => slot).join(", ")}) — a card lands on one kind, so give each kind a row type of its own`);
        }
        lands = takers[0]![0];
        // Each field the patch sets, as the kind's field write: its path, and its value's bytes.
        const fields = Object.keys((patchType as StructType).fields as Record<string, EastType>);
        writes = East.function([rowType, keyType], ArrayType(ScheduleFieldWriteType), ($, row, key) => {
            const patchOf = $.const(dropFn);
            const patch = $.const(patchOf(row as never, key as never)) as unknown as Record<string, ExprType<OptionType<EastType>>>;
            const written = $.let([], ArrayType(ScheduleFieldWriteType));
            for (const name of fields) {
                $.match(patch[name]!, {
                    some: ($2, value) => { $2(written.pushLast({ path: [name], value: East.Blob.encodeBeast(value as ExprType<EastType>, "v2") })); },
                });
            }
            return written;
        }) as unknown as ExprType<FunctionType<[EastType, EastType], ArrayType<typeof ScheduleFieldWriteType>>>;
    }

    // A String key is its own text; any other key as East prints it.
    const text = keyType.type === "String"
        ? East.function([StringType], StringType, (_$, key) => key)
        : East.function([keyType], StringType, (_$, key) => East.print(key));
    const describe = East.function([rowType, keyType], PlanLibraryCardType, ($, row, key) => {
        const keyText = $.const(text as unknown as ExprType<FunctionType<[EastType], StringType>>);
        const sets = $.let([], ArrayType(ScheduleFieldWriteType));
        if (writes !== undefined) {
            const setsOf = $.const(writes);
            $.assign(sets, setsOf(row as never, key as never));
        }
        return {
            key: keyText(key),
            label: cfg.label(row, key),
            meta: cfg.meta !== undefined ? cfg.meta(row, key) : East.value(none, OptionType(StringType)),
            group: cfg.group !== undefined ? some(cfg.group(row, key)) : East.value(none, OptionType(StringType)),
            sets,
        };
    });
    const cards = (source as unknown as ExprType<DictType<EastType, EastType>>).toArray(($, row, key) => {
        const card = $.const(describe);
        return card(row, key);
    });
    return East.value(variant("tab", {
        name: cfg.name,
        icon: cfg.icon === undefined ? none : some(cfg.icon),
        drop: lands === undefined ? none : some(lands),
        cards,
    }), PlanLibraryTabType);
}

/**
 * Builds the library pane on the wire (PB26, PB61, PB62): its tabs in the
 * order `library` lists them; none when it is left out.
 *
 * @param tabs - The tabs, each a `Plan.library.*` call
 * @param ctx - What the library is built against
 * @returns The tabs on the wire
 * @throws {Error} Naming the tab: a tab listed twice (an author's tab by its name); the Events or Backlog tab on a Plan
 *   with no event kinds; the Series tab on a Plan with nothing a viewer can hide; and each of an author's tab's refusals
 * @internal
 */
export function buildLibrary(tabs: readonly PlanLibraryTab[] | undefined, ctx: PlanLibraryContext): ExprType<ArrayType<PlanLibraryTabType>> {
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
        if (tab.kind === "series" && ctx.resources.length === 0 && ctx.events.length === 0 && (ctx.rows ?? []).length === 0 && !ctx.picked) {
            throw new Error("Plan: the library lists Plan.library.series(), and this Plan has nothing a viewer can hide — it lists " +
                "event kinds, resource kinds and their measures, `rows`, and `data`'s series when they are picked (`pick`)");
        }
    }
    const wires = (tabs ?? []).map((tab): ExprType<PlanLibraryTabType> => {
        switch (tab.kind) {
            case "events":
            case "backlog":
                return East.value(variant(tab.kind, null), PlanLibraryTabType);
            case "series":
                return seriesTab(ctx);
            case "tab":
                return authorTab(tab, ctx);
        }
    });
    return East.value(wires, ArrayType(PlanLibraryTabType));
}
