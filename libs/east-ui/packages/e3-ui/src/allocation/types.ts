/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's East types (`Allocation Spec.md` §5.1): a day's plan of
 * bins booked into lane slots and allocated to resources, the events and
 * resources an app gives the board, and the fit's question and answer.
 *
 * The plans are generic over the app's bin values `V`, so each type that holds
 * a bin is a constructor of `V`: the same `V` gives the same East type
 * (`isTypeEqual`), so a record declared once matches the board and the fit.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, StringType, StructType,
    VariantType, type EastType,
} from "@elaraai/east";
import { StatusTokenType, TimeStepType } from "@elaraai/east-ui";
import { ScheduleFitType, ScheduleRefusalType } from "../schedule/types.js";

// ============================================================================
// The plans
// ============================================================================

/**
 * A lane: it takes one bin each `every` (an hour by default), at its offset
 * past it.
 *
 * @property key - Its key, what a bin's `lane` names
 * @property label - Its name (`B-1`)
 * @property offset - How far past each slot's start its bins are booked (`minutes 15`)
 */
export const AllocationLaneType = StructType({ key: StringType, label: StringType, offset: TimeStepType });

/** Type representing {@link AllocationLaneType}. */
export type AllocationLaneType = typeof AllocationLaneType;

/**
 * A day's stored status.
 *
 * @property draft - The day is a draft
 * @property published - The day is published, read-only, at this instant
 */
export const AllocationStatusType = VariantType({ draft: NullType, published: StructType({ at: DateTimeType }) });

/** Type representing {@link AllocationStatusType}. */
export type AllocationStatusType = typeof AllocationStatusType;

/** The fields of a {@link AllocationBinType}, over the app's values `V`. */
export type AllocationBinFields<V extends EastType> = {
    lane: StringType; at: DateTimeType; event: OptionType<StringType>; quantity: FloatType; kind: OptionType<StringType>;
    hold: typeof TimeStepType; parts: DictType<StringType, FloatType>; values: V;
};

/** A bin over the app's values `V` — what {@link AllocationBinTypeFor} constructs. */
export type AllocationBinType<V extends EastType> = StructType<AllocationBinFields<V>>;

/**
 * A bin: one booking in a lane slot, and the quantity it puts on each
 * resource.
 *
 * @remarks
 * A bin keeps what it was booked with — its kind and its hold come from its
 * event when it is booked, as its values do, and stay with it when it moves —
 * so a bin can differ from its event, as a delivery measured on arrival does.
 * A reservation has no event, no quantity, no kind and no hold.
 *
 * @typeParam V - The app's bin values
 * @param values - The app's bin values type
 * @returns `StructType({ lane, at, event, quantity, kind, hold, parts, values })`
 *
 * @property lane - Its lane's key
 * @property at - Its time; a batch's bins follow one minute apart
 * @property event - Its event's key; `none` for a reservation
 * @property quantity - Its quantity; 0 for a reservation
 * @property kind - What it goes with on a resource (its event's kind when booked)
 * @property hold - How long a resource holds it from the plan day (its event's hold when booked)
 * @property parts - The quantity on each resource, by key; empty while it is not linked
 * @property values - The app's values
 */
export function AllocationBinTypeFor<V extends EastType>(values: V): AllocationBinType<V> {
    return StructType({
        lane: StringType, at: DateTimeType, event: OptionType(StringType), quantity: FloatType, kind: OptionType(StringType),
        hold: TimeStepType, parts: DictType(StringType, FloatType), values,
    }) as unknown as AllocationBinType<V>;
}

/** A day over the app's values `V` — what {@link AllocationDayTypeFor} constructs. */
export type AllocationDayType<V extends EastType> = StructType<{ status: AllocationStatusType; bins: DictType<StringType, AllocationBinType<V>> }>;

/**
 * One day's plan: its status and its bins, saved as one entry.
 *
 * @typeParam V - The app's bin values
 * @param values - The app's bin values type
 * @returns `StructType({ status, bins })`
 *
 * @property status - Draft or published
 * @property bins - Its bins, by id
 */
export function AllocationDayTypeFor<V extends EastType>(values: V): AllocationDayType<V> {
    return StructType({ status: AllocationStatusType, bins: DictType(StringType, AllocationBinTypeFor(values)) }) as unknown as AllocationDayType<V>;
}

/** The plans over the app's values `V` — what {@link AllocationDaysTypeFor} constructs. */
export type AllocationDaysType<V extends EastType> = DictType<DateTimeType, AllocationDayType<V>>;

/**
 * The plans: one day's plan per UTC midnight — the plans record's type.
 *
 * @typeParam V - The app's bin values
 * @param values - The app's bin values type
 * @returns `DictType(DateTimeType, Day(V))`
 */
