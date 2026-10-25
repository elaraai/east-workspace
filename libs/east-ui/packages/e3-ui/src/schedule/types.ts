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
    ArrayType, BlobType, BooleanType, DateTimeType, DictType, EastTypeType, FloatType, FunctionType, IntegerType, NullType, OptionType, SetType,
    StringType, StructType, VariantType,
} from "@elaraai/east";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import { EventStateType, StatusTokenType, StatusValueType, TimeStepType } from "@elaraai/east-ui";
import { EditingReadinessType, EditingType, FieldSpecType } from "@elaraai/east-ui/internal";
import { PlanDrawType, PlanQuantityType, PlanRollupType } from "../plan/types.js";
import { RowInspectorType } from "../utils/row-inspector.js";

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

/**
 * Why something does not fit: the refusal a fit gives, and what a run of
 * refusals of one group gathers into one label (`Over max · by 4–13 m³`).
 *
 * @property group - Its group, the run label's lead (`Over max`, `Busy`, `Gap too short`)
 * @property reason - Its words (`over max by 4 m³`)
 * @property measure - What the run's label gathers: nothing, an amount (`by` 4) or a day (`until` Fri 14)
 */
export const ScheduleRefusalType = StructType({
    group: StringType,
    reason: StringType,
    measure: VariantType({
        none: NullType,
        amount: StructType({ lead: StringType, value: FloatType }),
        day: StructType({ lead: StringType, at: DateTimeType }),
    }),
});

/** Type representing {@link ScheduleRefusalType}. */
export type ScheduleRefusalType = typeof ScheduleRefusalType;

/**
 * One verdict of a fit: it fits, with its score, its reason and a warning,
 * or it is refused. A builder ranks the fits by score and shows each reason
 * as it is; it computes none of its own.
 *
 * @property fits - It fits: higher scores rank first; `why` its reason (`3 d spare to Wed 19 · leaves 31 m³ · takes 20–40`); `warn` a warning it still fits with (`under min`)
 * @property refused - It does not fit, and why
 */
export const ScheduleFitType = VariantType({
    fits: StructType({ score: FloatType, why: StringType, warn: OptionType(StringType) }),
    refused: ScheduleRefusalType,
});

/** Type representing {@link ScheduleFitType}. */
export type ScheduleFitType = typeof ScheduleFitType;

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
 * One field written into an event: its path, and its new value as bytes at
 * the field's type — what an inspector edit writes, and each field a library
 * card's drop sets (#1195).
 *
 * @property path - The field's path, a step per struct
 * @property value - Its new value, as bytes at the field's type
 */
export const ScheduleFieldWriteType = StructType({ path: ArrayType(StringType), value: BlobType });

/** Type representing {@link ScheduleFieldWriteType}. */
export type ScheduleFieldWriteType = typeof ScheduleFieldWriteType;

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
    field: ScheduleFieldWriteType,
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
 * A kind's record read by key, for a kind read a window at a time (#1199):
 * what its editing session's base is — the record's revision — and how one
 * event is read without the record whole.
 *
 * @property revision - The record's revision, `none` while it resolves: the snapshot every read of the record is at
 * @property refresh - Moves every read of the record to a revision, or to the one it holds now
 * @property entry - One event by its key's text: `none` while its read is in flight, `some(none)` for a key the record does not hold, else its row as bytes at the record's entry type
 * @property last - The record's largest key's text — how a new Integer key is made past every key it holds: `none` while its read is in flight, `some(none)` for an empty record
 */
export const ScheduleEntriesType = StructType({
    revision: FunctionType([], OptionType(StringType)),
    refresh: FunctionType([OptionType(StringType)], NullType),
    entry: FunctionType([StringType], OptionType(OptionType(BlobType))),
    last: FunctionType([], OptionType(OptionType(StringType))),
});

/** Type representing {@link ScheduleEntriesType}. */
export type ScheduleEntriesType = typeof ScheduleEntriesType;

/**
 * Whether two events of a kind on one resource at once are a conflict.
 *
 * @property warn - They are: both wear a warn ring, and the overlaps count them (the default)
 * @property allow - They are not: the kind's events run in parallel
 */
export const ScheduleOverlapsType = VariantType({ warn: NullType, allow: NullType });

/** Type representing {@link ScheduleOverlapsType}. */
export type ScheduleOverlapsType = typeof ScheduleOverlapsType;

