/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule`'s East types (#1218): what an author meets (`Calendar Spec.md`
 * §5.1), and the kinds' wire (§5.2) that a builder's payload holds — the
 * Calendar's, and Plan's builder's (#1190, `Plan Builder Spec.md` §5.2): the
 * same kinds with Plan's options resolved beside them.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, BooleanType, DateTimeType, DictType, FunctionType, IntegerType, NullType, OptionType, StringType,
    StructType, VariantType,
} from "@elaraai/east";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import { ApprovalStateType, EventStateType, StatusTokenType, StatusValueType, TimeStepType } from "@elaraai/east-ui";
import { EditingReadinessType, EditingType, FieldSpecType } from "@elaraai/east-ui/internal";
import { PlanDrawType, PlanQuantityType, PlanRollupType } from "../plan/types.js";

// ============================================================================
// What an author meets
// ============================================================================

/**
 * A resource: its kind's slot name, and its key's text (a String key as it
 * is, any other key as East prints it).
 *
 * @property kind - The resource kind's slot name (`people`)
 * @property key - The resource's key, as text
 */
export const ScheduleResourceRefType = StructType({ kind: StringType, key: StringType });

/** Type representing {@link ScheduleResourceRefType}. */
export type ScheduleResourceRefType = typeof ScheduleResourceRefType;

/**
 * An event: its kind's slot name, and its record key's text.
 *
 * @property kind - The event kind's slot name (`shift`)
 * @property key - The event's record key, as text
 */
export const ScheduleEventRefType = StructType({ kind: StringType, key: StringType });

/** Type representing {@link ScheduleEventRefType}. */
export type ScheduleEventRefType = typeof ScheduleEventRefType;

/**
 * How one case of an event's status shows.
 *
 * @property label - Its words
 * @property tone - Its tone: success, warning, danger, info or neutral
 * @property ring - Whether it draws as an open ring, as a tentative status does
 */
export const ScheduleStatusType = StructType({ label: StringType, tone: StatusTokenType, ring: BooleanType });

/** Type representing {@link ScheduleStatusType}. */
export type ScheduleStatusType = typeof ScheduleStatusType;

/**
 * One {@link ScheduleStatusType} per case of a status variant: the `cases` a
 * kind's `status` takes.
 *
 * @typeParam C - The variant's cases
 */
export type ScheduleStatusCasesType<C extends Record<string, unknown>> = StructType<{ [K in keyof C]: ScheduleStatusType }>;

/**
 * Constructs the status table of a status variant: one
 * {@link ScheduleStatusType} per case.
 *
 * @typeParam V - The status variant
 * @param statusType - The status variant
 * @returns A struct with a field per case
 * @throws {Error} When the type is not a variant
 */
export function ScheduleStatusCasesFor<V extends VariantType>(statusType: V): ScheduleStatusCasesType<V["cases"]> {
    if ((statusType as { type: string }).type !== "Variant") throw new Error("Schedule.Types.StatusCases: a status is a variant, one case per status");
    const cases = Object.keys(statusType.cases);
    return StructType(Object.fromEntries(cases.map((c) => [c, ScheduleStatusType]))) as unknown as ScheduleStatusCasesType<V["cases"]>;
}

/**
 * A time of day: what a template starts at when it is dropped on a whole day.
 *
 * @property hour - The hour, 0–23
 * @property minute - The minute, 0–59
 */
export const ScheduleClockType = StructType({ hour: IntegerType, minute: IntegerType });

/** Type representing {@link ScheduleClockType}. */
export type ScheduleClockType = typeof ScheduleClockType;

/** How long something takes: the time contract's minutes, hours, days, weeks or months, as a Float. */
export const ScheduleDurationType = TimeStepType;

/** Type representing {@link ScheduleDurationType}. */
export type ScheduleDurationType = typeof ScheduleDurationType;

/**
 * Where a drop would put an event: what a builder's `canDrop` is asked.
 *
 * @property kind - The event kind's slot name
 * @property from - What is dropped: a template's key, a backlog row's key, or an event's key
 * @property start - Where it would start
 * @property end - Where it would end
 * @property resource - The resource it would be on, if any
 */
export const ScheduleCandidateType = StructType({
    kind: StringType,
    from: VariantType({ template: StringType, backlog: StringType, event: StringType }),
    start: DateTimeType,
    end: DateTimeType,
    resource: OptionType(ScheduleResourceRefType),
});

/** Type representing {@link ScheduleCandidateType}. */
export type ScheduleCandidateType = typeof ScheduleCandidateType;

// ============================================================================
// The kinds' wire
// ============================================================================

/**
 * One event, as every view draws it.
 *
 * @property kind - Its kind's slot name
 * @property key - Its record key's text
 * @property title - Its title
 * @property start - When it starts; `none` in the backlog
 * @property end - When it ends; `none` in the backlog
 * @property resource - The resource it is on, if any
 * @property status - Its status, as its kind's `status` shows it
 * @property minutes - Its length in minutes, or a backlog row's duration (a month counts 30 days)
 * @property due - When it is due, for a backlog row
 */
export const ScheduleItemType = StructType({
    kind: StringType,
    key: StringType,
    title: StringType,
    start: OptionType(DateTimeType),
    end: OptionType(DateTimeType),
    resource: OptionType(ScheduleResourceRefType),
    status: OptionType(ScheduleStatusType),
    minutes: IntegerType,
    due: OptionType(DateTimeType),
});

/** Type representing {@link ScheduleItemType}. */
export type ScheduleItemType = typeof ScheduleItemType;

/**
 * One gesture, as `write` takes it.
 *
 * @property place - A move, a resize or a schedule: the start, the end and the resource
 * @property unplace - Back to the backlog: no start and no end
 * @property field - An inspector edit: the field's path and its new value, as bytes at the field's type
 * @property create - A template dropped: its key, and where the new event goes
 */
export const ScheduleGestureType = VariantType({
    place: StructType({ start: DateTimeType, end: DateTimeType, resource: OptionType(ScheduleResourceRefType) }),
    unplace: NullType,
    field: StructType({ path: ArrayType(StringType), value: BlobType }),
    create: StructType({ template: StringType, start: DateTimeType, end: DateTimeType, resource: OptionType(ScheduleResourceRefType) }),
});

/** Type representing {@link ScheduleGestureType}. */
export type ScheduleGestureType = typeof ScheduleGestureType;

/**
 * One gesture, written into one entry through the kind's field names.
 *
 * @property id - The entry's id: its key's text
 * @property entry - The entry as the gesture finds it, as bytes at the record's entry type; empty for a `create`
 * @property gesture - The gesture
 */
export const ScheduleWriteType = StructType({ id: StringType, entry: BlobType, gesture: ScheduleGestureType });

/** Type representing {@link ScheduleWriteType}. */
export type ScheduleWriteType = typeof ScheduleWriteType;

/**
 * One template, as the library lists it and a drop creates from it.
 *
 * @property key - Unique within its kind
 * @property name - The card's name
 * @property group - The library's group for it
 * @property at - When it starts if dropped on a whole day
 * @property duration - How long it runs
 * @property values - A value for every field but the start, the end and the resource, as bytes
 */
export const ScheduleTemplateType = StructType({
    key: StringType,
    name: StringType,
    group: OptionType(StringType),
    at: OptionType(ScheduleClockType),
    duration: ScheduleDurationType,
    values: BlobType,
});

/** Type representing {@link ScheduleTemplateType}. */
export type ScheduleTemplateType = typeof ScheduleTemplateType;

/**
 * The drafts a seam reads, by entry id: each the entry's draft, as bytes at
 * the kind's draft type (`Editing.Types.DraftField(R)`) — `value` the entry
 * as drafted, `missing` an entry deleted.
 */
export const ScheduleDraftsType = DictType(StringType, BlobType);

/** Type representing {@link ScheduleDraftsType}. */
export type ScheduleDraftsType = typeof ScheduleDraftsType;

/**
 * One drafted entry, as a kind's `ready` reads it.
 *
 * @property id - The entry's id: its key's text
 * @property entry - The drafted entry, as bytes at the record's entry type
 */
export const ScheduleReadyEntryType = StructType({ id: StringType, entry: BlobType });

/** Type representing {@link ScheduleReadyEntryType}. */
export type ScheduleReadyEntryType = typeof ScheduleReadyEntryType;

/**
 * One event kind, closed: every row crosses as bytes at the record's own entry
 * type, so a builder's payload is one type whatever the records hold.
 *
 * @property key - The kind's slot name
 * @property name - Its name
 * @property icon - Its Font Awesome icon
 * @property takes - The resource kinds its events may be on
 * @property status - How each case of its status shows
 * @property backlog - Whether its rows with no time are its backlog
 * @property templates - Its templates, for the library
 * @property fields - The inspector's form over its other fields (`Fields`)
 * @property items - Its events overlapping `[from, to)`, the drafts in place; `none` while a read is in flight
 * @property unscheduled - Its backlog: the rows with no time, the drafts in place
 * @property write - Each gesture into its entry's new bytes; `none` for a gesture the kind refuses
 * @property ready - The author's check over drafted entries, one result each
 * @property editing - The shared session over the record: its entry and key types, and its patch door
 * @property history - The record's commits, newest first
 */
export const ScheduleKindType = StructType({
    key: StringType,
    name: StringType,
    icon: StringType,
    takes: ArrayType(StringType),
    status: ArrayType(StructType({ case: StringType, status: ScheduleStatusType })),
    backlog: BooleanType,
    templates: ArrayType(ScheduleTemplateType),
    fields: ArrayType(FieldSpecType),
    items: FunctionType([DateTimeType, DateTimeType, ScheduleDraftsType], OptionType(ArrayType(ScheduleItemType))),
    unscheduled: FunctionType([ScheduleDraftsType], OptionType(ArrayType(ScheduleItemType))),
    write: FunctionType([ArrayType(ScheduleWriteType)], ArrayType(OptionType(BlobType))),
    ready: OptionType(FunctionType([ArrayType(ScheduleReadyEntryType)], ArrayType(EditingReadinessType))),
    editing: EditingType,
    history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
});

/** Type representing {@link ScheduleKindType}. */
export type ScheduleKindType = typeof ScheduleKindType;

/**
 * One resource, resolved.
 *
 * @property key - Its key's text
 * @property label - Its name
 * @property meta - Its second line
 */
export const ScheduleResourceRowType = StructType({ key: StringType, label: StringType, meta: OptionType(StringType) });

/** Type representing {@link ScheduleResourceRowType}. */
export type ScheduleResourceRowType = typeof ScheduleResourceRowType;

/**
 * One resource kind, its rows resolved.
 *
 * @property key - The kind's slot name
 * @property name - Its name
 * @property icon - Its Font Awesome icon
 * @property rows - Its resources, in key order
 */
export const ScheduleResourcesType = StructType({
    key: StringType,
    name: StringType,
    icon: StringType,
    rows: ArrayType(ScheduleResourceRowType),
});

/** Type representing {@link ScheduleResourcesType}. */
export type ScheduleResourcesType = typeof ScheduleResourcesType;

// ============================================================================
// The kinds as Plan's builder takes them (#1190)
// ============================================================================

/**
 * Whether two events of a kind on one resource at once are a conflict.
 *
 * @property warn - They are: both wear a warn ring, and the overlaps count them (the default)
 * @property allow - They are not: the kind's events run in parallel
 */
export const ScheduleOverlapsType = VariantType({ warn: NullType, allow: NullType });

/** Type representing {@link ScheduleOverlapsType}. */
export type ScheduleOverlapsType = typeof ScheduleOverlapsType;

/**
 * One event as Plan draws it: what every view draws ({@link ScheduleItemType}),
 * with its lifecycle, its quantity, its lane and its verdict.
 *
 * @property state - The lifecycle it wears, from its kind's `state` field; confirmed when the kind has none
 * @property quantity - Its kind's `quantity` field, with the kind's unit and format: what a bar prints and a parent's rollup sums
 * @property lane - The lane its tile sits in, from its kind's `lane` field
 * @property verdict - Its review verdict, from its kind's `review` field
 */
export const PlanEventItemType = StructType({
    ...ScheduleItemType.fields,
    state: EventStateType,
    quantity: OptionType(PlanQuantityType),
    lane: OptionType(StringType),
    verdict: OptionType(ApprovalStateType),
});

/** Type representing {@link PlanEventItemType}. */
export type PlanEventItemType = typeof PlanEventItemType;

/**
 * The fields an event kind's roles read on a Plan, by name: what a gesture
 * writes to change one (a `field` gesture's path), and what the inspector
 * draws in its own sections rather than in the kind's form.
 *
 * @property state - The `EventStateType` field
 * @property quantity - The `Float` quantity field
 * @property lane - The `String` lane field
 * @property review - The `ApprovalStateType` field a verdict writes
 */
export const PlanEventRolesType = StructType({
    state: OptionType(StringType),
    quantity: OptionType(StringType),
    lane: OptionType(StringType),
    review: OptionType(StringType),
});

/** Type representing {@link PlanEventRolesType}. */
export type PlanEventRolesType = typeof PlanEventRolesType;

/**
 * One event kind as Plan's builder takes it: the Calendar's closed kind
 * ({@link ScheduleKindType}), field for field, with how the kind draws and its
 * roles, and its events as Plan draws them.
 *
 * @property draw - How it draws: bars, tiles, chips or marks
 * @property instant - Whether each of its events is one instant (`at`), its start and its end the same
 * @property overlaps - Whether two of its events on one resource at once are a conflict
 * @property roles - The fields its roles read
 * @property planItems - Its events overlapping `[from, to)` as Plan draws them, the drafts in place; `none` while a read is in flight
 * @property planUnscheduled - Its backlog as Plan draws it, the drafts in place
 */
export const PlanEventKindType = StructType({
    ...ScheduleKindType.fields,
    draw: PlanDrawType,
    instant: BooleanType,
    overlaps: ScheduleOverlapsType,
    roles: PlanEventRolesType,
    planItems: FunctionType([DateTimeType, DateTimeType, ScheduleDraftsType], OptionType(ArrayType(PlanEventItemType))),
    planUnscheduled: FunctionType([ScheduleDraftsType], OptionType(ArrayType(PlanEventItemType))),
});

/** Type representing {@link PlanEventKindType}. */
export type PlanEventKindType = typeof PlanEventKindType;

/**
 * One resource as Plan's builder takes it: what every view draws
 * ({@link ScheduleResourceRowType}), with where it sits and its gutter.
 *
 * @property group - The group strip it sits under (a hall); `none` when the kind has no `group`
 * @property parent - The key's text of the resource of its kind it nests under
 * @property sub - The gutter's sub line
 * @property value - The gutter's value slot
 * @property status - The gutter's status dot
 * @property collapsed - Whether it starts folded, when it has resources under it
 */
export const PlanResourceRowType = StructType({
    ...ScheduleResourceRowType.fields,
    group: OptionType(StringType),
    parent: OptionType(StringType),
    sub: OptionType(StringType),
    value: OptionType(StringType),
    status: OptionType(StatusValueType),
    collapsed: BooleanType,
});

/** Type representing {@link PlanResourceRowType}. */
export type PlanResourceRowType = typeof PlanResourceRowType;

/**
 * One resource kind as Plan's builder takes it, its rows resolved.
 *
 * @property key - The kind's slot name
 * @property name - Its name
 * @property icon - Its Font Awesome icon
 * @property rollup - How a parent's bands roll its children's events up
 * @property rows - Its resources, in key order
 */
export const PlanResourcesType = StructType({
    key: StringType,
    name: StringType,
    icon: StringType,
    rollup: PlanRollupType,
    rows: ArrayType(PlanResourceRowType),
});

/** Type representing {@link PlanResourcesType}. */
export type PlanResourcesType = typeof PlanResourcesType;