export function AllocationDaysTypeFor<V extends EastType>(values: V): AllocationDaysType<V> {
    return DictType(DateTimeType, AllocationDayTypeFor(values)) as unknown as AllocationDaysType<V>;
}

// ============================================================================
// Events and resources
// ============================================================================

/**
 * A span of time, `[from, to)`.
 *
 * @property from - Its start
 * @property to - Its end
 */
export const AllocationIntervalType = StructType({ from: DateTimeType, to: DateTimeType });

/** Type representing {@link AllocationIntervalType}. */
export type AllocationIntervalType = typeof AllocationIntervalType;

/**
 * Other work on a resource: a job covering the plan day's start makes it busy
 * until the job ends; one starting later is its next job.
 *
 * @property label - Its name (`C-3142`)
 * @property start - When it starts
 * @property end - When it ends, and the resource is released
 */
export const AllocationJobType = StructType({ label: StringType, start: DateTimeType, end: DateTimeType });

/** Type representing {@link AllocationJobType}. */
export type AllocationJobType = typeof AllocationJobType;

/**
 * One line of an event's details, shown read-only in a bin's inspector.
 *
 * @property label - Its label (`Settings`)
 * @property value - Its text
 */
export const AllocationDetailType = StructType({ label: StringType, value: StringType });

/** Type representing {@link AllocationDetailType}. */
export type AllocationDetailType = typeof AllocationDetailType;

/**
 * An event the day may book, resolved from the app's rows.
 *
 * @property key - Its key in the app's rows, what a bin's `event` names
 * @property label - Its code on cards, chips and lists (`LD-2231`)
 * @property meta - Its second line (`BRK · R2 · spec MC12`)
 * @property quantity - Its quantity, booked whole unless split
 * @property hold - How long a resource holds a bin of it
 * @property kind - What it goes with: a resource holding the same kind ranks higher in `Allocation.fit`
 * @property due - When it is due; overdue before the plan day
 * @property window - Its ready window
 * @property details - Read-only lines in a bin's inspector
 */
export const AllocationEventType = StructType({
    key: StringType, label: StringType, meta: OptionType(StringType), quantity: FloatType, hold: TimeStepType, kind: OptionType(StringType),
    due: OptionType(DateTimeType), window: OptionType(AllocationIntervalType), details: ArrayType(AllocationDetailType),
});

/** Type representing {@link AllocationEventType}. */
export type AllocationEventType = typeof AllocationEventType;

/**
 * A resource bins are allocated to, resolved from the app's rows.
 *
 * @property key - Its key in the app's rows, what a bin's `parts` name
 * @property label - Its name (`K-203`)
 * @property group - Its group (`Hall B`)
 * @property meta - Its free line (`Hall B · 40 m³`)
 * @property note - A line about its next job, after the inspector's next fill
 * @property min - Its minimum, in the quantity's unit
 * @property max - Its maximum
 * @property hold - How long a reservation on it is checked for, and how long it is held when it holds only reservations
 * @property jobs - Other work on it
 */
export const AllocationResourceType = StructType({
    key: StringType, label: StringType, group: OptionType(StringType), meta: OptionType(StringType), note: OptionType(StringType),
    min: FloatType, max: FloatType, hold: TimeStepType, jobs: ArrayType(AllocationJobType),
});

/** Type representing {@link AllocationResourceType}. */
export type AllocationResourceType = typeof AllocationResourceType;

/**
 * The built-in rules an app may turn off.
 *
 * @property under - Whether `Allocation.fit` and `Allocation.check` warn under a resource's minimum
 */
export const AllocationRulesType = StructType({ under: BooleanType });

/** Type representing {@link AllocationRulesType}. */
export type AllocationRulesType = typeof AllocationRulesType;

/**
 * Everything a fit and the checks read besides the plan: the board's
 * configuration, every event and every resource — whatever the narrowing hides.
 *
 * @property lanes - The lanes, in order
 * @property every - The slot spacing
 * @property events - Every event, by key
 * @property resources - Every resource, by key
 * @property rules - The built-in rules
 * @property unit - The quantity's unit (`m³`), or empty
 */
export const AllocationContextType = StructType({
    lanes: ArrayType(AllocationLaneType), every: TimeStepType, events: DictType(StringType, AllocationEventType),
    resources: DictType(StringType, AllocationResourceType), rules: AllocationRulesType, unit: StringType,
});

/** Type representing {@link AllocationContextType}. */
export type AllocationContextType = typeof AllocationContextType;

// ============================================================================
// Loads, candidates and fits
// ============================================================================

/**
 * A resource's state on the plan day.
 *
 * @property free - It holds nothing and is not busy
 * @property loading - It holds bins today
 * @property busy - A job covers the day's start
 */