/** One event and its full record row, read with the current drafts in place. */
export const ScheduleReadType = StructType({ item: ScheduleItemType, row: BlobType });
/** Type representing ScheduleReadType. */
export type ScheduleReadType = typeof ScheduleReadType;

/** The fields whose edits are owned by the schedule section of an inspector. */
export const ScheduleRolesType = StructType({
    title: StringType, start: StringType, end: StringType,
    resource: OptionType(StringType), status: OptionType(StringType),
});

/**
 * One event kind, closed: every row crosses as bytes at the record's own entry
 * type, so a builder's payload is one type whatever the records hold.
 *
 * A builder over resources read a window at a time reads a kind placed on them
 * a cell at a time (#1039, #1424): the shared schedule reader reads the kind's
 * series index's cells — the events of a block of resources in one time tile —
 * and hands what it read to the kind's seams as beast2 of `cellsType`. Every
 * other kind is counted first (`count`), and read over the window only within
 * the builder's cap.
 *
 * @property key - The kind's slot name
 * @property name - Its name
 * @property icon - Its Font Awesome icon
 * @property takes - The resource kinds its events may be on
 * @property status - How each case of its status shows
 * @property backlog - Whether its rows with no time are its backlog
 * @property templates - Its templates, for the library
 * @property templatesSource - The builder's Slice source whose shown keys filter its templates, the source its templates list names; none, every template shows (#1343)
 * @property fields - The inspector's form over its other fields (`Fields`)
 * @property items - Its events overlapping `[from, to)`, the drafts in place; `none` while a read is in flight. Given the
 *   entries a reader read by the kind's series index's cells (#1039) — beast2 of `cellsType`, a key given twice held once
 *   — it draws those and never reads the window: every draft given in place, one of an entry not given drawn as drafted,
 *   for the reader gives a draft of an entry it did not read only where its narrowing holds the entry, or the record
 *   does not. A builder that caps its kinds (the Calendar's and the Plan's) reads the window only within the cap
 *   (`SCHEDULE_EVENT_CAP`), counted first: past it, the window answers `none` and reads no page
 * @property unscheduled - Its backlog: the rows with no time, the drafts in place. It takes the window `[from, to)`
 *   the canvas reads: a kind narrowed by its builder's slice holds the events its narrowing holds there and in its
 *   backlog alike, so a draft moves one between them by its times (#1343). Given the entries a reader read by its cells
 *   (#1039), it reads its backlog alone, never the window, those entries held beside it
 * @property write - Each gesture into its entry's new bytes; `none` for a gesture the kind refuses
 * @property ready - The author's check over drafted entries, one result each
 * @property editing - The shared session over the record: its entry and key types, and its patch door — its base the record's snapshot, or for a kind read a window at a time (#1199) its revision
 * @property entries - The record read by key, for a kind read a window at a time (#1199); `none` for a kind read whole
 * @property history - The record's commits, newest first
 * @property event - One event by its key's text, the drafts in place, and its row: `none` when there is no such event. A
 *   kind read a window at a time (#1199) looks for it first among the rows its windows hold over `[from, to)` and its
 *   backlog's, then reads it by its key, `none` while that read is in flight; a kind read whole takes no notice of the
 *   range. Given the event's row as a reader of its cells holds it (#1039), or `some(none)` for one it does not hold, it
 *   looks there, then in its backlog, then reads it by its key, and never reads the window
 * @property schedule - The inspector's schedule fields
 * @property overlaps - Whether two of its events on one resource at once are a conflict
 * @property inspector - The author's form in place of the default fields
 * @property seriesKey - The `.east` text of the value its resource field holds for a resource, or for no resource (#1039): what a series or a summary index of its record files that resource's events under, the key a reader's cells search for; `none` where the field cannot hold it — a resource of a kind it does not take, or no resource for a field that must name one
 * @property cellsType - What a reader encodes the entries it read by cells in for `items`, `unscheduled` and `event` (#1039): an Array of `{ key, row }`, at the record's key and row types
 * @property count - How many of its stored events overlap `[from, to)`, counted before one is read (#1039) — every kind's are: a kind read through its source of the slice counted through the source's interval index — the count its window's read asks first, so asking it costs no request of its own; a kind read through its day index (`window`) by the entries it files under the days of `[from, to)`, the search its window's read asks first — an event under each day it runs on, so an upper bound on the events, never their number (`countExact`); and a kind whose record is read whole counted in memory. `none` while the count is in flight
 * @property countExact - Whether `count` counts its events themselves (#1039): `false` for a kind read through its day index, whose count is the days its events run on — what a builder's figures never take for its events, saying they are not counted
 */
