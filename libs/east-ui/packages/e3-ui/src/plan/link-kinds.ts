/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's link kinds (#1541, U10): `Plan.links(record, { name, icon, from,
 * to, quantity?, fields?, key? })`, a kind of link over the app's own record.
 * Each link is a row of the record, its key the link's identity, and each of
 * its ends a field holding the key of the event it joins — as a Schematic's
 * link names its items, and an event kind its resource.
 *
 * - **An end is `{ field, of }`.** With `of` an event kind's slot, the field
 *   holds a key of that kind, in the kind's own key type. With `of` a slot per
 *   case, the field is a variant, each case holding a key of the kind it
 *   names. A field of a type no Dict is keyed by, an Option, or an `of` that
 *   names no slot for a case is refused here, naming the end; whether a key is
 *   of its kind's key type is `<Plan>`'s to check, where the event kinds are
 *   known ({@link PlanLinks.ends}).
 * - **Drawn as a link of the list is.** A link's roles are its two ends, each
 *   an event by its kind's slot and its key's text, and its quantity: the
 *   field its `quantity` names, with the unit and the format given. A quantity
 *   field holding an Option draws a link with none where it holds none.
 * - **Read whole,** counted first and read only within the cap the Plan's
 *   event kinds are read under (`SCHEDULE_EVENT_CAP`): bound
 *   `Record.bind(record)`, its record declaring `patch: mutation.patch()`, to
 *   make, edit and remove links, or `Data.bind(record)` to read them only. A
 *   link has no times and its ends hold keys, which a rail narrows by neither:
 *   a paged binding is refused.
 * - **A new link** takes its ends from the two events a Connect joins, and
 *   every other field its type's default. Its key is made up for a String key
 *   and counted on for an Integer one; a record keyed by any other type gives
 *   `key`, which builds it from the row.
 *
 * The kind closes its record behind East functions over beast2 bytes, as every
 * kind over the app's record does (`utils/record-kind.ts`): the renderer needs
 * no row type.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, DictType, East, EastTypeType, FloatType, FunctionType, IntegerType, OptionType, StringType, StructType,
    defaultValue, isTypeEqual, none, some, toEastTypeValue,
    type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { TickFormatType, type FieldHints } from "@elaraai/east-ui/internal";
import {
    checkKeyField, fieldOf, keyFieldRef, keyFieldRole, keyFieldSlots, keyFieldValue,
    type FieldsOf, type KeyEndField, type KeyEndOf, type KeyField, type KeyFieldRole,
} from "../schedule/fields.js";
import { SCHEDULE_EVENT_CAP } from "../schedule/record-window.js";
import { ScheduleEventRefType } from "../schedule/types.js";
import { optionOf, typeText } from "../schedule/window.js";
import {
    KindSideFields, checkMadeKeys, fieldTypeOf, keyBuilderOf, kindBinding, kindWholeRows, readOf, recordSide, rowWith, storedRows, valuesTypeOf,
    type KindKeyBuilder,
} from "../utils/record-kind.js";
import { PlanQuantityType } from "./types.js";

// ============================================================================
// The wire
// ============================================================================

/**
 * One link's roles, as its kind reads them from the app's row: what the
 * canvas draws it by.
 *
 * @property from - The event it runs from, by its kind's slot and its key's text
 * @property to - The event it runs to
 * @property quantity - What it moves: its weight and its caption; `none`, the thinnest link and no caption
 */
export const PlanLinkRolesType = StructType({ from: ScheduleEventRefType, to: ScheduleEventRefType, quantity: OptionType(PlanQuantityType) });
/** Type representing {@link PlanLinkRolesType}. */
export type PlanLinkRolesType = typeof PlanLinkRolesType;

/** One stored link: its roles, read in the pass that reads its row, and the row as bytes at the record's row type. */
export const PlanLinkEntryType = StructType({ roles: PlanLinkRolesType, row: BlobType });
/** Type representing {@link PlanLinkEntryType}. */
export type PlanLinkEntryType = typeof PlanLinkEntryType;

/**
 * A link's ends, as a Connect writes them: each event by its kind's slot and
 * its key's text, read back at the end field's type.
 *
 * @property from - The event it runs from
 * @property to - The event it runs to
 */
export const PlanLinkEndsType = StructType({ from: ScheduleEventRefType, to: ScheduleEventRefType });
/** Type representing {@link PlanLinkEndsType}. */
export type PlanLinkEndsType = typeof PlanLinkEndsType;

/**
 * A link kind on the wire: the record's side every kind over the app's record
 * carries (`KindSideFields`: whether it is editable, its session with its
 * patch door, its form, its check and its setter), and what the Plan draws and
 * makes its links by.
 *
 * @property key - The kind's slot
 * @property name - Its name: in the Connect tool's menu and the inspector
 * @property icon - Its Font Awesome solid icon
 * @property ends - The event kinds each end may name, by their slots, in order
 * @property count - How many links the record holds
 * @property rows - Its stored links, by their keys' text, each one's roles beside its bytes; `none` past the cap
 *   (`SCHEDULE_EVENT_CAP`), where no link is read
 * @property read - A drafted link's roles, from its bytes and its key's text
 * @property create - A new link between two events, every other field its type's default; `none` for an end of a kind
 *   its field holds no keys of, or a key no key of that kind prints as
 * @property rowKey - A new link's key's text, built from its row; `none`, a String key is made up and an Integer one
 *   counted on
 * @property keyType - Its record's key type
 */
export const PlanLinkKindType = StructType({
    ...KindSideFields,
    key: StringType,
    name: StringType,
    icon: StringType,
    ends: StructType({ from: ArrayType(StringType), to: ArrayType(StringType) }),
    count: FunctionType([], IntegerType),
    rows: FunctionType([], OptionType(DictType(StringType, PlanLinkEntryType))),
    read: FunctionType([BlobType, StringType], PlanLinkRolesType),
    create: FunctionType([PlanLinkEndsType], OptionType(BlobType)),
    rowKey: OptionType(FunctionType([BlobType], StringType)),
    keyType: EastTypeType,
});
/** Type representing {@link PlanLinkKindType}. */
export type PlanLinkKindType = typeof PlanLinkKindType;

// ============================================================================
// Plan.links
// ============================================================================

/**
 * What a link kind's record is, bound: `Record.bind`'s handle or `Data.bind`'s,
 * read whole, over a `Dict<K, R>` — its row type `R` and its key type `K`, any
 * type a Dict may be keyed by, inferred from the handle.
 *
 * @typeParam R - The record's row type
 * @typeParam K - The record's key type
 */
export interface PlanLinksRecord<R extends StructType, K extends EastType = StringType> {
    /** The record, whole. */
    readonly read: (...args: never[]) => ExprType<DictType<K, R>>;
    /** The binding's handle. */
    readonly binding: unknown;
}

/**
 * A link's end: the field holding the key of the event it joins, and the
 * event kind those keys are of — or, for a variant field, a kind per case.
 *
 * @typeParam R - The record's row type
 * @typeParam F - The field
 */
export interface PlanLinkEnd<R extends StructType, F extends string> {
    /** The field: one holding an event kind's key, or a variant holding one per case. */
    field: F;
    /** The event kind its keys are of, by its slot — or, for a variant field, one per case. */
    of: KeyEndOf<R["fields"][F]>;
}

/**
 * What a link moves: the field its quantity is, its unit and how it prints —
 * the link's weight and its caption, as an event kind's `quantity` is a bar's.
 *
 * @typeParam R - The record's row type
 */
export interface PlanLinkQuantity<R extends StructType> {
    /** The Float field the quantity is, or an Option of one: a link holding none draws with no quantity. */
    field: FieldsOf<R, FloatType | OptionType<FloatType>>;
    /** Its unit (`"sheets"`). */
    unit?: string;
    /** How it prints (`Format.*`); omitted, the canvas's plain number. */
    format?: SubtypeExprOrValue<TickFormatType>;
}

/**
 * One kind of link: the feeds between a print works' jobs, each between two
 * events.
 *
 * @typeParam R - The record's row type
 * @typeParam FF - The `from` field
 * @typeParam TF - The `to` field
 * @typeParam K - The record's key type
 */
export interface PlanLinksConfig<R extends StructType, FF extends string, TF extends string, K extends EastType = StringType> {
    /** The kind's name: in the Connect tool's menu and the inspector. */
    name: string;
    /** Its Font Awesome solid icon. */
    icon: string;
    /** The event it runs from. */
    from: PlanLinkEnd<R, FF>;
    /** The event it runs to. */
    to: PlanLinkEnd<R, TF>;
    /** What it moves: its weight and its caption. */
    quantity?: PlanLinkQuantity<R>;
    /** Hints for the inspector's form over every field but its ends. */
    fields?: FieldHints<R["fields"]>;
    /**
     * A new link's key, built from its row — `(feed) => ({ from: feed.from, to: feed.to })`: what a Connect makes one
     * under. Omitted, a String key is made up and an Integer one is one past the largest; an editable kind keyed by
     * any other type needs it.
     */
    key?: KindKeyBuilder<R, K>;
}

/** What marks a link kind's declaration. */
export const PLAN_LINKS: unique symbol = Symbol("Plan.links");

/** A link kind, declared: what `<Plan>` checks against its event kinds, and builds under its slot. */
export interface PlanLinks {
    /** What it is. */
    readonly [PLAN_LINKS]: true;
    /** Its name. */
    readonly name: string;
    /** Its record's row type. */
    readonly rowType: StructType;
    /** Its record's key type. */
    readonly keyType: EastType;
    /** Each end's field, and the event kinds it holds keys of, each with the key it holds: checked against that kind's key type. */
    readonly ends: { readonly from: KeyFieldRole; readonly to: KeyFieldRole };
    /**
     * The kind on the wire, under its slot.
     *
     * @param slot - The slot `links` names it by
     * @returns The kind
     */
    build(slot: string): ExprType<PlanLinkKindType>;
}

/**
 * Whether a value is a link kind `Plan.links` declared.
 *
 * @param value - Any value
 * @returns Whether it is one
 */
export function isPlanLinks(value: unknown): value is PlanLinks {
    return typeof value === "object" && value !== null && (value as { [PLAN_LINKS]?: unknown })[PLAN_LINKS] === true;
}

/**
 * Declares a kind of link over the app's record (see the module docs): each
 * row a link between two events, named by the fields `from` and `to` map.
 *
 * @typeParam R - The record's row type
 * @typeParam FF - The `from` field
 * @typeParam TF - The `to` field
 * @typeParam K - The record's key type
 * @param record - The record, bound: `Record.bind(record)` to make, edit and remove its links, or `Data.bind(record)` to read them
 * @param config - Its name, its icon, its two ends, and its quantity, its form's hints and its key
 * @returns The link kind, for a slot of `<Plan links>`
 * @throws {Error} Naming the option and the remedy: a record that is no binding of a record of structs by key, a
 *   paged binding, or a `Record.bind` without its patch door; no `icon`; an end that is no `{ field, of }`, names a
 *   field the row lacks or one of a type no Dict is keyed by, an Option, or an `of` that names no kind for a case; both
 *   ends naming one field; a `quantity` field that is no Float nor an Option of one, or an end; a `key` that builds
 *   another type than the record's key; and an editable record keyed by neither String nor Integer, given no `key`
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { DateTimeType, DictType, East, FloatType, NullType, OptionType, SortedMap, StringType, StructType, VariantType, compareFor, none, some, variant } from "@elaraai/east";
 * import { EventStateType, Format, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
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
 * export const PrintStock = StructType({ name: StringType, weekly: DictType(DateTimeType, FloatType) });
 * export const PrintPlates = StructType({ title: StringType, at: DateTimeType, setter: StringType });
 * export const PrintBinding = StructType({ title: StringType, start: DateTimeType, end: DateTimeType, line: StringType, state: EventStateType });
 * export const PrintDelivery = StructType({ title: StringType, at: DateTimeType, bay: StringType });
 * export const planLinkStock = e3.input("plan_link_stock", DictType(StringType, PrintStock), variant("value", new Map([
 *     ["board", { name: "Board", weekly: new SortedMap([
 *         [new Date("2026-10-05T00:00:00Z"), 40.0], [new Date("2026-10-12T00:00:00Z"), 22.0], [new Date("2026-10-19T00:00:00Z"), 31.0], [new Date("2026-10-26T00:00:00Z"), 18.0],
 *     ], compareFor(DateTimeType)) }],
 *     ["coated", { name: "Coated", weekly: new SortedMap([
 *         [new Date("2026-10-05T00:00:00Z"), 520.0], [new Date("2026-10-12T00:00:00Z"), 410.0], [new Date("2026-10-19T00:00:00Z"), 460.0], [new Date("2026-10-26T00:00:00Z"), 380.0],
 *     ], compareFor(DateTimeType)) }],
 *     ["uncoated", { name: "Uncoated", weekly: new SortedMap([
 *         [new Date("2026-10-05T00:00:00Z"), 300.0], [new Date("2026-10-12T00:00:00Z"), 260.0], [new Date("2026-10-19T00:00:00Z"), 280.0], [new Date("2026-10-26T00:00:00Z"), 240.0],
 *     ], compareFor(DateTimeType)) }],
 * ])));
 * export const planLinkPlates = e3.record("plan_link_plates", DictType(StringType, PrintPlates), {
 *     initial: new Map([
 *         ["P-01", { title: "Catalogue plates", at: new Date("2026-10-05T12:00:00Z"), setter: "ps" }],
 *     ]),
 *     mutations: (mutation) => ({
 *         // The plates' patch door.
 *         patch: mutation.patch(),
 *     }),
 * });
 * export const PrintLinkCentre = StructType({
 *     name: StringType,
 *     what: VariantType({ setter: NullType, press: StructType({ hall: StringType }), line: NullType, bay: NullType }),
 * });
 * export const planLinkWorks = e3.record("plan_link_works", DictType(StringType, PrintLinkCentre), {
 *     initial: new Map([
 *         ["ps", { name: "Platesetter", what: variant("setter", null) }],
 *         ["a1", { name: "Press A1", what: variant("press", { hall: "Hall A" }) }],
 *         ["a2", { name: "Press A2", what: variant("press", { hall: "Hall A" }) }],
 *         ["a3", { name: "Press A3", what: variant("press", { hall: "Hall A" }) }],
 *         ["b1", { name: "Press B1", what: variant("press", { hall: "Hall B" }) }],
 *         ["b2", { name: "Press B2", what: variant("press", { hall: "Hall B" }) }],
 *         ["b3", { name: "Press B3", what: variant("press", { hall: "Hall B" }) }],
 *         ["fold", { name: "Folder", what: variant("line", null) }],
 *         ["bind", { name: "Binder", what: variant("line", null) }],
 *         ["bay", { name: "Dispatch bay", what: variant("bay", null) }],
 *     ]),
 * });
 * export const planLinkCaseJobs = e3.record("plan_link_case_jobs", DictType(StringType, PrintJob), {
 *     initial: new Map([
 *         ["J-2001", { title: "Catalogue covers", start: some(new Date("2026-10-08T06:00:00Z")), end: some(new Date("2026-10-08T08:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 12000.0, customer: "Larkspur Home", stock: variant("board", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
 *         ["J-2002", { title: "Shop posters", start: some(new Date("2026-10-10T06:00:00Z")), end: some(new Date("2026-10-11T06:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 24000.0, customer: "Orchard Street Market", stock: variant("uncoated", null), due: some(new Date("2026-10-20T00:00:00Z")) }],
 *         ["J-2003", { title: "Catalogue inserts", start: some(new Date("2026-10-15T06:00:00Z")), end: some(new Date("2026-10-17T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 96000.0, customer: "Larkspur Home", stock: variant("coated", null), due: some(new Date("2026-10-19T00:00:00Z")) }],
 *         ["J-2004", { title: "Price lists", start: some(new Date("2026-10-07T12:00:00Z")), end: some(new Date("2026-10-08T18:00:00Z")), press: some("a2"), state: variant("confirmed", null), sheets: 16000.0, customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
 *         ["J-2005", { title: "Menu cards", start: some(new Date("2026-10-11T06:00:00Z")), end: some(new Date("2026-10-11T18:00:00Z")), press: some("a2"), state: variant("confirmed", null), sheets: 30000.0, customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-13T00:00:00Z")) }],
 *         ["J-2006", { title: "Gift tags", start: some(new Date("2026-10-25T06:00:00Z")), end: some(new Date("2026-10-25T18:00:00Z")), press: some("a2"), state: variant("proposed", variant("recommended", null)), sheets: 20000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-28T00:00:00Z")) }],
 *         ["J-2007", { title: "Gift boxes", start: some(new Date("2026-10-27T06:00:00Z")), end: some(new Date("2026-10-27T14:00:00Z")), press: some("a2"), state: variant("proposed", variant("recommended", null)), sheets: 48000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
 *         ["J-2008", { title: "Proof run", start: some(new Date("2026-10-02T06:00:00Z")), end: some(new Date("2026-10-05T18:00:00Z")), press: some("a3"), state: variant("actual", null), sheets: 16000.0, customer: "Meridian Monthly", stock: variant("coated", null), due: some(new Date("2026-10-06T00:00:00Z")) }],
 *         ["J-2009", { title: "Annual report", start: some(new Date("2026-10-19T18:00:00Z")), end: some(new Date("2026-10-21T06:00:00Z")), press: some("a3"), state: variant("confirmed", null), sheets: 48000.0, customer: "Harbour Arts Society", stock: variant("coated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
 *         ["J-2010", { title: "Desk calendars", start: some(new Date("2026-10-28T06:00:00Z")), end: some(new Date("2026-10-29T06:00:00Z")), press: some("a3"), state: variant("proposed", variant("added", null)), sheets: 36000.0, customer: "Foxglove Gardens", stock: variant("board", null), due: some(new Date("2026-11-02T00:00:00Z")) }],
 *         ["J-2011", { title: "Calendar pads", start: some(new Date("2026-10-29T06:00:00Z")), end: some(new Date("2026-10-30T18:00:00Z")), press: some("a3"), state: variant("proposed", variant("added", null)), sheets: 72000.0, customer: "Foxglove Gardens", stock: variant("uncoated", null), due: some(new Date("2026-11-02T00:00:00Z")) }],
 *         ["J-2012", { title: "Proof sheets", start: some(new Date("2026-09-28T06:00:00Z")), end: some(new Date("2026-09-30T18:00:00Z")), press: some("b1"), state: variant("actual", null), sheets: 8000.0, customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-01T00:00:00Z")) }],
 *         ["J-2013", { title: "Catalogue", start: some(new Date("2026-10-12T06:00:00Z")), end: some(new Date("2026-10-13T18:00:00Z")), press: some("b1"), state: variant("confirmed", null), sheets: 144000.0, customer: "Larkspur Home", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *         ["J-2014", { title: "Seed catalogue", start: some(new Date("2026-10-22T06:00:00Z")), end: some(new Date("2026-10-23T12:00:00Z")), press: some("b1"), state: variant("confirmed", null), sheets: 100000.0, customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-26T00:00:00Z")) }],
 *         ["J-2015", { title: "Night run", start: some(new Date("2026-10-05T00:00:00Z")), end: some(new Date("2026-10-05T08:00:00Z")), press: some("b2"), state: variant("actual", null), sheets: 16000.0, customer: "Meridian Monthly", stock: variant("coated", null), due: some(new Date("2026-10-06T00:00:00Z")) }],
 *         ["J-2016", { title: "Store flyers", start: some(new Date("2026-10-16T06:00:00Z")), end: some(new Date("2026-10-16T20:00:00Z")), press: some("b2"), state: variant("confirmed", null), sheets: 96000.0, customer: "Larkspur Home", stock: variant("uncoated", null), due: some(new Date("2026-10-19T00:00:00Z")) }],
 *         ["J-2017", { title: "Seed packets", start: some(new Date("2026-10-23T06:00:00Z")), end: some(new Date("2026-10-24T06:00:00Z")), press: some("b2"), state: variant("confirmed", null), sheets: 72000.0, customer: "Foxglove Gardens", stock: variant("board", null), due: some(new Date("2026-10-27T00:00:00Z")) }],
 *         ["J-2018", { title: "Exhibition book", start: some(new Date("2026-10-26T06:00:00Z")), end: some(new Date("2026-10-27T18:00:00Z")), press: some("b2"), state: variant("proposed", variant("recommended", null)), sheets: 54000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
 *         ["J-2019", { title: "Ticket books", start: some(new Date("2026-10-29T06:00:00Z")), end: some(new Date("2026-10-30T06:00:00Z")), press: some("b2"), state: variant("estimated", null), sheets: 60000.0, customer: "Heathfield Theatre", stock: variant("uncoated", null), due: some(new Date("2026-11-02T00:00:00Z")) }],
 *         ["J-2020", { title: "Card stock", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T14:00:00Z")), press: some("b3"), state: variant("actual", null), sheets: 30000.0, customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-08T00:00:00Z")) }],
 *         ["J-2021", { title: "Book sections", start: some(new Date("2026-10-11T06:00:00Z")), end: some(new Date("2026-10-12T12:00:00Z")), press: some("b3"), state: variant("confirmed", null), sheets: 84000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-14T00:00:00Z")) }],
 *         ["J-2022", { title: "Report covers", start: some(new Date("2026-10-19T06:00:00Z")), end: some(new Date("2026-10-20T18:00:00Z")), press: some("b3"), state: variant("confirmed", null), sheets: 48000.0, customer: "Harbour Arts Society", stock: variant("board", null), due: some(new Date("2026-10-21T00:00:00Z")) }],
 *         ["J-2023", { title: "Spring brochure", start: some(new Date("2026-11-03T06:00:00Z")), end: some(new Date("2026-11-04T18:00:00Z")), press: some("b3"), state: variant("estimated", null), sheets: 60000.0, customer: "Heathfield Theatre", stock: variant("coated", null), due: some(new Date("2026-11-09T00:00:00Z")) }],
 *     ]),
 *     mutations: (mutation) => ({
 *         // The jobs' patch door.
 *         patch: mutation.patch(),
 *     }),
 * });
 * export const planLinkBindings = e3.record("plan_link_bindings", DictType(StringType, PrintBinding), {
 *     initial: new Map([
 *         ["B-01", { title: "Fold sections", start: new Date("2026-10-15T06:00:00Z"), end: new Date("2026-10-16T06:00:00Z"), line: "fold", state: variant("confirmed", null) }],
 *         ["B-02", { title: "Fold sections", start: new Date("2026-10-17T06:00:00Z"), end: new Date("2026-10-18T06:00:00Z"), line: "fold", state: variant("confirmed", null) }],
 *         ["B-03", { title: "Bind books", start: new Date("2026-10-20T18:00:00Z"), end: new Date("2026-10-21T18:00:00Z"), line: "bind", state: variant("confirmed", null) }],
 *         ["B-04", { title: "Bind exhibition book", start: new Date("2026-10-25T06:00:00Z"), end: new Date("2026-10-26T06:00:00Z"), line: "bind", state: variant("proposed", variant("recommended", null)) }],
 *     ]),
 *     mutations: (mutation) => ({
 *         // The bindery's patch door.
 *         patch: mutation.patch(),
 *     }),
 * });
 * export const planLinkDeliveries = e3.record("plan_link_deliveries", DictType(StringType, PrintDelivery), {
 *     initial: new Map([
 *         ["D-01", { title: "Books", at: new Date("2026-10-28T10:00:00Z"), bay: "bay" }],
 *         ["D-02", { title: "Posters", at: new Date("2026-10-20T10:00:00Z"), bay: "bay" }],
 *     ]),
 *     mutations: (mutation) => ({
 *         // The deliveries' patch door.
 *         patch: mutation.patch(),
 *     }),
 * });
 * export const PrintFlow = StructType({
 *     from: VariantType({ plate: StringType, job: StringType, binding: StringType }),
 *     to: VariantType({ job: StringType, binding: StringType, delivery: StringType }),
 *     sheets: OptionType(FloatType),
 * });
 * export const planLinkFlows = e3.record("plan_link_flows", DictType(StringType, PrintFlow), {
 *     initial: new Map([
 *         ["plates", { from: variant("plate", "P-01"), to: variant("job", "J-2001"), sheets: none }],
 *         ["covers", { from: variant("job", "J-2001"), to: variant("job", "J-2013"), sheets: some(12.0) }],
 *         ["card", { from: variant("job", "J-2020"), to: variant("job", "J-2005"), sheets: some(30.0) }],
 *         ["inserts", { from: variant("job", "J-2003"), to: variant("job", "J-2016"), sheets: some(96.0) }],
 *         ["report-covers", { from: variant("job", "J-2022"), to: variant("job", "J-2009"), sheets: some(48.0) }],
 *         ["seed-prints", { from: variant("job", "J-2014"), to: variant("job", "J-2017"), sheets: some(72.0) }],
 *         ["tags", { from: variant("job", "J-2006"), to: variant("job", "J-2007"), sheets: some(20.0) }],
 *         ["pads", { from: variant("job", "J-2010"), to: variant("job", "J-2011"), sheets: some(36.0) }],
 *         ["proofs", { from: variant("job", "J-2008"), to: variant("job", "J-2015"), sheets: some(16.0) }],
 *         ["proof-sheets", { from: variant("job", "J-2012"), to: variant("job", "J-2004"), sheets: some(8.0) }],
 *         ["tickets", { from: variant("job", "J-2019"), to: variant("job", "J-2023"), sheets: some(60.0) }],
 *         ["sections", { from: variant("job", "J-2021"), to: variant("binding", "B-01"), sheets: some(40.0) }],
 *         ["sections-more", { from: variant("job", "J-2021"), to: variant("binding", "B-02"), sheets: some(44.0) }],
 *         ["folded", { from: variant("binding", "B-02"), to: variant("binding", "B-03"), sheets: some(40.0) }],
 *         ["books", { from: variant("binding", "B-03"), to: variant("delivery", "D-01"), sheets: some(36.0) }],
 *         ["posters", { from: variant("job", "J-2002"), to: variant("delivery", "D-02"), sheets: some(24.0) }],
 *         ["book-blocks", { from: variant("job", "J-2018"), to: variant("binding", "B-04"), sheets: some(54.0) }],
 *     ]),
 *     mutations: (mutation) => ({
 *         // The flows' patch door: a flow drawn with the Connect tool, edited or removed saves through it.
 *         patch: mutation.patch(),
 *     }),
 * });
 * const planEventLinks = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const works = $.let(Record.bind(planLinkWorks, []));
 *         const plates = $.let(Record.bind(planLinkPlates));
 *         const jobs = $.let(Record.bind(planLinkCaseJobs));
 *         const bindings = $.let(Record.bind(planLinkBindings));
 *         const deliveries = $.let(Record.bind(planLinkDeliveries));
 *         const flows = $.let(Record.bind(planLinkFlows));
 *         const stock = $.let(Data.bind(planLinkStock));
 *         const axis = $.let(Plan.axis({
 *             window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
 *             resolution: "week", now: new Date("2026-10-14T09:00:00Z"),
 *         }));
 *         return (
 *             <Plan
 *                 axis={axis}
 *                 // The works' centres, one record of rows: each kind of centre a resources series of its own, in the
 *                 // order the links run through them — plates, printing, binding, dispatch.
 *                 data={works.read()}
 *                 series={[
 *                     Plan.series.resources(PrintLinkCentre, { key: "setters", title: "Plate room", icon: "layer-group", match: c => c.what.hasTag("setter"), label: c => c.name }),
 *                     Plan.series.resources(PrintLinkCentre, {
 *                         key: "presses", title: "Presses", icon: "print", match: c => c.what.hasTag("press"), label: c => c.name,
 *                         sub: c => some(c.what.unwrap("press").hall),
 *                     }),
 *                     Plan.series.resources(PrintLinkCentre, { key: "lines", title: "Bindery", icon: "book", match: c => c.what.hasTag("line"), label: c => c.name }),
 *                     Plan.series.resources(PrintLinkCentre, { key: "bays", title: "Dispatch", icon: "warehouse", match: c => c.what.hasTag("bay"), label: c => c.name }),
 *                 ]}
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
 *                             cells: Plan.tableCells(Plan.values("weekly", (level) => ({ value: level }))),
 *                             format: Format.Number({ maximumFractionDigits: 0n }),
 *                         }),
 *                     ]),
 *                 ]}
 *                 // The works' flows, one link kind over a record of its own (#1541, U10): each row a link, its ends
 *                 // the keys of the events it joins — a case for each kind of event an end may name. Each quantity is
 *                 // in thousands of sheets, its third of the family's largest setting the link's weight; the plates'
 *                 // flow carries none. A flow is drawn with the Connect tool, and saved with the Plan's other drafts.
 *                 links={{
 *                     flow: Plan.links(flows, {
 *                         name: "Flow", icon: "arrow-right-long",
 *                         from: { field: "from", of: { plate: "plate", job: "job", binding: "binding" } },
 *                         to: { field: "to", of: { job: "job", binding: "binding", delivery: "delivery" } },
 *                         quantity: { field: "sheets", unit: "k sheets" },
 *                     }),
 *                 }}
 *                 style={{ height: "400px" }}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function planLinks<R extends StructType, FF extends KeyEndField<R>, TF extends KeyEndField<R>, K extends EastType = StringType>(
    record: PlanLinksRecord<R, K>, config: PlanLinksConfig<R, FF, TF, K>,
): PlanLinks {
    const where = `Plan.links: "${config.name}"`;
    const forms = "bind Record.bind(record), its record declaring patch: mutation.patch(), to make and edit them, or Data.bind(record) to read them";
    const bound = kindBinding(record, where, {
        refuse: (why) => `${where}: the links are a record of the app's, read whole: ${forms}${why}`,
        whole: " — and this is Data.bindPaged(record): a link has no times and its ends hold keys, which a rail narrows by neither",
        // A kind read whole refuses every paged binding before its indexes or its window are asked.
        indexes: "",
        window: "",
        rows: (holds) => `${where}: the links' record holds its links by key, each a struct — and this one holds ${holds}`,
        paged: `${where}: Data.bindPaged(record)`,
        door: `${where}: the links' record is bound without its patch door — its record declares patch: mutation.patch(), which Save writes each link through`,
    });
    const rowType = bound.rowType;
    const fields = rowType.fields as Record<string, EastType>;
    const typeOf = fieldTypeOf(rowType, where);
    if (typeof config.icon !== "string") throw new Error(`${where}: \`icon\` is a Font Awesome solid icon's name`);
    const end = (prop: "from" | "to", given: { field: string; of: unknown } | undefined): KeyField => {
        if (given === undefined || typeof given.field !== "string") {
            throw new Error(`${where}: \`${prop}\` is { field, of } — the field holding an event's key, and the event kind it holds keys of`);
        }
        const checked = checkKeyField(given.field, typeOf(`${prop}.field`, given.field), given.of, { where, prop, noun: "event" });
        if (checked.optional) {
            throw new Error(`${where}: a link has both its ends — \`${prop}.field\` names a field holding an event's key, or a variant holding one per case, ` +
                `never an Option — and "${given.field}" holds ${typeText(fields[given.field]!)}`);
        }
        return checked;
    };
    const from = end("from", config.from as { field: string; of: unknown });
    const to = end("to", config.to as { field: string; of: unknown });
    if (from.field === to.field) throw new Error(`${where}: \`from\` and \`to\` both name "${from.field}" — a link's ends are two fields`);
    // What it moves: a Float field, or an Option of one, a link holding none drawn with no quantity.
    const quantity = config.quantity;
    let quantityOptional = false;
    if (quantity !== undefined) {
        const held = typeOf("quantity.field", quantity.field);
        quantityOptional = optionOf(held) !== undefined;
        if (!isTypeEqual(optionOf(held) ?? held, FloatType)) {
            throw new Error(`${where}: \`quantity.field\` names a Float field, or an Option of one, the quantity a link moves — "${quantity.field}" holds ${typeText(held)}`);
        }
    }
    const format = quantity?.format === undefined ? undefined : East.value(quantity.format, TickFormatType);
    // A new link's key, built from its row — never typed, so an editable kind keyed by another type needs it (#1549).
    const keyBuilt = keyBuilderOf(bound.keyType, rowType, where, "a link", config.key);
    checkMadeKeys(bound, keyBuilt, where, "links", "Connect makes one");
    const fromRef = keyFieldRef(from, rowType);
    const toRef = keyFieldRef(to, rowType);
    const fromValue = keyFieldValue(from, fields[from.field]!);
    const toValue = keyFieldValue(to, fields[to.field]!);
    const quantityOf = (value: ExprType<FloatType>) => East.value({
        value,
        unit: quantity?.unit === undefined ? none : some(quantity.unit),
        format: format === undefined ? none : some(format),
        text: none,
    }, PlanQuantityType);

    const rolesOf = East.function([rowType, bound.keyType], PlanLinkRolesType, ($, row, _key) => {
        const fromOf = $.const(fromRef);
        const toOf = $.const(toRef);
        const moved = quantity === undefined ? East.value(none, OptionType(PlanQuantityType))
            : quantityOptional
                ? (fieldOf(row, quantity.field) as unknown as ExprType<OptionType<FloatType>>).match({
                    none: (_$2) => East.value(none, OptionType(PlanQuantityType)),
                    some: (_$2, value) => East.value(some(quantityOf(value)), OptionType(PlanQuantityType)),
                })
                : East.value(some(quantityOf(fieldOf(row, quantity.field) as unknown as ExprType<FloatType>)), OptionType(PlanQuantityType));
        return East.value({ from: fromOf(row as never).unwrap(), to: toOf(row as never).unwrap(), quantity: moved }, PlanLinkRolesType);
    }) as unknown as ExprType<FunctionType<[EastType, EastType], EastType>>;

    // A new link between two events: its ends written from them, every other field its type's default; `none` for an
    // end of a kind the field holds no keys of.
    const ValuesType = valuesTypeOf(rowType, [from.field, to.field]);
    const blank = East.value(defaultValue(ValuesType) as never, ValuesType) as ExprType<EastType>;
    const create = East.function([PlanLinkEndsType], OptionType(BlobType), ($, ends) => {
        const fromOf = $.const(fromValue);
        const toOf = $.const(toValue);
        const result = $.let(East.value(none, OptionType(BlobType)), OptionType(BlobType));
        $.match(fromOf(some(ends.from)), {
            some: ($2, f) => {
                $2.match(toOf(some(ends.to)), {
                    some: ($3, t) => {
                        $3.assign(result, East.value(some(East.Blob.encodeBeast(rowWith(rowType, blank, { [from.field]: f, [to.field]: t }), "v2")), OptionType(BlobType)));
                    },
                });
            },
        });
        return result;
    });

    // Read whole, counted first, and read only within the cap an event kind is read under.
    const Held = DictType(bound.keyType, rowType);
    const whole = kindWholeRows(bound.handle, bound.keyType, rowType);
    const read = (bound.handle as unknown as { read: () => ExprType<DictType<EastType, StructType>> }).read;
    const count = East.function([], IntegerType, (_$) => read().size());
    const capped = East.function([], OptionType(Held), ($) => {
        const all = $.const(whole);
        const result = $.let(East.value(none as never, OptionType(Held)), OptionType(Held));
        $.match(all(), {
            some: ($2, held) => {
                $2.if(held.size().lessEqual(BigInt(SCHEDULE_EVENT_CAP)), ($3) => { $3.assign(result, East.value(some(held) as never, OptionType(Held))); });
            },
        });
        return result;
    }) as unknown as typeof whole;

    return {
        [PLAN_LINKS]: true,
        name: config.name,
        rowType,
        keyType: bound.keyType,
        // Each end as `<Plan>` checks it against its kinds' key types: the key it holds of each — the field's own, or its case's.
        ends: { from: keyFieldRole(from), to: keyFieldRole(to) },
        build(slot) {
            const side = recordSide(bound, undefined, undefined, config.fields === undefined ? {} : { fields: config.fields }, [from.field, to.field], where);
            return East.value({
                ...side,
                key: slot,
                name: config.name,
                icon: config.icon,
                ends: { from: keyFieldSlots(from), to: keyFieldSlots(to) },
                count,
                rows: storedRows(capped, bound.keyType, rolesOf, PlanLinkEntryType),
                read: readOf(bound.keyType, rowType, rolesOf, PlanLinkRolesType),
                create,
                rowKey: keyBuilt === undefined ? none : some(keyBuilt),
                keyType: toEastTypeValue(bound.keyType),
            } as never, PlanLinkKindType) as ExprType<PlanLinkKindType>;
        },
    };
}