export const AllocationLoadStateType = VariantType({ free: NullType, loading: NullType, busy: NullType });

/** Type representing {@link AllocationLoadStateType}. */
export type AllocationLoadStateType = typeof AllocationLoadStateType;

/**
 * A resource's load on the plan day.
 *
 * @property resource - The resource's key
 * @property fill - What its bins put on it
 * @property bins - How many bins are on it, reservations included
 * @property hold - From the plan day for its longest bin's hold (its own hold when it holds only reservations); `none` with no bins
 * @property state - Free, loading or busy
 */
export const AllocationLoadType = StructType({
    resource: StringType, fill: FloatType, bins: IntegerType, hold: OptionType(AllocationIntervalType), state: AllocationLoadStateType,
});

/** Type representing {@link AllocationLoadType}. */
export type AllocationLoadType = typeof AllocationLoadType;

/**
 * One quantity on one resource, against the drafted plan: what a fit is asked
 * about, one candidate at a time.
 *
 * @property day - The plan day
 * @property bin - The bin it is for; `none` for an event not yet booked and for a new reservation
 * @property reserve - Whether it reserves a slot (a reservation, or a bin with no event): checked with no quantity, and refused when the resource is full
 * @property quantity - What the resource would hold of it
 * @property event - Its event, if it has one
 * @property kind - Its kind
 * @property resource - The resource
 * @property load - The resource's load as the plan stands
 * @property after - What the resource would hold with it: the other bins' parts, and its quantity
 * @property hold - From the plan day for the longer of its hold and the resource's other bins' holds
 * @property spare - The days between the hold's end and the resource's next job; `none` with no next job
 * @property kindMates - Whether a bin of its kind is already on the resource
 * @property otherMates - Whether the resource holds other bins, none of its kind
 * @property rules - The built-in rules
 * @property unit - The quantity's unit
 */
export const AllocationCandidateType = StructType({
    day: DateTimeType, bin: OptionType(StringType), reserve: BooleanType, quantity: FloatType, event: OptionType(AllocationEventType),
    kind: OptionType(StringType), resource: AllocationResourceType, load: AllocationLoadType, after: FloatType, hold: AllocationIntervalType,
    spare: OptionType(FloatType), kindMates: BooleanType, otherMates: BooleanType, rules: AllocationRulesType, unit: StringType,
});

/** Type representing {@link AllocationCandidateType}. */
export type AllocationCandidateType = typeof AllocationCandidateType;

/** Why something does not fit — Schedule's, shared with the Roster. */
export const AllocationRefusalType = ScheduleRefusalType;

/** Type representing {@link AllocationRefusalType}. */
export type AllocationRefusalType = typeof AllocationRefusalType;

/** One verdict of a fit — Schedule's, shared with the Roster. */
export const AllocationFitType = ScheduleFitType;

/** Type representing {@link AllocationFitType}. */
export type AllocationFitType = typeof AllocationFitType;

/**
 * The question a fit answers.
 *
 * @property place - Where can this subject — a bin, or an event — go with this quantity: a verdict per resource
 * @property take - What can this resource take: a verdict per bin, and one for reserving an empty slot on it
 */
export const AllocationFitAskType = VariantType({
    place: StructType({ subject: VariantType({ bin: StringType, event: StringType }), quantity: FloatType }),
    take: StructType({ resource: StringType }),
});

/** Type representing {@link AllocationFitAskType}. */
export type AllocationFitAskType = typeof AllocationFitAskType;

/** A fit's request over the app's values `V` — what {@link AllocationFitRequestTypeFor} constructs. */
export type AllocationFitRequestType<V extends EastType> = StructType<{
    day: DateTimeType; plan: AllocationDayType<V>; ask: AllocationFitAskType; context: AllocationContextType;
}>;

/**
 * One question to the app's fit, about the drafted plan.
 *
 * @typeParam V - The app's bin values
 * @param values - The app's bin values type
 * @returns `StructType({ day, plan, ask, context })`
 *
 * @property day - The plan day
 * @property plan - The day's plan with its drafts
 * @property ask - The question
 * @property context - Every event and resource, and the board's configuration
 */
export function AllocationFitRequestTypeFor<V extends EastType>(values: V): AllocationFitRequestType<V> {
    return StructType({ day: DateTimeType, plan: AllocationDayTypeFor(values), ask: AllocationFitAskType, context: AllocationContextType }) as unknown as AllocationFitRequestType<V>;
}

/**
 * A fit's answer. It echoes its question, so the board matches each answer to
 * the question it asked.
 *
 * @property ask - The question answered
 * @property resources - A place's verdicts, by resource
 * @property bins - A take's verdicts, by bin
 * @property reserve - A take's verdict for reserving an empty slot
 * @property basis - How the fits are ranked, in words (`ranked by load, kind and spare days`)
 */