export const ScheduleKindType = StructType({
    key: StringType,
    name: StringType,
    icon: StringType,
    takes: ArrayType(StringType),
    status: ArrayType(StructType({ case: StringType, status: ScheduleStatusType })),
    backlog: BooleanType,
    templates: ArrayType(ScheduleTemplateType),
    templatesSource: OptionType(StringType),
    fields: ArrayType(FieldSpecType),
    items: FunctionType([DateTimeType, DateTimeType, ScheduleDraftsType, OptionType(BlobType)], OptionType(ArrayType(ScheduleItemType))),
    unscheduled: FunctionType([DateTimeType, DateTimeType, ScheduleDraftsType, OptionType(BlobType)], OptionType(ArrayType(ScheduleItemType))),
    write: FunctionType([ArrayType(ScheduleWriteType)], ArrayType(OptionType(BlobType))),
    ready: OptionType(FunctionType([ArrayType(ScheduleReadyEntryType)], ArrayType(EditingReadinessType))),
    editing: EditingType,
    entries: OptionType(ScheduleEntriesType),
    history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
    event: FunctionType([StringType, ScheduleDraftsType, DateTimeType, DateTimeType, OptionType(OptionType(BlobType))], OptionType(ScheduleReadType)),
    schedule: ScheduleRolesType,
    overlaps: ScheduleOverlapsType,
    inspector: OptionType(RowInspectorType),
    seriesKey: FunctionType([OptionType(ScheduleResourceRefType)], OptionType(StringType)),
    cellsType: EastTypeType,
    count: FunctionType([DateTimeType, DateTimeType], OptionType(IntegerType)),
    countExact: BooleanType,
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
 * A resource kind's records read whole, for the app's optimiser (#1409): its
 * rows as bytes at `DictType(keyType, rowType)`, read as a run starts — what
 * the run's request carries of the kind beside the events, as context.
 */
export const ScheduleResourceRecordsType = FunctionType([], BlobType);

/** Type representing {@link ScheduleResourceRecordsType}. */
export type ScheduleResourceRecordsType = typeof ScheduleResourceRecordsType;

/**
 * One resource kind, its rows resolved.
 *
 * @property key - The kind's slot name
 * @property name - Its name
 * @property icon - Its Font Awesome icon
 * @property rows - Its resources, in key order
 * @property keyType - The kind's key type: what the app's optimiser is asked its rows by (#1409)
 * @property rowType - Its row type
 * @property records - Its records read whole, as a run's request carries them (#1409); `none` for a kind paged a window at a time, whose rows are never read whole — a run carries none of it
 */
export const ScheduleResourcesType = StructType({
    key: StringType,
    name: StringType,
    icon: StringType,
    rows: ArrayType(ScheduleResourceRowType),
    keyType: EastTypeType,
    rowType: EastTypeType,
    records: OptionType(ScheduleResourceRecordsType),
});

/** Type representing {@link ScheduleResourcesType}. */
export type ScheduleResourcesType = typeof ScheduleResourcesType;

// ============================================================================
// The kinds as Plan's builder takes them (#1190)
// ============================================================================

/**
 * One event as Plan draws it: what every view draws ({@link ScheduleItemType}),
 * with its lifecycle, its quantity and its lane.
 *
 * @property state - The lifecycle it wears, from its kind's `state` field; confirmed when the kind has none
 * @property quantity - Its kind's `quantity` field, with the kind's unit and format: what a bar prints and a parent's rollup sums
 * @property lane - The lane its tile sits in, from its kind's `lane` field
 */
export const PlanEventItemType = StructType({
    ...ScheduleItemType.fields,
    state: EventStateType,
    quantity: OptionType(PlanQuantityType),
    lane: OptionType(StringType),
});

/** Type representing {@link PlanEventItemType}. */
export type PlanEventItemType = typeof PlanEventItemType;

/**
 * One event read by its key, as a Plan's inspector shows it (#1197).
 *
 * @property item - The event as Plan draws it
 * @property row - Its row, as bytes at the record's entry type: what the kind's form and its own inspector read
 */
export const PlanEventReadType = StructType({ item: PlanEventItemType, row: BlobType });

/** Type representing {@link PlanEventReadType}. */
export type PlanEventReadType = typeof PlanEventReadType;

/**
 * The fields an event kind's roles read on a Plan, by name: what a gesture
 * writes to change one (a `field` gesture's path), and what the inspector
 * draws in its own sections rather than in the kind's form.
 *
 * @property state - The `EventStateType` field
 * @property quantity - The `Float` quantity field
 * @property lane - The `String` lane field
 */
export const PlanEventRolesType = StructType({
    state: OptionType(StringType),
    quantity: OptionType(StringType),
    lane: OptionType(StringType),
});

/** Type representing {@link PlanEventRolesType}. */
export type PlanEventRolesType = typeof PlanEventRolesType;

/**
 * One event kind as Plan's builder takes it: the Calendar's closed kind
 * ({@link ScheduleKindType}), field for field — its cells' seams and its count
 * among them (#1039) — with how the kind draws and its roles, its events as
 * Plan draws them, and its own inspector.
 *
 * @property draw - How it draws: bars, tiles, chips or marks
 * @property instant - Whether each of its events is one instant (`at`), its start and its end the same
 * @property overlaps - Whether two of its events on one resource at once are a conflict
 * @property roles - The fields its roles read
 * @property planItems - Its events overlapping `[from, to)` as Plan draws them, as `items` reads them: the drafts in place, from the entries a reader read by its cells when it is given them, else over the window; `none` while a read is in flight
 * @property planUnscheduled - Its backlog as Plan draws it, as `unscheduled` reads it
 * @property planEvent - One event by its key's text, the drafts in place (#1197): as Plan draws it, and its row, as `event` reads it; `none` when there is no such event
 * @property inspector - Its own inspector for one event (PB60, #1197): the event's row and a writer of the edited row, as bytes, to what the inspector shows in place of the kind's form; `none`, the form
 */
export const PlanEventKindType = StructType({
    ...ScheduleKindType.fields,
    draw: PlanDrawType,
    instant: BooleanType,
    overlaps: ScheduleOverlapsType,
    roles: PlanEventRolesType,
    planItems: FunctionType([DateTimeType, DateTimeType, ScheduleDraftsType, OptionType(BlobType)], OptionType(ArrayType(PlanEventItemType))),
    planUnscheduled: FunctionType([DateTimeType, DateTimeType, ScheduleDraftsType, OptionType(BlobType)], OptionType(ArrayType(PlanEventItemType))),
    planEvent: FunctionType([StringType, ScheduleDraftsType, DateTimeType, DateTimeType, OptionType(OptionType(BlobType))], OptionType(PlanEventReadType)),
    inspector: OptionType(RowInspectorType),
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
 * @property measures - Its measures' keys, in order: the rows under each of its resources, each at its resource's path (#1197)
 * @property rows - Its resources, in key order — none for a kind paged a window at a time (#1199)
 * @property byKey - A paged kind's resource by its key's text (#1199): its window's key search for the key, then a one-row page, as Plan's builder takes it — `none` while either is in flight, `some(none)` for a key the kind does not have; `none` for a kind whose rows are listed
 * @property keyType - The kind's key type: what the app's optimiser is asked its rows by (#1409)
 * @property rowType - Its row type
 * @property records - Its records read whole, as a run's request carries them (#1409); `none` for a kind paged a window at a time — a run carries none of it
 */
export const PlanResourcesType = StructType({
    key: StringType,
    name: StringType,
    icon: StringType,
    rollup: PlanRollupType,
    measures: ArrayType(StringType),
    rows: ArrayType(PlanResourceRowType),
    byKey: OptionType(FunctionType([StringType], OptionType(OptionType(PlanResourceRowType)))),
    keyType: EastTypeType,
    rowType: EastTypeType,
    records: OptionType(ScheduleResourceRecordsType),
});

/** Type representing {@link PlanResourcesType}. */
export type PlanResourcesType = typeof PlanResourcesType;

// ============================================================================
// The kinds as the builders over the app's own records take them (#1367)
// ============================================================================

/**
 * A duty's roles, as the Roster reads them from the app's row
 * (`Builder Interfaces Spec.md` §4.1, §5.2): what its kind's fields hold,
 * whatever the row calls them.
 *
 * @property start - When it starts
 * @property end - When it ends
 * @property resource - Who: a person, or an agency asked to send someone, by the resource kind its field's case names
 * @property shift - Its shift's key
 * @property group - The group it is rostered in
 * @property position - The position held; `none` for a kind with no `position` role
 * @property activity - Its activity; `none` when it has none, or the kind has no `activity` role
 * @property hours - The hours it counts: its kind's `hours` accessor's, or its length
 */
export const ScheduleRosterRolesType = StructType({
    start: DateTimeType,
    end: DateTimeType,
    resource: OptionType(ScheduleResourceRefType),
    shift: StringType,
    group: StringType,
    position: OptionType(StringType),
    activity: OptionType(StringType),
    hours: FloatType,
});

/** Type representing {@link ScheduleRosterRolesType}. */
export type ScheduleRosterRolesType = typeof ScheduleRosterRolesType;

/**
 * One stored duty, as a Roster kind's `rows` gives it: its roles, read in the
 * same pass that reads the row, and the row as bytes at the row type — what a
 * write and the session take, and what a request's assignment carries.
 *
 * @property roles - Its roles
 * @property row - Its row, as bytes at the row type
 */
export const ScheduleRosterEntryType = StructType({ roles: ScheduleRosterRolesType, row: BlobType });

/** Type representing {@link ScheduleRosterEntryType}. */
export type ScheduleRosterEntryType = typeof ScheduleRosterEntryType;

/**
 * One event kind as the Roster takes it (#1367): the Calendar's closed kind
 * — its session over the record, its reads, its form — with its rows, and its
 * roles read from a row and written into one.
 *
 * @property kind - The Calendar's closed kind: its `editing`, `entries`, `history`, `ready`, `fields` and `inspector`
 * @property rows - Its stored duties overlapping `[from, to)`, by key, each its roles and its row; `none` while a read is in flight
 * @property read - A drafted row's roles, from its bytes and its key: what `rows` gives a stored one
 * @property write - The row with every mapped field written from the roles and every other field as it was; `none` for a resource of a kind it does not take
 * @property create - A new row from the roles, every other field its type's default; `none` as `write` refuses
 * @property roles - Which of the optional roles the kind maps
 * @property rowType - The row type
 */
export const ScheduleRosterKindType = StructType({
    kind: ScheduleKindType,
    rows: FunctionType([DateTimeType, DateTimeType], OptionType(DictType(StringType, ScheduleRosterEntryType))),
    read: FunctionType([BlobType, StringType], ScheduleRosterRolesType),
    write: FunctionType([BlobType, ScheduleRosterRolesType], OptionType(BlobType)),
    create: FunctionType([ScheduleRosterRolesType], OptionType(BlobType)),
    roles: StructType({ position: BooleanType, activity: BooleanType }),
    rowType: EastTypeType,
});

/** Type representing {@link ScheduleRosterKindType}. */
export type ScheduleRosterKindType = typeof ScheduleRosterKindType;

/**
 * A bin's roles, as the Allocation reads them from the app's row
 * (`Builder Interfaces Spec.md` §4.1, §6.2).
 *
 * @property at - Its time
 * @property lane - Its lane's key
 * @property arrival - The arrival it books; `none` for a reservation
 * @property quantity - Its quantity
 * @property parts - The quantity on each resource, by key
 * @property hold - How long a resource holds it
 * @property kind - What it goes with; `none` when it has none, or the kind has no `kind` role
 */
export const ScheduleAllocationRolesType = StructType({
    at: DateTimeType,
    lane: StringType,
    arrival: OptionType(StringType),
    quantity: FloatType,
    parts: DictType(StringType, FloatType),
    hold: TimeStepType,
    kind: OptionType(StringType),
});

/** Type representing {@link ScheduleAllocationRolesType}. */
export type ScheduleAllocationRolesType = typeof ScheduleAllocationRolesType;

/**
 * One stored bin, as an Allocation kind's `rows` gives it: its roles, read in
 * the same pass that reads the row, and the row as bytes at the row type.
 *
 * @property roles - Its roles
 * @property row - Its row, as bytes at the row type
 */
export const ScheduleAllocationEntryType = StructType({ roles: ScheduleAllocationRolesType, row: BlobType });

/** Type representing {@link ScheduleAllocationEntryType}. */
export type ScheduleAllocationEntryType = typeof ScheduleAllocationEntryType;

/**
 * One event kind as the Allocation takes it (#1367): the Calendar's closed
 * kind, with its rows, and its roles read from a row and written into one.
 *
 * @property kind - The Calendar's closed kind: its `editing`, `entries`, `history`, `ready`, `fields` and `inspector`
 * @property rows - Its stored bins of `[from, to)`, by key, each its roles and its row; `none` while a read is in flight
 * @property read - A drafted row's roles, from its bytes: what `rows` gives a stored one
 * @property write - The row with every mapped field written from the roles and every other field as it was
 * @property create - A new row from the roles, and an arrival's values — the fields no role maps, as bytes at `values` — or, with none, every such field its type's default
 * @property lanes - The resource slot its lanes are: what its `resource.of` names
 * @property parts - The resource slot its parts are on: what its `parts.of` names
 * @property kinded - Whether it maps a `kind`
 * @property unit - Its quantity's unit (`m³`), shown everywhere a quantity is: its `quantity.unit`
 * @property values - The fields no role maps, a struct: what an arrival's values give a booked bin
 * @property rowType - The row type
 */
export const ScheduleAllocationKindType = StructType({
    kind: ScheduleKindType,
    rows: FunctionType([DateTimeType, DateTimeType], OptionType(DictType(StringType, ScheduleAllocationEntryType))),
    read: FunctionType([BlobType], ScheduleAllocationRolesType),
    write: FunctionType([BlobType, ScheduleAllocationRolesType], BlobType),
    create: FunctionType([ScheduleAllocationRolesType, OptionType(BlobType)], BlobType),
    lanes: StringType,
    parts: StringType,
    kinded: BooleanType,
    unit: OptionType(StringType),
    values: EastTypeType,
    rowType: EastTypeType,
});

/** Type representing {@link ScheduleAllocationKindType}. */
export type ScheduleAllocationKindType = typeof ScheduleAllocationKindType;

/**
 * A period's status, as a builder reads it from the app's status field
 * (`Builder Interfaces Spec.md` §4.3).
 *
 * @property draft - The draft case: editable
 * @property published - The published case, and when, when the case holds a time; read-only
 * @property other - Any other case of the app's status, by its name; read-only
 */
export const SchedulePeriodStatusType = VariantType({
    draft: NullType,
    published: StructType({ at: OptionType(DateTimeType) }),
    other: StringType,
});

/** Type representing {@link SchedulePeriodStatusType}. */
export type SchedulePeriodStatusType = typeof SchedulePeriodStatusType;

/**
 * What a builder publishes, closed (`Schedule.periods`, #1367): the app's
 * record of periods, a row each, keyed by its start.
 *
 * @property every - What a period is: a week from the builder's week start, or a UTC day
 * @property editing - The shared session over the record: whole rows by their start, its patch door
 * @property entries - The record read by key, when it is given `entries`; `none` for a record read whole
 * @property rows - The periods starting in `[from, to)`, by their start, as bytes at the row type; `none` while a read is in flight
 * @property status - A row's status
 * @property publish - The row, or a new one, with its status the published case at the time given
 * @property dismissible - Whether the builder maps `dismissed`
 * @property dismissed - The proposals a row dismissed; empty when the builder maps none
 * @property dismiss - The row, or a new one, with its dismissed proposals the set given
 * @property history - The record's commits, newest first
 * @property rowType - The row type
 */
export const SchedulePeriodsKindType = StructType({
    every: VariantType({ week: NullType, day: NullType }),
    editing: EditingType,
    entries: OptionType(ScheduleEntriesType),
    rows: FunctionType([DateTimeType, DateTimeType], OptionType(DictType(DateTimeType, BlobType))),
    status: FunctionType([BlobType], SchedulePeriodStatusType),
    publish: FunctionType([OptionType(BlobType), DateTimeType], BlobType),
    dismissible: BooleanType,
    dismissed: FunctionType([BlobType], SetType(StringType)),
    dismiss: FunctionType([OptionType(BlobType), SetType(StringType)], BlobType),
    history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
    rowType: EastTypeType,
});

/** Type representing {@link SchedulePeriodsKindType}. */
export type SchedulePeriodsKindType = typeof SchedulePeriodsKindType;
