/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule.events(record, config)` (#1218, `Calendar Spec.md` §4.1): one
 * event kind — shifts, jobs, inspections — a record of its own, bound with its
 * patch mutation, each of its entries one event.
 *
 * Field names say what a gesture writes (`title`, `start`, `end`, `resource`,
 * `status`), so a move, a resize or a drop writes the app's own fields; an
 * accessor `(row, key) => …` gives what is not a field (a backlog row's
 * duration and due date). Every name is checked against the record's row type
 * at compile time, and again at build, naming itself.
 *
 * Plan's options sit beside the Calendar's (#1190, `Plan Builder Spec.md`
 * §4.1): how the kind draws (`draw`), an instant kind's one time (`at`, in
 * place of `start` and `end`), the fields its events' lifecycle, quantity
 * and lane are read from (`state`, `quantity`, `lane`), whether two of its
 * events on one resource at once are a conflict (`overlaps`), and the kind's
 * own inspector for one event (`inspector`, #1197).
 *
 * The builders over the app's own records take their roles beside Plan's
 * (#1367, `Builder Interfaces Spec.md` §4.1): the Roster's — the fields a
 * duty's shift, group, position and activity are (`shift`, `group`,
 * `position`, `activity`), and the hours it counts (`hours`, an accessor) —
 * and the Allocation's — the fields a bin's arrival, parts, hold and kind are
 * (`arrival`, `parts`, `hold`, `kind`). A kind is one builder's or the
 * other's. A builder ignores the roles it has no use for, so one record of
 * duties drives a Calendar and the Roster at once. `title` is optional: the
 * Calendar and Plan, which draw it, refuse a kind without one.
 *
 * The kind closes the record behind East functions over beast2 bytes
 * ({@link ScheduleKindType}): its events over a window and its backlog, each
 * with the drafts in place; a gesture written into an entry; the author's
 * readiness check; the shared editing session over the record, which commits
 * each Save through its patch mutation (`Record.onApply(record, { keyed:
 * true })`); and its history. A builder's payload is one type whatever the
 * records hold, and the renderer never needs a row type.
 *
 * A builder's `Slice.bindRecords` narrows a kind through the source it names
 * after the kind's slot (#1343): the builder hands that part to `build(slot,
 * part)`, and the kind reads overlap queries through its declared interval
 * indexes (the source's `range` naming the start field). It shares the
 * toolbar's filters and window, counts original events once, and reads backlog
 * through the same choices with an Unset start. It requires `entries` for
 * original-key inspection and Save. Existing drafts outside a new narrowing
 * remain in the session; Save includes them. A kind narrowed so takes no
 * `window` or `backlogWindow`.
 *
 * A large record may also be read a window at a time (#1199, `window.ts`): given
 * `window`, a paged read of a day index keyed by `Schedule.days`, the kind's
 * events over a window are the rows the index files under the days in view,
 * and given `backlogWindow`, a paged read of an index keyed by
 * `Schedule.unscheduled`, its backlog is the rows that index holds — the
 * record never read whole by either, the drafts in place over them as over the
 * whole record. A kind read through its day index whose times are Options
 * reads its backlog through its backlog index too, and every kind given
 * `window` reads one event by its key through `entries`, a paged read of the
 * record's own entries: the inspector's event (`planEvent`, which looks first
 * among the rows the windows hold, where a gesture's event is drawn), and its
 * editing session's, which is a session over the record's revision rather
 * than its snapshot — its drafts held by key, each checked by the record
 * against what it began from, and a Save's entries read back by key. It builds
 * four ways:
 * `build(slot, part)` is the Calendar's kind, which takes no notice of Plan's
 * options; `buildPlan(slot, part)` Plan's ({@link PlanEventKindType}), the
 * same kind with how it draws, its roles, and its events as Plan draws them;
 * and `buildRoster(slot, part)` the Roster's ({@link ScheduleRosterKindType})
 * and `buildAllocation(slot, part)` the Allocation's
 * ({@link ScheduleAllocationKindType}): the Calendar's kind, its form over the
 * fields none of the builder's roles writes, with the stored rows of a
 * period, and the builder's roles read from a row and written into one —
 * every other field of the row as it was (B1), a new row's its type's
 * default.
 *
 * A record may be keyed by any type: an event is named by its key's text, a
 * String key as it is, any other key as East prints it.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, BooleanType, DateTimeType, DictType, East, Expr, FloatType, IntegerType, OptionType, StringType, StructType,
    defaultValue, isTypeEqual, none, printType, some, toEastTypeValue, variant,
    type EastType, type ExprType, type FunctionType, type NullType, type SetType, type SubtypeExprOrValue, type VariantType,
} from "@elaraai/east";
import { EventStateType, TimeStepType, type UIComponentType } from "@elaraai/east-ui";
import { EditingDraftFieldType, EditingReadinessType, Fields, FieldSpecType, TickFormatType, type FieldHints } from "@elaraai/east-ui/internal";
import type { PlanDrawLiteral } from "../plan/types.js";
import { RowInspectorType, rowInspector } from "../utils/row-inspector.js";
import { scheduleAccessor } from "./accessor.js";
import { SCHEDULE_TEMPLATES, checkedTemplates, type ScheduleTemplates } from "./templates.js";
import { SCHEDULE_DEF } from "./resources.js";
import { scheduleRecordWindow, type ScheduleKindPart } from "./record-window.js";
import { scheduleRecordSession } from "./session.js";
import { checkEntries, checkIndexWindow, optionOf, scheduleBacklogWindow, scheduleDayWindow, typeText } from "./window.js";
import {
    PlanEventItemType, PlanEventKindType, PlanEventReadType, ScheduleAllocationEntryType, ScheduleAllocationKindType, ScheduleAllocationRolesType,
    ScheduleClockType, ScheduleDraftsType, ScheduleDurationType, ScheduleItemType, ScheduleKindType, ScheduleReadyEntryType, ScheduleResourceRefType,
    ScheduleRosterEntryType, ScheduleRosterKindType, ScheduleRosterRolesType, ScheduleStatusCasesFor, ScheduleStatusType, ScheduleWriteType,
    ScheduleTemplateType, ScheduleReadType, type ScheduleStatusCasesType,
} from "./types.js";

// ============================================================================
// The record, and its fields by type
// ============================================================================

/**
 * A record bound with its patch mutation, as a kind reads it — what
 * `Record.bind(record, [e3.mutation.patch(record)])` returns for a `Dict`.
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 */
export interface ScheduleRecordHandle<K extends EastType, R extends EastType> {
    /** The record's entries. */
    read: (...args: never[]) => ExprType<DictType<K, R>>;
    /** The record's commits. */
    history: unknown;
    /** The record's writes, its patch door among them. */
    commit: unknown;
    /** The record's binding. */
    binding: unknown;
}

/** The names of a struct's fields. */
type FieldName<R extends StructType> = keyof R["fields"] & string;

/** The fields of a struct whose type is `T`. */
type FieldsOf<R extends StructType, T> = { [F in FieldName<R>]: R["fields"][F] extends T ? F : never }[FieldName<R>];

/** Whether a variant's cases are an Option's. */
type IsOption<C> = "none" extends keyof C ? ("some" extends keyof C ? true : false) : false;

/** Whether every case of a variant holds a String. */
type StringCases<C> = [C[keyof C]] extends [StringType] ? true : false;

/** A type with its Option taken off, once: a resource field may be an Option of what it holds, never an Option of an Option. */
type Unwrapped<T> = T extends VariantType<infer C> ? (IsOption<C> extends true ? C["some" & keyof C] : T) : T;

/** What a resource field holds, its Option taken off: a key of one kind (`"key"`), or a case per kind (`"cases"`). */
type ResourceShapeOf<T> = T extends StringType ? "key" : T extends VariantType<infer C> ? (StringCases<C> extends true ? "cases" : never) : never;

/** What a resource field holds: a key of one kind (`"key"`), or a case per kind (`"cases"`). */
type ResourceShape<T> = ResourceShapeOf<Unwrapped<T>>;

/** A String field of the row: an event's title, or the lane its tile sits in. */
export type ScheduleStringField<R extends StructType> = FieldsOf<R, StringType>;

/** A DateTime field of the row, or an Option of one: an event's start or end. */
export type ScheduleInstantField<R extends StructType> = FieldsOf<R, DateTimeType | OptionType<DateTimeType>>;

/** A plain DateTime field of the row: an instant kind's one time (`at`). */
export type ScheduleAtField<R extends StructType> = FieldsOf<R, DateTimeType>;

/** A Float field of the row: an event's quantity. */
export type ScheduleFloatField<R extends StructType> = FieldsOf<R, FloatType>;

/** An Integer field of the row: a Roster target's positions. */
export type ScheduleIntegerField<R extends StructType> = FieldsOf<R, IntegerType>;

/** An `EventStateType` field of the row: the lifecycle an event wears on a Plan. */
export type ScheduleStateField<R extends StructType> = FieldsOf<R, EventStateType>;

/** An `Option<String>` field of the row: a duty's activity, a bin's arrival or its kind. */
export type ScheduleOptionStringField<R extends StructType> = FieldsOf<R, OptionType<StringType>>;

/** A `TimeStep` field of the row (east-ui's `TimeStepType`): how long a resource holds a bin. */
export type ScheduleTimeStepField<R extends StructType> = FieldsOf<R, TimeStepType>;

/** A `Dict<String, Float>` field of the row: a bin's quantity on each resource, by its key. */
export type ScheduleDictFloatField<R extends StructType> = FieldsOf<R, DictType<StringType, FloatType>>;

/** A `Set<String>` field of the row: the proposals a period dismissed. */
export type ScheduleSetStringField<R extends StructType> = FieldsOf<R, SetType<StringType>>;

/** The cases of a variant, by name. */
export type ScheduleCaseOf<T> = T extends VariantType<infer C> ? keyof C & string : never;

/**
 * A field of the row that names a resource: a String or an `Option<String>`,
 * holding a key of one resource kind; or a variant of String cases, or an
 * Option of one, holding a key of the kind its case names.
 */
export type ScheduleResourceField<R extends StructType> = {
    [F in FieldName<R>]: [ResourceShape<R["fields"][F]>] extends [never] ? never : F
}[FieldName<R>];

/** What `of` takes for a resource field, its Option taken off. */
type ResourceOfUnwrapped<T> = T extends StringType ? string : T extends VariantType<infer C> ? { readonly [K in keyof C]: string } : never;

/** What `of` takes for a resource field: a resource slot's name, or one per case. */
export type ScheduleResourceOf<T> = ResourceOfUnwrapped<Unwrapped<T>>;

/** A variant field of the row, not an Option: an event's status. */
export type ScheduleStatusField<R extends StructType> = {
    [F in FieldName<R>]: R["fields"][F] extends VariantType<infer C> ? (IsOption<C> extends true ? never : F) : never
}[FieldName<R>];

/** The status table a status variant takes: one Status per case. */
export type ScheduleStatusCasesOf<T> = T extends VariantType<infer C> ? ScheduleStatusCasesType<C> : never;

/** A template's values: the row's fields less the ones a drop places (the start, the end and the resource, or an instant's `at`). */
export type ScheduleValuesOf<R extends StructType, Placed extends string> = StructType<{
    [F in Exclude<FieldName<R>, Placed>]: R["fields"][F]
}>;

// ============================================================================
// The config
// ============================================================================

/**
 * A backlog: how long an unscheduled row takes, and when it is due.
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 */
export interface ScheduleBacklog<K extends EastType, R extends EastType> {
    /** How long an unscheduled row takes, which sizes it when it is dropped. */
    duration: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<ScheduleDurationType>;
    /** When it is due, which groups the backlog. */
    due?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<DateTimeType>>;
}

/**
 * A preset the library lists: dropped, it creates an event of its kind.
 *
 * @typeParam V - Its values' type: the row's fields less the start, the end and the resource
 */
export interface ScheduleTemplate<V extends StructType> {
    /** Unique within its kind. */
    key: string;
    /** The card's name. */
    name: string;
    /** The library's group for it. */
    group?: string;
    /** When it starts if dropped on a whole day: `{ hour: 6n, minute: 0n }`. */
    at?: SubtypeExprOrValue<ScheduleClockType>;
    /** How long it runs: `variant("hours", 8)`. */
    duration: SubtypeExprOrValue<ScheduleDurationType>;
    /** A value for every field but the start, the end and the resource. */
    values: SubtypeExprOrValue<V>;
}

/**
 * A preset of an instant kind: dropped, it creates an event at one time, so
 * it has no duration.
 *
 * @typeParam V - Its values' type: the row's fields less `at` and the resource
 */
export type ScheduleInstantTemplate<V extends StructType> = Omit<ScheduleTemplate<V>, "duration">;

/**
 * How a status variant shows, case by case.
 *
 * @typeParam R - The row type
 * @typeParam SF - The status field
 */
export interface ScheduleStatusConfig<R extends StructType, SF extends string> {
    /** The status field: a variant, not an Option. */
    field: SF;
    /** One Status per case: its words, its tone and whether it is an open ring. */
    cases: SubtypeExprOrValue<ScheduleStatusCasesOf<R["fields"][SF]>>;
}

/**
 * A quantity an event carries: what a Plan's bar prints after its label, and
 * a parent's rollup sums, unit by unit.
 *
 * @typeParam R - The row type
 */
export interface ScheduleQuantity<R extends StructType> {
    /** The Float field the quantity is. */
    field: ScheduleFloatField<R>;
    /** Its unit (`"sheets"`): quantities in different units never sum together. */
    unit?: string;
    /** How it prints (`Format.*`); omitted, the canvas's plain number. */
    format?: SubtypeExprOrValue<TickFormatType>;
}

/** Whether two events of a kind on one resource at once are a conflict: `warn` (the default) or `allow`. */
export type ScheduleOverlapsLiteral = "warn" | "allow";

/**
 * The bin's parts, the Allocation's: the field holding its quantity on each
 * resource, by key, and the resource slot those keys are of.
 *
 * @typeParam R - The row type
 */
export interface ScheduleParts<R extends StructType> {
    /** The `Dict<String, Float>` field: the quantity on each resource, by its key; empty while the bin is linked to none. */
    field: ScheduleDictFloatField<R>;
    /** The resource slot its keys are of: the builder's `resources` slot of the resources a bin is allocated to (`kilns`). */
    of: string;
}

/**
 * What every event kind declares, whether its events run from a start to an
 * end or are each one instant (`Calendar Spec.md` §4.1, `Plan Builder Spec.md`
 * §4.1, `Builder Interfaces Spec.md` §4.1). An option a builder has no use
 * for is accepted and ignored there: the Calendar takes no notice of Plan's,
 * the Roster's or the Allocation's.
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 * @typeParam F - The resource field, when the kind has one
 * @typeParam SF - The status field, when the kind has one
 */
export interface ScheduleEventsBase<K extends EastType, R extends StructType, F extends string, SF extends string> {
    /** The kind's name: on its events, in the filter and the inspector. */
    name: string;
    /** Its Font Awesome icon. */
    icon: string;
    /**
     * The String field an event's title is: drawn on its block, edited in the inspector. The Calendar and Plan, which
     * draw it, require it; the Roster and the Allocation draw a duty and a bin by their roles, and take no notice of it.
     */
    title?: ScheduleStringField<R>;
    /** The resource an event is on: a key field of one kind (`of: "people"`), or a variant field with a kind per case. Omitted, no resource. */
    resource?: { field: F; of: ScheduleResourceOf<R["fields"][F]> };
    /** A variant field shown as the event's status, a Status per case. On a Plan, a warning tone rings the element. */
    status?: ScheduleStatusConfig<R, SF>;
    /** Hints for the inspector's form over the other fields (`Schedule.field`, east-ui's `Fields`). */
    fields?: FieldHints<R["fields"]>;
    /** The app's check on a drafted event: a refusal holds Save, naming the event and the field. */
    ready?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<typeof EditingReadinessType>;
    /**
     * A paged read of a day index over the record (`Data.bindPaged(record, {
     * index, join: true })`), keyed by `Schedule.days`: the kind's events over
     * a window are the rows the index files under the days in view, and the
     * record is never read whole for them (#1199). A kind whose times are
     * Options reads its backlog through `backlogWindow` beside it, and every
     * kind given it reads one event by its key through `entries`.
     */
    window?: unknown;
    /**
     * A paged read of the record's own entries (`Data.bindPaged(record)`),
     * beside `window` (#1199) or the kind's source of its builder's slice
     * (#1343): one event read by its key — its key sought, then a one-row page —
     * for the inspector, and for the editing session, whose base is the record's
     * revision: a draft's original, a Save's entries read back, a conflict's
     * entries named. Required with either.
     */
    entries?: unknown;
    /** Plan: the `EventStateType` field whose lifecycle its events wear. Omitted, confirmed. */
    state?: ScheduleStateField<R>;
    /** Plan: the Float field a bar prints and a parent's rollup sums, unit by unit. */
    quantity?: ScheduleQuantity<R>;
    /** Plan: the String field naming the lane a tile sits in (AM, PM). */
    lane?: ScheduleStringField<R>;
    /** Whether two events of the kind on one resource at once are a conflict (`"warn"`, the default) or run in parallel (`"allow"`). */
    overlaps?: ScheduleOverlapsLiteral;
    /** The Roster: the String field naming a duty's shift, a key of its `shifts`. The Roster requires it. */
    shift?: ScheduleStringField<R>;
    /** The Roster: the String field naming the group a duty is rostered in, a key of its `groups`. The Roster requires it. */
    group?: ScheduleStringField<R>;
    /** The Roster: the String field naming the position a duty holds, a key of its `positions`, which its lead rule reads. Omitted, no positions and no lead rule. */
    position?: ScheduleStringField<R>;
    /** The Roster: the `Option<String>` field naming a duty's one skill or task, a key of its `activities`. */
    activity?: ScheduleOptionStringField<R>;
    /** The Roster: the hours a duty counts for coverage, skill hours, contract hours, rest and pay. Omitted, its length. */
    hours?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<FloatType>;
    /** The Allocation: the `Option<String>` field naming the arrival a bin books, a key of its `arrivals`; `none` is a reservation. The Allocation requires it. */
    arrival?: ScheduleOptionStringField<R>;
    /** The Allocation: a bin's quantity on each resource, and the resource slot it is on. The Allocation requires it. */
    parts?: ScheduleParts<R>;
    /** The Allocation: the TimeStep field holding how long a resource holds a bin, kept from booking. The Allocation requires it. */
    hold?: ScheduleTimeStepField<R>;
    /** The Allocation: the `Option<String>` field naming what a bin goes with on a resource, kept from booking. Omitted, kind mates don't score. */
    kind?: ScheduleOptionStringField<R>;
    /**
     * Plan and Calendar: the kind's own inspector for one event (PB60) — an East function
     * over the event's row and a writer of the edited row,
     * `(row, update) => UIComponentType`, passed through untouched (never
     * called at build), capturing only data and bind handles. A Plan's
     * inspector pane shows what it returns for one event of the kind, in place
     * of the kind's form over `fields`; `update(edited)` writes the edited
     * event back as one transaction. Omitted, the form.
     */
    inspector?: SubtypeExprOrValue<FunctionType<[R, FunctionType<[R], NullType>], UIComponentType>>;
}

/**
 * An event kind whose events run from a start to an end (`Calendar Spec.md`
 * §4.1).
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 * @typeParam S - The start field
 * @typeParam E - The end field
 * @typeParam F - The resource field, when the kind has one
 * @typeParam SF - The status field, when the kind has one
 */
export interface ScheduleEventsConfig<K extends EastType, R extends StructType, S extends string, E extends string, F extends string, SF extends string = never>
    extends ScheduleEventsBase<K, R, F, SF> {
    /** The field an event starts at: a DateTime, or an Option of one, which gives the kind a backlog. */
    start: S;
    /** The field an event ends at: of the start's type. */
    end: E;
    /** Plan: how it draws — bars (`"span"`, the default), tiles in bucket cells, chips over whole buckets, or marks at its start. */
    draw?: PlanDrawLiteral;
    /** For Option times: how long an unscheduled row takes, and when it is due. */
    backlog?: R["fields"][S] extends OptionType<DateTimeType> ? ScheduleBacklog<K, R> : never;
    /** The presets the library lists. */
    templates?: readonly ScheduleTemplate<ScheduleValuesOf<R, S | E | F>>[] | ScheduleTemplates<ScheduleValuesOf<R, S | E | F>>;
    /**
     * A paged read of a backlog index over the record (`Data.bindPaged(record,
     * { index, join: true })`), keyed by `Schedule.unscheduled`: the kind's
     * backlog is the rows the index holds (#1199).
     */
    backlogWindow?: unknown;
}

/**
 * An event kind whose events are each one instant (`Plan Builder Spec.md`
 * §4.1): a plate change, a delivery. Drawn as tiles or marks.
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 * @typeParam A - The instant's field
 * @typeParam F - The resource field, when the kind has one
 * @typeParam SF - The status field, when the kind has one
 */
export interface ScheduleInstantEventsConfig<K extends EastType, R extends StructType, A extends string, F extends string, SF extends string = never>
    extends ScheduleEventsBase<K, R, F, SF> {
    /** The DateTime field an event is at, in place of `start` and `end`. */
    at: A;
    /** Plan: how it draws — marks (the default) or tiles in bucket cells. */
    draw?: "buckets" | "marks";
    /**
     * The presets the library lists — a templates record's (`Schedule.templates(rows, { name, values, source })`,
     * #1344); an instant has no duration, so the templates give none.
     */
    templates?: readonly ScheduleInstantTemplate<ScheduleValuesOf<R, A | F>>[] | ScheduleTemplates<ScheduleValuesOf<R, A | F>>;
}

/**
 * An event kind, declared: what a builder's `events` takes, by slot.
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 */
export interface ScheduleEventKind<K extends EastType, R extends EastType> {
    /** What it is. */
    readonly [SCHEDULE_DEF]: "events";
    /** The record's key type. */
    readonly keyType: K;
    /** Its row type. */
    readonly rowType: R;
    /** Its name. */
    readonly name: string;
    /** Its Font Awesome icon: what each of its elements on a Plan wears (#1192). */
    readonly icon: string;
    /** The String field its events' titles are; `undefined` for a kind with none, which the Calendar and Plan refuse (#1367). */
    readonly title: string | undefined;
    /** The resource kinds its events may be on, by slot name: `resource.of`'s. */
    readonly takes: readonly string[];
    /** Plan: how it draws — bars, tiles, chips or marks; a resource draws a row for each way its kinds draw (#1192). */
    readonly draw: PlanDrawLiteral;
    /** The builder's Slice source its templates list names, whose shown keys filter its templates (#1343); `undefined` for none. */
    readonly templatesSource: string | undefined;
    /**
     * How its templates are declared: none, a list written in the code, or a
     * record's (`Schedule.templates`) — what a builder checks (#1343): every
     * templates list is a record of its own, naming its source of the slice.
     */
    readonly templatesList: "none" | "code" | "record";
    /**
     * The Roster's and the Allocation's roles it maps, by their options' names
     * (`shift`, `position`, `arrival`, …): what a builder checks its own props
     * against at build (#1368) — the Roster refuses `positions` beside a kind
     * with no `position`.
     */
    readonly roles: readonly string[];
    /**
     * The resource slot its bins' parts are on, `parts.of` (#1371): what the
     * Allocation checks its `resources` against and names its slice's sources
     * by at build, as `takes` is `resource.of`'s; `undefined` for a kind with
     * no `parts`.
     */
    readonly partsOf: string | undefined;
    /**
     * The fields of its row none of the Allocation's roles maps, a struct
     * (#1371, B13): what an arrival's `values` gives a bin booked from it,
     * each field its type's default without them. The Allocation holds its
     * arrivals' `values` to it at build, and `buildAllocation` carries it as
     * the kind's `values`.
     */
    readonly allocationValues: StructType;
    /**
     * The kind on the wire, under its slot: the Calendar's, which takes no
     * notice of Plan's options.
     *
     * @param slot - The builder's slot name for it
     * @param part - Its source of the builder's `Slice.bindRecords`, the source named after its slot, when the slice has one (#1343): its typed handle, bound once in the builder's payload (`recordSources(…).bind($)`, #1356)
     * @returns The kind, closed
     * @throws {Error} When the kind is given a source beside `window` or `backlogWindow`, or with no `entries`, or `entries` with neither
     */
    build(slot: string, part?: ScheduleKindPart): ExprType<ScheduleKindType>;
    /**
     * The kind on the wire as Plan's builder takes it, under its slot: the
     * Calendar's kind with how it draws, its roles, and its events as Plan
     * draws them.
     *
     * @param slot - The builder's slot name for it
     * @param part - Its source of the builder's `Slice.bindRecords`, when the slice has one
     * @returns The kind, closed
     * @throws {Error} As `build` does
     */
    buildPlan(slot: string, part?: ScheduleKindPart): ExprType<PlanEventKindType>;
    /**
     * The kind on the wire as the Roster takes it, under its slot (#1367): the
     * Calendar's kind, its form over the fields none of the Roster's roles
     * writes, with the stored rows of a period and a duty's roles read from its
     * row and written into it.
     *
     * @param slot - The builder's slot name for it
     * @param part - Its source of the builder's `Slice.bindRecords`, when the slice has one
     * @returns The kind, closed
     * @throws {Error} For an instant kind (`at`), times that are Options, a record keyed by anything but String, a kind
     *   with no `shift`, `group` or `resource`, and two of the Roster's roles naming one field; and as `build` does
     */
    buildRoster(slot: string, part?: ScheduleKindPart): ExprType<ScheduleRosterKindType>;
    /**
     * The kind on the wire as the Allocation takes it, under its slot (#1367):
     * the Calendar's kind, its form over the fields none of the Allocation's
     * roles writes, with the stored rows of a period, a bin's roles read from
     * its row and written into it, and a new bin from its roles and an
     * arrival's values.
     *
     * @param slot - The builder's slot name for it
     * @param part - Its source of the builder's `Slice.bindRecords`, when the slice has one
     * @returns The kind, closed
     * @throws {Error} For a span kind (`start` and `end`), a record keyed by anything but String, a kind with no
     *   `resource`, `arrival`, `quantity`, `parts` or `hold`, a lane that is not a String key of one kind, and two of the
     *   Allocation's roles naming one field; and as `build` does
     */
    buildAllocation(slot: string, part?: ScheduleKindPart): ExprType<ScheduleAllocationKindType>;
}

/** The config, erased — what the implementation reads. */
interface AnyConfig {
    name: string;
    icon: string;
    title?: string;
    start?: string;
    end?: string;
    at?: string;
    resource?: { field: string; of: string | Readonly<Record<string, string>> };
    status?: { field: string; cases: unknown };
    backlog?: { duration: (row: unknown, key: unknown) => unknown; due?: (row: unknown, key: unknown) => unknown };
    fields?: Readonly<Record<string, unknown>>;
    templates?: readonly { key: string; name: string; group?: string; at?: unknown; duration?: unknown; values: unknown }[] | ScheduleTemplates<StructType>;
    ready?: (row: unknown, key: unknown) => unknown;
    window?: unknown;
    backlogWindow?: unknown;
    entries?: unknown;
    draw?: string;
    state?: string;
    quantity?: { field: string; unit?: string; format?: unknown };
    lane?: string;
    overlaps?: string;
    inspector?: unknown;
    shift?: string;
    group?: string;
    position?: string;
    activity?: string;
    hours?: (row: ExprType<EastType>, key: ExprType<EastType>) => SubtypeExprOrValue<FloatType>;
    arrival?: string;
    parts?: { field: string; of: string };
    hold?: string;
    kind?: string;
}

/** The Roster's roles, as a kind's options name them. */
const ROSTER_ROLES = ["shift", "group", "position", "activity", "hours"] as const;

/** The Allocation's roles, as a kind's options name them. */
const ALLOCATION_ROLES = ["arrival", "parts", "hold", "kind"] as const;

// ============================================================================
// Reading East types
// ============================================================================

/** A variant's cases, when every one of them holds a String. */
function stringCases(type: EastType): string[] | undefined {
    if (type.type !== "Variant" || optionOf(type) !== undefined) return undefined;
    const cases = Object.entries(type.cases as Record<string, EastType>);
    return cases.length > 0 && cases.every(([, t]) => isTypeEqual(t, StringType)) ? cases.map(([c]) => c) : undefined;
}

/** A field of a struct as an East expression, by name. */
function fieldOf(row: unknown, name: string): ExprType<EastType> {
    return (row as Record<string, ExprType<EastType>>)[name]!;
}

/** The ways a kind draws. */
const DRAWS: readonly string[] = ["span", "buckets", "cards", "marks"];

// ============================================================================
// Schedule.events
// ============================================================================

/**
 * Declares an event kind (see the module docs).
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 * @typeParam S - The start field
 * @typeParam E - The end field
 * @typeParam F - The resource field, when the kind has one
 * @typeParam SF - The status field, when the kind has one
 * @param record - The record, `Record.bind(record, [e3.mutation.patch(record)])`; a `Dict` of row structs
 * @param config - The kind's options: its name and icon, the fields a gesture writes, its status, backlog, form, templates, check and windows, and Plan's
 * @returns The kind, for a builder's `events`
 * @throws {Error} Naming the option: a record that is not a `Dict` of structs or is not bound with its patch mutation; a
 *   `title` that is not a String field; a `start` or `end` that is not a DateTime field or an Option of one, or one of each;
 *   an `at` that is not a DateTime field, or given with `start` and `end`; a `resource` field that holds no resource key, an
 *   `of` that is not a slot name for a key field, or whose cases are not the variant's; a `status` that is not a variant;
 *   `backlog` without Option times; a template key repeated, a span kind's template without a duration, or values of
 *   another type; a templates record (`Schedule.templates`) whose templates give no duration on a span kind, or give one
 *   on an instant kind (#1344); `fields` naming a field the row does not have, or hinting one it cannot; a window over another index,
 *   a `backlogWindow` on plain times, a `window` over Option times without a `backlogWindow`, a `window` without
 *   `entries`, and `entries` that is not a paged read of the record's own entries naming its snapshot (#1199) — a window
 *   that reads no rows (`join` not true) is refused as it is read, naming `join: true`; a `slice` or a `filter`, which
 *   move to the builder's `Slice.bindRecords` (#1343);
 *   a `draw` that is not a way to draw, or draws two ends of an instant; a `state`, `quantity` or `lane` field of
 *   another type; a `review`, which is removed (#1260); an `overlaps` that is neither `"warn"` nor `"allow"`; an
 *   `inspector` that is not an East function `(row, update) => UIComponentType` over the row; and a Roster role (`shift`,
 *   `group`, `position`, `activity`) or an Allocation role (`arrival`, `parts.field`, `hold`, `kind`) naming a field of
 *   another type, a `parts.of` naming no slot, an `hours` accessor returning no Float, or roles of both builders on one
 *   kind (#1367)
 * @example
 * ```tsx
 * import { DateTimeType, DictType, East, NullType, OptionType, StringType, StructType, VariantType, variant } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Record, Schedule } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const ShiftType = StructType({
 *     title: StringType, start: DateTimeType, end: DateTimeType,
 *     person: OptionType(StringType),
 *     status: VariantType({ tentative: NullType, confirmed: NullType }),
 * });
 * const shifts = e3.record("shifts", DictType(StringType, ShiftType), new Map());
 * const shiftsPatch = e3.mutation.patch(shifts);
 *
 * // Inside a builder's Reactive body: shifts on people, their status shown.
 * const shift = Schedule.events(Record.bind(shifts, [shiftsPatch]), {
 *     name: "Shift", icon: "user-clock",
 *     title: "title", start: "start", end: "end",
 *     resource: { field: "person", of: "people" },
 *     status: { field: "status", cases: {
 *         tentative: { label: "Tentative", tone: variant("neutral", null), ring: true },
 *         confirmed: { label: "Confirmed", tone: variant("success", null), ring: false },
 *     } },
 * });
 * ```
 */
export function scheduleEvents<
    K extends EastType, R extends StructType, S extends ScheduleInstantField<R>, E extends ScheduleInstantField<R>,
    F extends ScheduleResourceField<R> = never, SF extends ScheduleStatusField<R> = never,
>(
    record: ScheduleRecordHandle<K, R>,
    config: ScheduleEventsConfig<K, R, S, E, F, SF>,
): ScheduleEventKind<K, R>;
/**
 * Declares an instant event kind, each event one time (`at`): a plate change,
 * a delivery (see the module docs).
 *
 * @typeParam K - The record's key type
 * @typeParam R - Its row type
 * @typeParam A - The instant's field
 * @typeParam F - The resource field, when the kind has one
 * @typeParam SF - The status field, when the kind has one
 * @param record - The record, `Record.bind(record, [e3.mutation.patch(record)])`; a `Dict` of row structs
 * @param config - The kind's options, with `at` in place of `start` and `end`
 * @returns The kind, for a builder's `events`
 * @throws {Error} Naming the option, as the span form does
 */
export function scheduleEvents<
    K extends EastType, R extends StructType, A extends ScheduleAtField<R>,
    F extends ScheduleResourceField<R> = never, SF extends ScheduleStatusField<R> = never,
>(
    record: ScheduleRecordHandle<K, R>,
    config: ScheduleInstantEventsConfig<K, R, A, F, SF>,
): ScheduleEventKind<K, R>;
export function scheduleEvents(record: unknown, input: unknown): ScheduleEventKind<EastType, EastType> {
    const config = input as AnyConfig;
    const where = `Schedule.events: "${config.name}"`;
    // The options #1343 moved to the builder, refused by name for an app that still passes them.
    if ("slice" in (config as object)) {
        throw new Error(`${where}: \`slice\` moves to the builder — name a source of its Slice.bindRecords after this kind's slot, ` +
            "slice={{ slice: Slice.bindRecords(key, { <slot>: { source, fields, range } }) }}, and the builder narrows the kind through it");
    }
    if ("filter" in (config as object)) {
        throw new Error(`${where}: \`filter\` is gone — narrow the kind through its builder's Slice.bindRecords, a source named after its slot, over the record's indexes`);
    }
    const handleType = Expr.type(record as Expr) as EastType;
    const read = handleType.type === "Struct" ? (handleType.fields as Record<string, EastType>)["read"] : undefined;
    if (handleType.type !== "Struct" || read === undefined || read.type !== "Function"
        || (handleType.fields as Record<string, EastType>)["binding"] === undefined) {
        throw new Error(`${where}: \`record\` is a record bound with its patch mutation — Record.bind(record, [e3.mutation.patch(record)])`);
    }
    const recordType = read.output as EastType;
    if (recordType.type !== "Dict" || (recordType.value as EastType).type !== "Struct") {
        throw new Error(`${where}: an event kind's record holds its events by key, each a struct — a Dict of row structs, and this one holds ${typeText(recordType)}`);
    }
    const keyType = recordType.key as EastType;
    const rowType = recordType.value as StructType;
    const fields = rowType.fields as Record<string, EastType>;
    const fieldType = (prop: string, name: string): EastType => {
        const type = fields[name];
        if (type === undefined) throw new Error(`${where}: \`${prop}\` names "${name}", a field the row does not have (${Object.keys(fields).join(", ")})`);
        return type;
    };

    // The title: optional, as the Roster and the Allocation draw none (#1367); the Calendar and Plan refuse a kind without one.
    const titleField = config.title;
    if (titleField !== undefined && !isTypeEqual(fieldType("title", titleField), StringType)) {
        throw new Error(`${where}: \`title\` names a String field — "${titleField}" holds ${typeText(fields[titleField]!)}`);
    }
    // The times: `start` and `end`, DateTime or Options of DateTime alike; or an instant kind's `at`, in their place.
    const instantKind = config.at !== undefined;
    if (instantKind && (config.start !== undefined || config.end !== undefined)) {
        throw new Error(`${where}: \`at\` is an instant kind's one time, in place of \`start\` and \`end\` — give one or the other`);
    }
    if (!instantKind && (config.start === undefined || config.end === undefined)) {
        throw new Error(`${where}: an event kind runs from \`start\` to \`end\` — DateTime fields, or Options of one — or is one instant, \`at\``);
    }
    let startField: string;
    let endField: string;
    if (instantKind) {
        const atType = fieldType("at", config.at!);
        if (!isTypeEqual(atType, DateTimeType)) {
            throw new Error(`${where}: \`at\` names a DateTime field, an instant kind's one time — "${config.at}" holds ${typeText(atType)}`);
        }
        startField = config.at!;
        endField = config.at!;
    } else {
        startField = config.start!;
        endField = config.end!;
        const startType = fieldType("start", startField);
        const endType = fieldType("end", endField);
        const isInstant = (t: EastType) => isTypeEqual(t, DateTimeType) || isTypeEqual(t, OptionType(DateTimeType));
        for (const [prop, name, type] of [["start", startField, startType], ["end", endField, endType]] as const) {
            if (!isInstant(type)) throw new Error(`${where}: \`${prop}\` names a DateTime field, or an Option of one — "${name}" holds ${typeText(type)}`);
        }
        if (!isTypeEqual(startType, endType)) {
            throw new Error(`${where}: \`start\` and \`end\` are both DateTime fields, or both Options of one — "${startField}" holds ${typeText(startType)} and "${endField}" ${typeText(endType)}`);
        }
    }
    const optional = optionOf(fields[startField]!) !== undefined;
    if (config.backlog !== undefined && !optional) {
        throw new Error(instantKind
            ? `${where}: \`backlog\` is a kind's rows with no time, and an instant kind's \`at\` is a plain DateTime field — it has none`
            : `${where}: \`backlog\` is a kind's rows with no time, and its times are plain DateTime fields — make \`start\` and \`end\` Options for a backlog`);
    }

    // The resource: a key of one kind, or a case per kind.
    type Resource = { field: string; shape: "key"; of: string; optional: boolean }
        | { field: string; shape: "cases"; of: Readonly<Record<string, string>>; cases: string[]; optional: boolean; variant: EastType };
    let resource: Resource | undefined;
    if (config.resource !== undefined) {
        const { field, of } = config.resource;
        const type = fieldType("resource.field", field);
        const inner = optionOf(type) ?? type;
        const isOptional = optionOf(type) !== undefined;
        const cases = stringCases(inner);
        if (isTypeEqual(inner, StringType)) {
            if (typeof of !== "string" || of === "") {
                throw new Error(`${where}: \`resource.of\` names the resource slot "${field}" holds keys of — a String field holds one kind's keys`);
            }
            resource = { field, shape: "key", of, optional: isOptional };
        } else if (cases !== undefined) {
            if (typeof of !== "object" || of === null) {
                throw new Error(`${where}: "${field}" is a variant — \`resource.of\` names a resource slot per case: { ${cases.map((c) => `${c}: "…"`).join(", ")} }`);
            }
            const named = Object.keys(of);
            if (named.length !== cases.length || !named.every((c) => cases.includes(c))) {
                throw new Error(`${where}: \`resource.of\` names a resource slot for each of "${field}"'s cases (${cases.join(", ")}) — and it names ${named.join(", ") || "none"}`);
            }
            const kinds = Object.values(of);
            if (new Set(kinds).size !== kinds.length) {
                throw new Error(`${where}: \`resource.of\` names each resource slot once — a case per kind of resource — and it names ${kinds.join(", ")}`);
            }
            resource = { field, shape: "cases", of, cases, optional: isOptional, variant: inner };
        } else {
            throw new Error(`${where}: \`resource.field\` names a field holding a resource's key — a String, a variant of String cases, or an Option of either — and "${field}" holds ${typeText(type)}`);
        }
    }
    const takes = resource === undefined ? [] : resource.shape === "key" ? [resource.of] : Object.values(resource.of);

    // The status: a variant, a Status per case.
    let statusCases: string[] | undefined;
    let statusTable: ExprType<EastType> | undefined;
    if (config.status !== undefined) {
        const type = fieldType("status.field", config.status.field);
        if (type.type !== "Variant" || optionOf(type) !== undefined) {
            throw new Error(`${where}: \`status.field\` names a variant field every event holds, a Status per case — "${config.status.field}" holds ${typeText(type)}`);
        }
        statusCases = Object.keys(type.cases as Record<string, EastType>);
        statusTable = East.value(config.status.cases as SubtypeExprOrValue<EastType>, ScheduleStatusCasesFor(type as VariantType)) as ExprType<EastType>;
    }

    // Plan's: how the kind draws, its roles' fields, and whether its overlaps are a conflict.
    const draw = config.draw ?? (instantKind ? "marks" : "span");
    if (!DRAWS.includes(draw)) {
        throw new Error(`${where}: \`draw\` is "span", "buckets", "cards" or "marks" — and it is "${draw}"`);
    }
    if (instantKind && (draw === "span" || draw === "cards")) {
        throw new Error(`${where}: \`draw: "${draw}"\` draws an event from its start to its end, and an instant kind (\`at\`) has one time — draw it as "buckets" or "marks"`);
    }
    const overlaps = config.overlaps ?? "warn";
    if (overlaps !== "warn" && overlaps !== "allow") {
        throw new Error(`${where}: \`overlaps\` is "warn" or "allow" — and it is "${overlaps}"`);
    }
    const role = (prop: string, name: string | undefined, type: EastType, what: string): string | undefined => {
        if (name === undefined) return undefined;
        const held = fieldType(prop, name);
        if (!isTypeEqual(held, type)) throw new Error(`${where}: \`${prop}\` names ${what} — "${name}" holds ${typeText(held)}`);
        return name;
    };
    const stateField = role("state", config.state, EventStateType, "an EventStateType field, the lifecycle an event wears");
    const quantityField = role("quantity.field", config.quantity === undefined ? undefined : config.quantity.field, FloatType, "a Float field, the quantity a bar prints");
    const laneField = role("lane", config.lane, StringType, "a String field, the lane a tile sits in");
    // The builders' roles (#1367, `Builder Interfaces Spec.md` §4.1), each a field of the row, checked as Plan's are. A
    // kind is the Roster's duties or the Allocation's bins, never both.
    const given = (roles: readonly string[]) => roles.filter((r) => (config as unknown as Readonly<Record<string, unknown>>)[r] !== undefined);
    const rosterGiven = given(ROSTER_ROLES);
    const allocationGiven = given(ALLOCATION_ROLES);
    if (rosterGiven.length > 0 && allocationGiven.length > 0) {
        throw new Error(`${where}: holds roles of both the Roster (${rosterGiven.join(", ")}) and the Allocation (${allocationGiven.join(", ")}) — ` +
            "a kind is the Roster's duties or the Allocation's bins: give it one builder's roles");
    }
    const shiftField = role("shift", config.shift, StringType, "a String field");
    const groupField = role("group", config.group, StringType, "a String field");
    const positionField = role("position", config.position, StringType, "a String field");
    const activityField = role("activity", config.activity, OptionType(StringType), "an Option of a String field");
    const arrivalField = role("arrival", config.arrival, OptionType(StringType), "an Option of a String field");
    const partsField = role("parts.field", config.parts === undefined ? undefined : config.parts.field, DictType(StringType, FloatType),
        "a Dict of String to Float field");
    if (config.parts !== undefined && (typeof config.parts.of !== "string" || config.parts.of === "")) {
        throw new Error(`${where}: \`parts.of\` names the resource slot its keys are of — the builder's resources a bin is allocated to (of: "kilns")`);
    }
    const holdField = role("hold", config.hold, TimeStepType, "a TimeStep field");
    const kindField = role("kind", config.kind, OptionType(StringType), "an Option of a String field");
    // The fields none of the Allocation's roles maps (#1371): what an arrival's values give a booked bin (B13) — every
    // field but its time, its lane and its roles' fields — which the Allocation reads at build, and `buildAllocation` writes.
    const allocationMapped = new Set([startField, endField, ...[resource?.field, arrivalField, quantityField, partsField, holdField, kindField]
        .filter((name): name is string => name !== undefined)]);
    const allocationValues = StructType(Object.fromEntries(Object.entries(fields).filter(([name]) => !allocationMapped.has(name))));
    // The hours a duty counts, reified once and called per row.
    const hoursOf = config.hours === undefined ? undefined : scheduleAccessor(rowType, keyType, FloatType, config.hours,
        (returns) => `${where}: \`hours\` returns a Float, the hours a duty counts — and this one returns ${returns}`);
    // The removed verdict, named (#1260) — a plain JS caller would otherwise lose it silently.
    if ("review" in (config as object)) {
        throw new Error(`${where}: \`review\` is removed (#1260) — a Plan approves and rejects nothing: its changes are drafts of its session, saved together`);
    }
    // The kind's own inspector, checked against the row now and carried over bytes.
    const inspector = config.inspector === undefined ? undefined : rowInspector(config.inspector, rowType,
        `${where}: \`inspector\` is the kind's own inspector for one event — an East.function over the event's row and its writer: ` +
        "East.function([RowType, FunctionType([RowType], NullType)], UIComponentType, ($, row, update) => …), RowType the record's row");

    // The templates: unique keys, a span kind's duration, and values of the row less what a drop places.
    const placed = new Set([startField, endField, ...(resource === undefined ? [] : [resource.field])]);
    const valuesType = StructType(Object.fromEntries(Object.entries(fields).filter(([name]) => !placed.has(name))));
    const boundTemplates = config.templates !== undefined && SCHEDULE_TEMPLATES in config.templates
        ? checkedTemplates(config.templates, valuesType, where) : undefined;
    // A templates record's events run as long as each says, or — an instant kind's — are one time (#1344).
    if (config.templates !== undefined && SCHEDULE_TEMPLATES in config.templates) {
        if (!instantKind && !config.templates.timed) {
            throw new Error(`${where}: its templates give each event's \`duration\` — Schedule.templates(rows, { …, duration: (row) => variant("hours", …) }), how long the event a template creates runs`);
        }
        if (instantKind && config.templates.timed) {
            throw new Error(`${where}: an instant kind's events are one time, and its templates give a \`duration\` — leave it out of Schedule.templates`);
        }
    }
    // The builder's source whose shown keys filter the templates: the one a templates list names (#1343).
    const templatesSource = config.templates !== undefined && SCHEDULE_TEMPLATES in config.templates ? config.templates.source : undefined;
    const templates = config.templates !== undefined && !(SCHEDULE_TEMPLATES in config.templates) ? config.templates : [];
    const seen = new Set<string>();
    for (const t of templates) {
        if (seen.has(t.key)) throw new Error(`${where}: template "${t.key}" is declared twice — a template's key is unique within its kind`);
        seen.add(t.key);
        if (!instantKind && t.duration === undefined) {
            throw new Error(`${where}: template "${t.key}" gives its \`duration\` — how long the event it creates runs`);
        }
        if (instantKind && t.duration !== undefined) {
            throw new Error(`${where}: template "${t.key}" gives a \`duration\`, and an instant kind's events are one time — leave it out`);
        }
    }

    // The windows (#1199): the days in view through a day index, the backlog through a backlog index.
    const dayWindow = config.window === undefined ? undefined
        : checkIndexWindow(config.window, "window", keyType, rowType, DateTimeType, where);
    let backlogWindow: ExprType<EastType> | undefined;
    if (config.backlogWindow !== undefined) {
        if (!optional) throw new Error(`${where}: \`backlogWindow\` reads the backlog, and a kind whose times are plain DateTime fields has none`);
        backlogWindow = checkIndexWindow(config.backlogWindow, "backlogWindow", keyType, rowType, OptionType(DateTimeType), where);
    }
    // A kind read through its day index never reads its record whole, its backlog included.
    if (dayWindow !== undefined && optional && backlogWindow === undefined) {
        throw new Error(`${where}: \`window\` reads the days in view through a day index, so the record is never read whole — ` +
            "and this kind's times are Options, so it has a backlog: read it through `backlogWindow` beside it, " +
            "Data.bindPaged(record, { index, join: true }) over an index keyed by Schedule.unscheduled");
    }
    // Nor one event: it is read by its key through the record's own entries.
    let entries: ExprType<EastType> | undefined;
    if (config.entries !== undefined) {
        entries = checkEntries(config.entries, keyType, rowType, `${where}: \`entries\``);
    } else if (dayWindow !== undefined) {
        throw new Error(`${where}: an indexed kind reads only the window — and one event, the inspector's ` +
            "or its editing's, is read by its key: give `entries` beside it, Data.bindPaged(record), the record's own entries");
    }

    // The record's session (`session.ts`): its reads, whole and by key, and its Save, one patch commit through the
    // record's patch door, its entries checked against what the drafts began from — declared now, so a record bound
    // without its patch door is refused where its kind is.
    const session = scheduleRecordSession(record, keyType, rowType, entries);
    const { readAll, byKey, idOf, keyOf } = session;

    // The inspector's form: the fields a gesture does not write, in the hints' order. A builder over the app's own
    // records draws its roles in its own sections, so its form leaves out the fields they name too.
    const formOver = (omitted: readonly (string | undefined)[]) => Fields.specs(rowType, (config.fields ?? {}) as never,
        [...new Set(omitted.filter((name): name is string => name !== undefined))] as never);
    const formSpecs = formOver([titleField, ...placed, config.status?.field]);

    // ── The East the seams share ─────────────────────────────────────────
    const draftType = EditingDraftFieldType(rowType);
    const EntryRowType = StructType({ id: StringType, key: keyType, row: rowType });
    // The entry a draft leaves: the drafted entry, none for one deleted, the held one for a draft it cannot read.
    const drafted = East.function([BlobType, OptionType(rowType)], OptionType(rowType), (_$, bytes, held) =>
        bytes.decodeBeast(draftType, "v2").match({
            value: (_$2, row) => East.value(some(row), OptionType(rowType)),
            missing: (_$2) => East.value(none, OptionType(rowType)),
            invalid: (_$2) => held,
        }));
    // Every entry held — the record's, or a window's of it — with the drafts in place, then the drafted
    // entries it does not hold: a draft moved into a window shows, and one moved out of it leaves by its times.
    // Erased as the record's own read is, so the record whole and a window of it are one type.
    const HeldType: DictType<EastType, EastType> = DictType(keyType, rowType as EastType);
    const withDraftsFor = (narrowed: boolean) => East.function([HeldType, ScheduleDraftsType], ArrayType(EntryRowType), ($, held, drafts) => {
        const idText = $.const(idOf);
        const parse = $.const(keyOf);
        const draft = $.const(drafted);
        const out = $.let([], ArrayType(EntryRowType));
        $.for(held, ($2, row, key) => {
            const id = $2.const(idText(key));
            $2.if(drafts.has(id), ($3) => {
                $3.match(draft(drafts.get(id), East.value(some(row), OptionType(rowType))), {
                    some: ($4, next) => { $4(out.pushLast({ id, key, row: next })); },
                });
            }).else(($3) => { $3(out.pushLast({ id, key, row })); });
        });
        $.for(drafts, ($2, bytes, id, label) => {
            const key = $2.const(parse(id));
            $2.if(held.has(key).not(), ($3) => {
                // Existing drafts outside an indexed result stay in the session,
                // but do not leak back into a different narrowing. New entries
                // remain an explicit unsaved layer until their first Save.
                if (narrowed && byKey !== undefined) {
                    const find = $3.const(byKey);
                    $3.if(find(id).hasTag("absent").not(), $4 => { $4.continue(label); });
                }
                $3.match(draft(bytes, East.value(none, OptionType(rowType))), {
                    some: ($4, next) => { $4(out.pushLast({ id, key, row: next })); },
                });
            });
        });
        return out;
    });
    // An instant field as an Option: a plain DateTime always has one.
    const instant = (row: unknown, name: string): ExprType<OptionType<DateTimeType>> => optional
        ? fieldOf(row, name) as unknown as ExprType<OptionType<DateTimeType>>
        : East.value(some(fieldOf(row, name) as unknown as ExprType<DateTimeType>), OptionType(DateTimeType));
    // A time as its field holds it: an Option field holds `some`.
    const placedAt = (t: ExprType<DateTimeType>): ExprType<EastType> => (optional ? East.value(some(t), OptionType(DateTimeType)) : t) as ExprType<EastType>;
    // A duration in minutes — a month counts 30 days.
    const minutesOf = East.function([ScheduleDurationType], IntegerType, (_$, step) => East.Float.roundHalf(step.match({
        minutes: (_$2, n) => n,
        hours: (_$2, n) => n.multiply(60),
        days: (_$2, n) => n.multiply(1_440),
        weeks: (_$2, n) => n.multiply(10_080),
        months: (_$2, n) => n.multiply(43_200),
    }) as ExprType<FloatType>));
    const duration = config.backlog === undefined ? undefined
        : East.function([rowType, keyType], ScheduleDurationType, (_$, row, key) => config.backlog!.duration(row, key) as SubtypeExprOrValue<ScheduleDurationType>);
    const dueOf = config.backlog?.due === undefined ? undefined
        : East.function([rowType, keyType], OptionType(DateTimeType), (_$, row, key) => config.backlog!.due!(row, key) as SubtypeExprOrValue<OptionType<DateTimeType>>);
    // The resource a row is on.
    const RefOption = OptionType(ScheduleResourceRefType);
    const refOf = East.function([rowType], RefOption, (_$, row) => {
        if (resource === undefined) return East.value(none, RefOption);
        const value = fieldOf(row, resource.field);
        if (resource.shape === "key") {
            const kind = resource.of;
            const ref = (key: ExprType<StringType>) => East.value(some(East.value({ kind, key }, ScheduleResourceRefType)), RefOption);
            return resource.optional
                ? (value as unknown as ExprType<OptionType<StringType>>).match({ none: (_$2) => East.value(none, RefOption), some: (_$2, key) => ref(key) })
                : ref(value as unknown as ExprType<StringType>);
        }
        const of = resource.of;
        const byCase = (v: ExprType<EastType>) => (v as unknown as { match: (arms: object) => ExprType<EastType> }).match(Object.fromEntries(resource.cases.map((c) =>
            [c, (_$2: unknown, key: ExprType<StringType>) => East.value(some(East.value({ kind: of[c]!, key }, ScheduleResourceRefType)), RefOption)])));
        return resource.optional
            ? (value as unknown as ExprType<OptionType<EastType>>).match({ none: (_$2) => East.value(none, RefOption), some: (_$2, v) => byCase(v) })
            : byCase(value);
    });
    // The value a resource field takes for a placement's resource; `none` where the kind refuses it: a resource of a
    // kind it does not take, or none for a field that must hold one.
    const resourceValue = resource === undefined ? undefined : (() => {
        const valueType = fields[resource.field]!;
        return East.function([RefOption], OptionType(valueType), ($, ref) => {
            const result = $.let(East.value(none as never, OptionType(valueType)), OptionType(valueType));
            $.match(ref, {
                none: ($2) => {
                    if (resource.optional) $2.assign(result, East.value(some(East.value(none as never, valueType)) as never, OptionType(valueType)));
                },
                some: ($2, r) => {
                    if (resource.shape === "key") {
                        const key = resource.optional ? East.value(some(r.key) as never, valueType) : r.key;
                        $2.if(East.equal(r.kind, resource.of), ($3) => { $3.assign(result, East.value(some(key) as never, OptionType(valueType))); });
                    } else {
                        for (const c of resource.cases) {
                            const caseValue = East.value(variant(c, r.key) as never, resource.variant);
                            const held = resource.optional ? East.value(some(caseValue) as never, valueType) : caseValue;
                            $2.if(East.equal(r.kind, resource.of[c]!), ($3) => { $3.assign(result, East.value(some(held) as never, OptionType(valueType))); });
                        }
                    }
                },
            });
            return result;
        });
    })();
    // A row of the record's type, field by field: its times and resource from a placement, the rest from `source`.
    // An instant kind's `at` is its start.
    const rowWith = (source: unknown, start: ExprType<DateTimeType>, end: ExprType<DateTimeType>, resourceField: ExprType<EastType> | undefined): ExprType<EastType> =>
        East.value(Object.fromEntries(Object.keys(fields).map((f) => [f,
            f === startField ? placedAt(start)
                : f === endField ? placedAt(end)
                    : resource !== undefined && f === resource.field && resourceField !== undefined ? resourceField
                        : fieldOf(source, f)])) as never, rowType) as ExprType<EastType>;
    // The entry with its times and resource placed; `none` where the kind refuses the resource.
    const placeIn = East.function([rowType, DateTimeType, DateTimeType, RefOption], OptionType(rowType), ($, row, start, end, ref) => {
        const result = $.let(East.value(none, OptionType(rowType)), OptionType(rowType));
        if (resourceValue === undefined) {
            // A kind on no resource takes a placement on none.
            $.if(ref.hasTag("none"), ($2) => { $2.assign(result, East.value(some(rowWith(row, start, end, undefined)), OptionType(rowType))); });
        } else {
            const resolve = $.const(resourceValue);
            $.match(resolve(ref), {
                some: ($2, value) => { $2.assign(result, East.value(some(rowWith(row, start, end, value as ExprType<EastType>)), OptionType(rowType))); },
            });
        }
        return result;
    });
    // A setter for every field, at any depth: an inspector edit writes one (`field`), its value as bytes at the field's type.
    const setters: { path: readonly string[]; set: ExprType<FunctionType<[EastType, BlobType], EastType>> }[] = [];
    const setterOf = (prefix: readonly string[], name: string, type: EastType): ExprType<FunctionType<[EastType, BlobType], EastType>> =>
        East.function([rowType, BlobType], rowType, (_$, row, bytes) => {
            const value = bytes.decodeBeast(type, "v2") as ExprType<EastType>;
            // The structs down the path, each with the field below it replaced, rebuilt from the leaf up.
            const chain: { struct: StructType; field: string; at: ExprType<EastType> }[] = [];
            let at = row as ExprType<EastType>;
            let struct: StructType = rowType;
            for (const step of prefix) {
                chain.push({ struct, field: step, at });
                at = fieldOf(at, step);
                struct = (struct.fields as Record<string, EastType>)[step] as StructType;
            }
            const leaf = struct;
            const leafAt = at;
            let next = East.value(Object.fromEntries(Object.keys(leaf.fields).map((f) => [f, f === name ? value : fieldOf(leafAt, f)])) as never, leaf) as ExprType<EastType>;
            for (let i = chain.length - 1; i >= 0; i--) {
                const link = chain[i]!;
                const inner = next;
                next = East.value(Object.fromEntries(Object.keys(link.struct.fields).map((f) => [f, f === link.field ? inner : fieldOf(link.at, f)])) as never, link.struct) as ExprType<EastType>;
            }
            return next as never;
        }) as unknown as ExprType<FunctionType<[EastType, BlobType], EastType>>;
    const collect = (struct: StructType, prefix: readonly string[]): void => {
        for (const [name, type] of Object.entries(struct.fields as Record<string, EastType>)) {
            setters.push({ path: [...prefix, name], set: setterOf(prefix, name, type) });
            if (type.type === "Struct") collect(type, [...prefix, name]);
        }
    };
    collect(rowType, []);

    /**
     * The reads a build's events come by (#1199, #1343): through the kind's source of its builder's slice, its
     * interval index over the window and its Unset starts for the backlog; else through its day index and its
     * backlog index; else the record whole — each `none` while its search or a page is in flight.
     */
    interface Reads {
        /** The rows overlapping a window; `undefined`, the record whole. */
        readonly days: ExprType<FunctionType<[DateTimeType, DateTimeType], OptionType<DictType<EastType, EastType>>>> | undefined;
        /** The backlog's rows, the window `[from, to)` the canvas reads given; `undefined`, the record whole. */
        readonly backlog: ExprType<FunctionType<[DateTimeType, DateTimeType], OptionType<DictType<EastType, EastType>>>> | undefined;
        /** The rows with the drafts in place: a narrowed kind's leave out drafts its narrowing does not hold. */
        readonly withDrafts: ExprType<FunctionType<[EastType, EastType], EastType>>;
    }
    const readsOf = (slot: string, part: ScheduleKindPart | undefined): Reads => {
        if (part === undefined) {
            if (entries !== undefined && dayWindow === undefined) {
                throw new Error(`${where}: \`entries\` reads one event by its key beside \`window\`, or beside the kind's source of its builder's ` +
                    `Slice.bindRecords (one named "${slot}") — give one of those with it`);
            }
            const unscheduled = backlogWindow === undefined ? undefined : scheduleBacklogWindow(backlogWindow, keyType, rowType, where) as unknown as ExprType<FunctionType<[], OptionType<DictType<EastType, EastType>>>>;
            return {
                days: dayWindow === undefined ? undefined : scheduleDayWindow(dayWindow, keyType, rowType, where),
                // A backlog index's read takes no window: the window is given, and read past.
                backlog: unscheduled === undefined ? undefined : East.function([DateTimeType, DateTimeType], OptionType(HeldType), ($, _from, _to) => {
                    const read = $.const(unscheduled);
                    return read();
                }),
                withDrafts: withDraftsFor(false) as never,
            };
        }
        if (dayWindow !== undefined || backlogWindow !== undefined) {
            throw new Error(`${where}: the builder's source "${slot}" narrows this kind through its record's indexes — leave \`window\` and \`backlogWindow\` out`);
        }
        if (entries === undefined) {
            throw new Error(`${where}: the builder's source "${slot}" reads only its narrowing — and one event, the inspector's ` +
                "or its editing's, is read by its key: give `entries` beside it, Data.bindPaged(record), the record's own entries");
        }
        const scheduled = scheduleRecordWindow(part, slot, keyType, rowType, startField, endField, optional, false, where);
        if (!optional) return { days: scheduled, backlog: undefined, withDrafts: withDraftsFor(true) as never };
        // A kind with a backlog reads both through its source as one: what its narrowing holds over the window and in
        // its backlog. A draft then moves an event between the two by its times alone, and a draft the narrowing does
        // not hold never shows in either (#1343).
        const backlogged = scheduleRecordWindow(part, slot, keyType, rowType, startField, endField, optional, true, where);
        const both = East.function([DateTimeType, DateTimeType], OptionType(HeldType), ($, from, to) => {
            const inWindow = $.const(scheduled);
            const inBacklog = $.const(backlogged);
            const result = $.let(East.value(none, OptionType(HeldType)), OptionType(HeldType));
            $.match(inWindow(from, to), {
                some: ($2, rows) => {
                    $2.match(inBacklog(from, to), {
                        some: ($3, more) => {
                            const all = $3.let(rows.copy());
                            $3(all.unionInPlace(more, (_$4, held) => held));
                            $3.assign(result, East.value(some(all), OptionType(HeldType)));
                        },
                    });
                },
            });
            return result;
        });
        return { days: both, backlog: both, withDrafts: withDraftsFor(true) as never };
    };

    /** An item seam over a window: the events whose items `itemFn` makes that overlap `[from, to)`. */
    const windowOf = (itemType: EastType, itemFn: ExprType<FunctionType<[EastType], EastType>>, reads: Reads) =>
        East.function([DateTimeType, DateTimeType, ScheduleDraftsType], OptionType(ArrayType(itemType)), ($, from, to, drafts) => {
            const inPlace = $.const(reads.withDrafts as unknown as ExprType<FunctionType<[DictType<EastType, EastType>, typeof ScheduleDraftsType], ArrayType<typeof EntryRowType>>>);
            const item = $.const(itemFn);
            const result = $.let(East.value(none, OptionType(ArrayType(itemType))), OptionType(ArrayType(itemType)));
            let read: ExprType<OptionType<DictType<EastType, EastType>>>;
            if (reads.days === undefined) {
                read = $.let(East.value(some(readAll()), OptionType(HeldType)));
            } else {
                const days = $.const(reads.days);
                read = $.let(days(from, to));
            }
            $.match(read, {
                some: ($2, rows) => {
                    const out = $2.let([], ArrayType(itemType));
                    $2.for(inPlace(rows, drafts), ($3, entry) => {
                        // Every item type holds what every view draws, its start and end among them.
                        const one = $3.const(item(entry)) as unknown as ExprType<ScheduleItemType>;
                        $3.match(one.start, {
                            some: ($4, s) => {
                                $4.match(one.end, {
                                    some: ($5, e) => {
                                        // Overlapping [from, to): it starts before the window ends, and ends
                                        // after it starts — or, of no length, sits inside it.
                                        $5.if(East.less(s, to).and(() => East.greater(e, from).or(() => East.greaterEqual(s, from))), ($6) => {
                                            $6(out.pushLast(one as unknown as ExprType<EastType>));
                                        });
                                    },
                                });
                            },
                        });
                    });
                    $2.assign(result, East.value(some(out), OptionType(ArrayType(itemType))));
                },
            });
            return result;
        });
    /** An item seam over the backlog: the rows with no time, as `itemFn` makes them, the window the canvas reads given. */
    const backlogOf = (itemType: EastType, itemFn: ExprType<FunctionType<[EastType], EastType>>, reads: Reads) =>
        East.function([DateTimeType, DateTimeType, ScheduleDraftsType], OptionType(ArrayType(itemType)), ($, from, to, drafts) => {
            const result = $.let(East.value(some([]), OptionType(ArrayType(itemType))), OptionType(ArrayType(itemType)));
            if (optional) {
                const inPlace = $.const(reads.withDrafts as unknown as ExprType<FunctionType<[DictType<EastType, EastType>, typeof ScheduleDraftsType], ArrayType<typeof EntryRowType>>>);
                const item = $.const(itemFn);
                let read: ExprType<OptionType<DictType<EastType, EastType>>>;
                if (reads.backlog === undefined) {
                    read = $.let(East.value(some(readAll()), OptionType(HeldType)));
                } else {
                    const backlog = $.const(reads.backlog);
                    read = $.let(backlog(from, to));
                }
                $.assign(result, East.value(none, OptionType(ArrayType(itemType))));
                $.match(read, {
                    some: ($2, rows) => {
                        const out = $2.let([], ArrayType(itemType));
                        $2.for(inPlace(rows, drafts), ($3, entry) => {
                            const one = $3.const(item(entry)) as unknown as ExprType<ScheduleItemType>;
                            $3.if(one.start.hasTag("none"), ($4) => { $4(out.pushLast(one as unknown as ExprType<EastType>)); });
                        });
                        $2.assign(result, East.value(some(out), OptionType(ArrayType(itemType))));
                    },
                });
            }
            return result;
        });

    const readEvent = (makeItem: ExprType<FunctionType<[EastType], EastType>>, readType: StructType, reads: Reads) => East.function([StringType, ScheduleDraftsType, DateTimeType, DateTimeType], OptionType(readType), ($, id, drafts, from, to) => {
        const parse = $.const(keyOf);
        const make = $.const(makeItem);
        const key = $.const(parse(id));
        const row = $.let(East.value(none, OptionType(rowType)), OptionType(rowType));
        const unread = $.let(true, BooleanType);
        $.if(drafts.has(id), ($2) => {
            $2.match(drafts.get(id).decodeBeast(draftType, "v2"), {
                value: ($3, entry) => {
                    $3.assign(row, East.value(some(entry), OptionType(rowType)));
                    $3.assign(unread, false);
                },
                missing: ($3) => { $3.assign(unread, false); },
            });
        });
        $.if(unread, ($2) => {
            if (byKey === undefined || reads.days === undefined) {
                const held = $2.const(readAll());
                $2.assign(row, held.tryGet(key) as never);
                return;
            }
            const days = $2.const(reads.days);
            $2.match(days(from, to), { some: ($3, held) => { $3.assign(row, held.tryGet(key) as never); } });
            if (reads.backlog !== undefined) {
                const backlog = $2.const(reads.backlog);
                $2.if(row.hasTag("none"), ($3) => {
                    $3.match(backlog(from, to), { some: ($4, held) => { $4.assign(row, held.tryGet(key) as never); } });
                });
            }
            const find = $2.const(byKey);
            $2.if(row.hasTag("none"), ($3) => {
                $3.match(find(id), { held: ($4, held) => { $4.assign(row, East.value(some(held as ExprType<EastType>), OptionType(rowType)) as never); } });
            });
        });
        return row.match({
            some: (_$2, r) => East.value(some({ item: make({ id, key, row: r }), row: East.Blob.encodeBeast(r, "v2") }) as never, OptionType(readType)),
            none: (_$2) => East.value(none, OptionType(readType)),
        });
    });

    /**
     * The Calendar's kind, part by part, under its slot and through its source's part, its form `form` — and the
     * function that makes one of its events.
     */
    const kindParts = (slot: string, part: ScheduleKindPart | undefined, form: typeof formSpecs) => {
        const reads = readsOf(slot, part);
        // One event, as every view draws it.
        const itemOf = East.function([EntryRowType], ScheduleItemType, ($, entry) => {
            const row = entry.row;
            const ref = $.const(refOf);
            const start = $.const(instant(row, startField));
            // An optional missing end is an instant at its scheduled start,
            // matching interval-index membership without rewriting the row.
            const end = $.const(instant(row, endField).match({
                none: () => start,
                some: (_$2, end) => East.value(some(end), OptionType(DateTimeType)),
            }));
            const minutes = $.let(0n, IntegerType);
            $.match(start, {
                some: ($2, s) => {
                    $2.match(end, { some: ($3, e) => { $3.assign(minutes, East.Float.roundHalf(s.durationMinutes(e))); } });
                },
                none: ($2) => {
                    if (duration !== undefined) {
                        const length = $2.const(duration);
                        const toMinutes = $2.const(minutesOf);
                        $2.assign(minutes, toMinutes(length(row, entry.key)));
                    }
                },
            });
            const status = statusTable === undefined || statusCases === undefined
                ? East.value(none, OptionType(ScheduleStatusType))
                : (fieldOf(row, config.status!.field) as unknown as { match: (arms: object) => ExprType<EastType> }).match(Object.fromEntries(statusCases.map((c) =>
                    [c, (_$2: unknown) => East.value(some(fieldOf(statusTable, c)) as never, OptionType(ScheduleStatusType))])));
            const due = dueOf === undefined ? East.value(none, OptionType(DateTimeType)) : (() => {
                const dueFn = $.const(dueOf);
                return dueFn(row, entry.key);
            })();
            return East.value({
                kind: slot,
                key: entry.id,
                // A kind with no title titles its events with nothing (#1367): the Calendar and Plan refuse one.
                title: titleField === undefined ? "" : fieldOf(row, titleField) as ExprType<StringType>,
                start,
                end,
                resource: ref(row),
                status,
                minutes,
                due,
            } as never, ScheduleItemType);
        });
        const items = windowOf(ScheduleItemType, itemOf as unknown as ExprType<FunctionType<[EastType], EastType>>, reads);
        const unscheduled = backlogOf(ScheduleItemType, itemOf as unknown as ExprType<FunctionType<[EastType], EastType>>, reads);
        // Each template's values, by key, as the templates on the wire carry them.
        const templateRows = boundTemplates ?? East.value(templates.map((t) => ({
            key: t.key, name: t.name, group: t.group === undefined ? none : some(t.group),
            at: t.at === undefined ? none : some(East.value(t.at as SubtypeExprOrValue<ScheduleClockType>, ScheduleClockType)),
            duration: t.duration === undefined ? variant("minutes", 0) : East.value(t.duration as SubtypeExprOrValue<ScheduleDurationType>, ScheduleDurationType),
            values: East.Blob.encodeBeast(East.value(t.values as SubtypeExprOrValue<EastType>, valuesType), "v2"),
        })), ArrayType(ScheduleTemplateType));
        const write = East.function([ArrayType(ScheduleWriteType)], ArrayType(OptionType(BlobType)), ($, requests) => {
            const place = $.const(placeIn);
            const resolve = resourceValue === undefined ? undefined : $.const(resourceValue);
            const byTemplate = $.let(new Map(), DictType(StringType, BlobType));
            const presets = $.const(templateRows);
            $.for(presets, ($2, t) => { $2(byTemplate.insert(t.key, t.values)); });
            // Each setter's path as East holds it: a field is named by its steps, never by text a dotted name could mimic.
            const setterFns = setters.map((setter) => ({ path: $.const([...setter.path], ArrayType(StringType)), set: $.const(setter.set) }));
            return requests.map(($2, request) => {
                const result = $2.let(East.value(none, OptionType(BlobType)), OptionType(BlobType));
                const encoded = (row: ExprType<EastType>) => East.value(some(East.Blob.encodeBeast(row, "v2")), OptionType(BlobType));
                $2.match(request.gesture, {
                    place: ($3, p) => {
                        const row = $3.const(request.entry.decodeBeast(rowType, "v2"));
                        $3.match(place(row, p.start, p.end, p.resource), {
                            some: ($4, next) => { $4.assign(result, encoded(next as ExprType<EastType>)); },
                        });
                    },
                    unplace: ($3) => {
                        // Back to the backlog: Option times only.
                        if (optional) {
                            const row = $3.const(request.entry.decodeBeast(rowType, "v2"));
                            $3.assign(result, encoded(East.value(Object.fromEntries(Object.keys(fields).map((f) =>
                                [f, f === startField || f === endField ? East.value(none, OptionType(DateTimeType)) : fieldOf(row, f)])) as never, rowType) as ExprType<EastType>));
                        }
                    },
                    field: ($3, edit) => {
                        const row = $3.const(request.entry.decodeBeast(rowType, "v2"));
                        for (const setter of setterFns) {
                            $3.if(East.equal(edit.path, setter.path), ($4) => {
                                $4.assign(result, encoded(setter.set(row, edit.value) as ExprType<EastType>));
                            });
                        }
                    },
                    create: ($3, c) => {
                        $3.match(byTemplate.tryGet(c.template), {
                            some: ($4, bytes) => {
                                // The new entry: the template's values, its times and its resource placed.
                                const values = $4.const(bytes.decodeBeast(valuesType, "v2"));
                                if (resolve === undefined) {
                                    $4.if(c.resource.hasTag("none"), ($5) => { $5.assign(result, encoded(rowWith(values, c.start, c.end, undefined))); });
                                } else {
                                    $4.match(resolve(c.resource), {
                                        some: ($5, value) => { $5.assign(result, encoded(rowWith(values, c.start, c.end, value as ExprType<EastType>))); },
                                    });
                                }
                            },
                        });
                    },
                });
                return result;
            });
        });
        // The author's check, one result per drafted entry, in order; a check that throws refuses its own entry alone.
        const ready = config.ready === undefined ? undefined : (() => {
            const author = East.function([rowType, keyType], EditingReadinessType, ($, row, key) =>
                $.const(config.ready!(row, key) as SubtypeExprOrValue<typeof EditingReadinessType>, EditingReadinessType));
            return East.function([ArrayType(ScheduleReadyEntryType)], ArrayType(EditingReadinessType), ($, batch) => {
                const check = $.const(author);
                const parse = $.const(keyOf);
                return batch.map(($2, item) => {
                    const result = $2.let(variant("ready", null), EditingReadinessType);
                    $2.try(($3) => {
                        $3.assign(result, check(item.entry.decodeBeast(rowType, "v2"), parse(item.id)));
                    }).catch(($3, message) => {
                        $3.assign(result, variant("invalid", [{ field: "", message: East.str`Readiness check failed: ${message}` }]));
                    });
                    return result;
                });
            });
        })();
        // The shared session over the record (`session.ts`): whole-entry drafts, keyed batches, Save through the
        // patch door; its base the record's snapshot, or for a kind read a window at a time (#1199) its revision.
        const { editing, entries: entriesSeam } = session.build();
        const fieldsOfKind = {
            key: slot,
            name: config.name,
            icon: config.icon,
            takes,
            status: statusTable === undefined || statusCases === undefined ? [] : statusCases.map((c) => ({ case: c, status: fieldOf(statusTable, c) })),
            backlog: optional,
            templates: templateRows,
            templatesSource: templatesSource === undefined ? none : some(templatesSource),
            fields: East.value(form, ArrayType(FieldSpecType)),
            items,
            unscheduled,
            write,
            ready: ready === undefined ? none : some(ready),
            editing,
            entries: entriesSeam,
            history: session.history,
            event: readEvent(itemOf as unknown as ExprType<FunctionType<[EastType], EastType>>, ScheduleReadType, reads),
            // A kind with no title names none: the Calendar and Plan, whose inspectors draw it, refuse one.
            schedule: { title: titleField ?? "", start: startField, end: endField,
                resource: resource === undefined ? none : some(resource.field),
                status: config.status === undefined ? none : some(config.status.field) },
            overlaps: variant(overlaps, null),
            inspector: inspector === undefined ? none : some(inspector),
        };
        return { fields: fieldsOfKind, itemOf, reads };
    };

    // ── The builders over the app's own records (#1367) ─────────────────────
    /**
     * The stored rows overlapping `[from, to)`, by their key's text: each its roles, read by `rolesOf` in the pass that
     * reads the row, and the row as bytes — through the kind's reads (its source's part, its day index, or the record
     * whole), `none` while a read is in flight. Overlap is the views' rule: a row starts before the window ends and
     * ends after it starts, or, of no length, sits inside it. The builder puts its drafts in place itself (`Builder
     * Interfaces Spec.md` §9). The times are plain DateTime fields: both builds refuse Option times.
     */
    const storedRows = (reads: Reads, EntryType: StructType, rolesOf: ExprType<FunctionType<[EastType, StringType], EastType>>) => {
        const RowsType = OptionType(DictType(StringType, EntryType));
        return East.function([DateTimeType, DateTimeType], RowsType, ($, from, to) => {
            const text = $.const(idOf);
            const roles = $.const(rolesOf);
            const result = $.let(East.value(none, RowsType), RowsType);
            let read: ExprType<OptionType<DictType<EastType, EastType>>>;
            if (reads.days === undefined) {
                read = $.let(East.value(some(readAll()), OptionType(HeldType)));
            } else {
                const days = $.const(reads.days);
                read = $.let(days(from, to));
            }
            $.match(read, {
                some: ($2, held) => {
                    const out = $2.let(new Map(), DictType(StringType, EntryType));
                    $2.for(held, ($3, row, key) => {
                        const start = $3.const(fieldOf(row, startField) as unknown as ExprType<DateTimeType>);
                        const end = $3.const(fieldOf(row, endField) as unknown as ExprType<DateTimeType>);
                        $3.if(East.less(start, to).and(() => East.greater(end, from).or(() => East.greaterEqual(start, from))), ($4) => {
                            const id = $4.const(text(key));
                            $4(out.insert(id, East.value({ roles: roles(row, id), row: East.Blob.encodeBeast(row, "v2") } as never, EntryType)));
                        });
                    });
                    $2.assign(result, East.value(some(out), RowsType));
                },
            });
            return result;
        });
    };
    /** Refuses two of a builder's roles naming one field: a builder writes each of its roles into a field of its own (B1). */
    const oneFieldEach = (builder: string, named: readonly (readonly [string, string | undefined])[]): void => {
        const seen = new Map<string, string>();
        for (const [prop, name] of named) {
            if (name === undefined) continue;
            const prior = seen.get(name);
            if (prior !== undefined) {
                throw new Error(`${where}: \`${prior}\` and \`${prop}\` both name "${name}" — the ${builder} writes each of its roles into a field of its own`);
            }
            seen.set(name, prop);
        }
    };

    return {
        [SCHEDULE_DEF]: "events",
        keyType,
        rowType,
        name: config.name,
        icon: config.icon,
        title: titleField,
        takes,
        draw: draw as PlanDrawLiteral,
        templatesSource,
        templatesList: config.templates === undefined ? "none" : SCHEDULE_TEMPLATES in config.templates ? "record" : "code",
        roles: [...rosterGiven, ...allocationGiven],
        partsOf: config.parts?.of,
        allocationValues,
        build(slot: string, part?: ScheduleKindPart): ExprType<ScheduleKindType> {
            return East.value(kindParts(slot, part, formSpecs).fields as never, ScheduleKindType);
        },
        buildRoster(slot: string, part?: ScheduleKindPart): ExprType<ScheduleRosterKindType> {
            // A duty runs from its start to its end, keyed by String, on its slot's shift and group, rostered to someone.
            if (instantKind) {
                throw new Error(`${where}: the Roster reads a duty's \`start\` and \`end\`; this kind is one instant (\`at\`) — give \`start\` and \`end\` in its place`);
            }
            if (optional) throw new Error(`${where}: a duty has its times — \`start\` and \`end\` are DateTime fields, not Options`);
            if (keyType.type !== "String") {
                throw new Error(`${where}: the Roster's duties are keyed by String — a duty is named by its key, and this record is keyed by ${printType(keyType)}`);
            }
            if (shiftField === undefined || groupField === undefined) {
                throw new Error(`${where}: the Roster places a duty by its \`shift\` and its \`group\` — give both`);
            }
            if (resource === undefined || resourceValue === undefined) {
                throw new Error(`${where}: the Roster rosters each duty to a person or an agency, its \`resource\` — give it, resource: { field, of: "people" }`);
            }
            oneFieldEach("Roster", [["start", startField], ["end", endField], ["resource.field", resource.field], ["shift", shiftField],
                ["group", groupField], ["position", positionField], ["activity", activityField]]);
            const shift = shiftField;
            const group = groupField;
            const who = resource.field;
            const whoOf = resourceValue;
            const parts = kindParts(slot, part, formOver([startField, endField, who, shift, group, positionField, activityField]));
            const Roles = ScheduleRosterRolesType;
            // A row with the Roster's roles written from `roles`, the resource field from `value`, and every other field
            // from `source`: the row as it was, or a new row's defaults. A kind with no `position` writes none.
            const rosterRow = (source: ExprType<EastType>, roles: ExprType<typeof Roles>, value: ExprType<EastType>): ExprType<EastType> =>
                East.value(Object.fromEntries(Object.keys(fields).map((f) => [f,
                    f === startField ? roles.start
                        : f === endField ? roles.end
                            : f === who ? value
                                : f === shift ? roles.shift
                                    : f === group ? roles.group
                                        : f === positionField ? roles.position.match({ some: (_$, held) => held, none: () => fieldOf(source, f) as ExprType<StringType> })
                                            : f === activityField ? roles.activity
                                                : fieldOf(source, f)])) as never, rowType) as ExprType<EastType>;
            // A duty's roles, from its row and its key: its times and who, its shift and group, its position and
            // activity, and the hours it counts.
            const rolesOf = East.function([rowType, StringType], Roles, ($, row, key) => {
                const ref = $.const(refOf);
                const start = $.const(fieldOf(row, startField) as unknown as ExprType<DateTimeType>);
                const end = $.const(fieldOf(row, endField) as unknown as ExprType<DateTimeType>);
                let hours: ExprType<FloatType>;
                if (hoursOf === undefined) {
                    // Its length.
                    hours = $.const(start.durationMinutes(end).divide(60.0));
                } else {
                    const count = $.const(hoursOf);
                    hours = $.const(count(row as never, key as never));
                }
                return East.value({
                    start, end, resource: ref(row), shift: fieldOf(row, shift), group: fieldOf(row, group),
                    position: positionField === undefined ? none : some(fieldOf(row, positionField)),
                    activity: activityField === undefined ? none : fieldOf(row, activityField),
                    hours,
                } as never, Roles);
            });
            // A drafted duty's roles, from its bytes: what `rows` gives a stored one in the pass that reads it.
            const read = East.function([BlobType, StringType], Roles, ($, bytes, key) => {
                const of = $.const(rolesOf);
                return of(bytes.decodeBeast(rowType, "v2") as never, key);
            });
            // The row with its roles written, and every other field as it was (B1); `none` for a resource the kind refuses.
            const write = East.function([BlobType, Roles], OptionType(BlobType), ($, bytes, roles) => {
                const row = $.const(bytes.decodeBeast(rowType, "v2"));
                const resolve = $.const(whoOf);
                const result = $.let(East.value(none, OptionType(BlobType)), OptionType(BlobType));
                $.match(resolve(roles.resource), {
                    some: ($2, value) => { $2.assign(result, East.value(some(East.Blob.encodeBeast(rosterRow(row, roles, value as ExprType<EastType>), "v2")), OptionType(BlobType))); },
                });
                return result;
            });
            // A new duty: its roles written, and every other field its type's default.
            const blank = East.value(defaultValue(rowType) as never, rowType) as ExprType<EastType>;
            const create = East.function([Roles], OptionType(BlobType), ($, roles) => {
                const row = $.const(blank);
                const resolve = $.const(whoOf);
                const result = $.let(East.value(none, OptionType(BlobType)), OptionType(BlobType));
                $.match(resolve(roles.resource), {
                    some: ($2, value) => { $2.assign(result, East.value(some(East.Blob.encodeBeast(rosterRow(row, roles, value as ExprType<EastType>), "v2")), OptionType(BlobType))); },
                });
                return result;
            });
            return East.value({
                kind: East.value(parts.fields as never, ScheduleKindType),
                rows: storedRows(parts.reads, ScheduleRosterEntryType, rolesOf as unknown as ExprType<FunctionType<[EastType, StringType], EastType>>),
                read,
                write,
                create,
                roles: { position: positionField !== undefined, activity: activityField !== undefined },
                rowType: toEastTypeValue(rowType),
            } as never, ScheduleRosterKindType);
        },
        buildAllocation(slot: string, part?: ScheduleKindPart): ExprType<ScheduleAllocationKindType> {
            // A bin is one instant, keyed by String, in one lane, booking an arrival, its quantity on its parts for its hold.
            if (!instantKind) {
                throw new Error(`${where}: the Allocation's bins are an instant kind: give \`at\` in place of \`start\` and \`end\``);
            }
            if (keyType.type !== "String") {
                throw new Error(`${where}: the Allocation's bins are keyed by String — a bin is named by its key, and this record is keyed by ${printType(keyType)}`);
            }
            if (resource === undefined) throw new Error(`${where}: the Allocation books a bin into a lane, its \`resource\` — give it`);
            if (resource.shape !== "key" || resource.optional) {
                throw new Error(`${where}: the Allocation books each bin into one lane — \`resource\` names a String field, a key of the lanes' kind, ` +
                    `and "${resource.field}" holds ${typeText(fields[resource.field]!)}`);
            }
            if (arrivalField === undefined) throw new Error(`${where}: the Allocation books a bin's \`arrival\` — give it`);
            if (quantityField === undefined) throw new Error(`${where}: the Allocation reads a bin's \`quantity\` — give it`);
            if (partsField === undefined || config.parts === undefined) throw new Error(`${where}: the Allocation allocates a bin's \`parts\` — give it`);
            if (holdField === undefined) throw new Error(`${where}: the Allocation holds a bin for its \`hold\` — give it`);
            oneFieldEach("Allocation", [["at", startField], ["resource.field", resource.field], ["arrival", arrivalField], ["quantity.field", quantityField],
                ["parts.field", partsField], ["hold", holdField], ["kind", kindField]]);
            const lane = resource.field;
            const arrival = arrivalField;
            const quantity = quantityField;
            const shares = partsField;
            const hold = holdField;
            // The fields no role maps (`allocationValues`): what an arrival's values give a booked bin, a reservation's their type's default.
            const mapped = allocationMapped;
            const ValuesType = allocationValues;
            const parts = kindParts(slot, part, formOver([...mapped]));
            const Roles = ScheduleAllocationRolesType;
            // A row with the Allocation's roles written from `roles`, and every other field from `source`: the row as it
            // was, or a booked bin's values. A kind with no `kind` writes none.
            const binRow = (source: ExprType<EastType>, roles: ExprType<typeof Roles>): ExprType<EastType> =>
                East.value(Object.fromEntries(Object.keys(fields).map((f) => [f,
                    f === startField ? roles.at
                        : f === lane ? roles.lane
                            : f === arrival ? roles.arrival
                                : f === quantity ? roles.quantity
                                    : f === shares ? roles.parts
                                        : f === hold ? roles.hold
                                            : f === kindField ? roles.kind
                                                : fieldOf(source, f)])) as never, rowType) as ExprType<EastType>;
            // A bin's roles, from its row: its time and lane, the arrival it books, its quantity and parts, its hold and kind.
            const rolesOf = East.function([rowType, StringType], Roles, (_$, row, _key) => East.value({
                at: fieldOf(row, startField), lane: fieldOf(row, lane), arrival: fieldOf(row, arrival), quantity: fieldOf(row, quantity),
                parts: fieldOf(row, shares), hold: fieldOf(row, hold), kind: kindField === undefined ? none : fieldOf(row, kindField),
            } as never, Roles));
            // A drafted bin's roles, from its bytes: what `rows` gives a stored one in the pass that reads it.
            const read = East.function([BlobType], Roles, ($, bytes) => {
                const of = $.const(rolesOf);
                return of(bytes.decodeBeast(rowType, "v2") as never, "");
            });
            // The row with its roles written, and every other field as it was (B1).
            const write = East.function([BlobType, Roles], BlobType, ($, bytes, roles) => {
                const row = $.const(bytes.decodeBeast(rowType, "v2"));
                return East.Blob.encodeBeast(binRow(row, roles), "v2");
            });
            // A new bin: its roles written, and every other field the arrival's values' — or, with none, its type's default (B13).
            const blank = East.value(defaultValue(ValuesType) as never, ValuesType) as ExprType<EastType>;
            const create = East.function([Roles, OptionType(BlobType)], BlobType, ($, roles, values) => {
                const given = $.const(values.match({
                    some: (_$2, bytes) => bytes.decodeBeast(ValuesType, "v2") as ExprType<EastType>,
                    none: (_$2) => blank,
                }) as ExprType<EastType>);
                return East.Blob.encodeBeast(binRow(given, roles), "v2");
            });
            return East.value({
                kind: East.value(parts.fields as never, ScheduleKindType),
                rows: storedRows(parts.reads, ScheduleAllocationEntryType, rolesOf as unknown as ExprType<FunctionType<[EastType, StringType], EastType>>),
                read,
                write,
                create,
                lanes: resource.of,
                parts: config.parts.of,
                kinded: kindField !== undefined,
                unit: config.quantity?.unit === undefined ? none : some(config.quantity.unit),
                values: toEastTypeValue(ValuesType),
                rowType: toEastTypeValue(rowType),
            } as never, ScheduleAllocationKindType);
        },
        buildPlan(slot: string, part?: ScheduleKindPart): ExprType<PlanEventKindType> {
            const parts = kindParts(slot, part, formSpecs);
            const quantity = config.quantity;
            const format = quantity?.format === undefined ? undefined : East.value(quantity.format as SubtypeExprOrValue<TickFormatType>, TickFormatType);
            // One event as Plan draws it: what every view draws, with its roles read from their fields.
            const planItemOf = East.function([EntryRowType], PlanEventItemType, ($, entry) => {
                const make = $.const(parts.itemOf);
                const item = $.const(make(entry));
                const row = entry.row;
                const read = item as unknown as Record<string, ExprType<EastType>>;
                return East.value({
                    ...Object.fromEntries(Object.keys(ScheduleItemType.fields).map((f) => [f, read[f]!])),
                    state: stateField === undefined ? variant("confirmed", null) : fieldOf(row, stateField),
                    quantity: quantityField === undefined ? none : some({
                        value: fieldOf(row, quantityField),
                        unit: quantity?.unit === undefined ? none : some(quantity.unit),
                        format: format === undefined ? none : some(format),
                        text: none,
                    }),
                    lane: laneField === undefined ? none : some(fieldOf(row, laneField)),
                } as never, PlanEventItemType);
            }) as unknown as ExprType<FunctionType<[EastType], EastType>>;
            // One event by its id, the drafts in place: as Plan draws it, and its row as bytes. A draft holds its
            // event as drafted, or says it was deleted; an event never drafted — or one whose draft can't be read —
            // is the record's: read whole, or for a kind read a window at a time (#1199) looked for first among the
            // rows its windows hold over [from, to) and its backlog's, where a gesture's event is drawn, then read
            // by its key.
            const planEvent = readEvent(planItemOf, PlanEventReadType, parts.reads);
            const name = (field: string | undefined) => (field === undefined ? none : some(field));
            return East.value({
                ...parts.fields,
                draw: variant(draw, null),
                instant: instantKind,
                overlaps: variant(overlaps, null),
                roles: { state: name(stateField), quantity: name(quantityField), lane: name(laneField) },
                planItems: windowOf(PlanEventItemType, planItemOf, parts.reads),
                planUnscheduled: backlogOf(PlanEventItemType, planItemOf, parts.reads),
                planEvent,
                inspector: inspector === undefined ? East.value(none, OptionType(RowInspectorType)) : East.value(some(inspector), OptionType(RowInspectorType)),
            } as never, PlanEventKindType);
        },
    };
}