export const AllocationFitResultType = StructType({
    ask: AllocationFitAskType, resources: DictType(StringType, AllocationFitType), bins: DictType(StringType, AllocationFitType),
    reserve: OptionType(AllocationFitType), basis: StringType,
});

/** Type representing {@link AllocationFitResultType}. */
export type AllocationFitResultType = typeof AllocationFitResultType;

// ============================================================================
// Issues and slots
// ============================================================================

/**
 * An issue's fix.
 *
 * @property choose - Choose a resource for the bin
 * @property move - Open this bin's resource choices (`Move LD-2205…`)
 * @property find - Find a fit for the bin's unallocated quantity
 */
export const AllocationFixType = VariantType({ choose: NullType, move: StringType, find: NullType });

/** Type representing {@link AllocationFixType}. */
export type AllocationFixType = typeof AllocationFixType;

/**
 * What an issue is about.
 *
 * @property unlinked - A bin with no resource
 * @property unallocated - A bin whose parts leave some of it unallocated
 * @property over - A resource over its maximum
 * @property under - A resource under its minimum
 * @property overlap - A resource whose hold runs into its next job
 * @property custom - One of the app's, by its group's name (`Spec mismatch`)
 */
export const AllocationIssueKindType = VariantType({
    unlinked: NullType, unallocated: NullType, over: NullType, under: NullType, overlap: NullType, custom: StringType,
});

/** Type representing {@link AllocationIssueKindType}. */
export type AllocationIssueKindType = typeof AllocationIssueKindType;

/**
 * One warning about the drafted plan. Issues never block Save or Publish.
 *
 * @property kind - What it is about
 * @property tone - Its tone; warning and danger issues are counted, neutral and info ones listed only
 * @property title - Its title (`K-207`)
 * @property detail - Its detail (`44 m³ · max 40 · 4 over · over max`)
 * @property bin - The bin it is about, if any
 * @property resource - The resource it is about, if any
 * @property flag - A bin card's short mark (`≠ spec`)
 * @property fix - Its fix
 */
export const AllocationIssueType = StructType({
    kind: AllocationIssueKindType, tone: StatusTokenType, title: StringType, detail: StringType,
    bin: OptionType(StringType), resource: OptionType(StringType), flag: OptionType(StringType), fix: OptionType(AllocationFixType),
});

/** Type representing {@link AllocationIssueType}. */
export type AllocationIssueType = typeof AllocationIssueType;

/** The app's check's input over the app's values `V` — what {@link AllocationCheckContextTypeFor} constructs. */
export type AllocationCheckContextType<V extends EastType> = StructType<{
    day: DateTimeType; plan: AllocationDayType<V>; context: AllocationContextType; loads: DictType<StringType, AllocationLoadType>;
}>;

/**
 * What the app's `check` is given: the drafted plan and every load.
 *
 * @typeParam V - The app's bin values
 * @param values - The app's bin values type
 * @returns `StructType({ day, plan, context, loads })`
 *
 * @property day - The plan day
 * @property plan - The day's plan with its drafts
 * @property context - Every event and resource
 * @property loads - Every resource's load, by key
 */
export function AllocationCheckContextTypeFor<V extends EastType>(values: V): AllocationCheckContextType<V> {
    return StructType({
        day: DateTimeType, plan: AllocationDayTypeFor(values), context: AllocationContextType, loads: DictType(StringType, AllocationLoadType),
    }) as unknown as AllocationCheckContextType<V>;
}

/**
 * A slot's state.
 *
 * @property free - No bin is in it
 * @property booked - A bin with an event is in it
 * @property reserved - Only reservations are in it
 */
export const AllocationSlotStatusType = VariantType({ free: NullType, booked: NullType, reserved: NullType });

/** Type representing {@link AllocationSlotStatusType}. */
export type AllocationSlotStatusType = typeof AllocationSlotStatusType;

/**
 * One lane slot of the plan day: a Table's row, or one per bin of its batch.
 *
 * @property lane - Its lane's key
 * @property at - Its time: the slot's start and its lane's offset
 * @property status - Free, booked or reserved
 * @property bins - Its bins, by time
 */
export const AllocationSlotType = StructType({ lane: StringType, at: DateTimeType, status: AllocationSlotStatusType, bins: ArrayType(StringType) });

/** Type representing {@link AllocationSlotType}. */
export type AllocationSlotType = typeof AllocationSlotType;

/**
 * The board's layout.
 *
 * @property timeline - Lanes, links and resources
 * @property table - One row per slot
 */
export const AllocationLayoutType = VariantType({ timeline: NullType, table: NullType });

/** Type representing {@link AllocationLayoutType}. */
export type AllocationLayoutType = typeof AllocationLayoutType;
