/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's East types (#1371, `Builder Interfaces Spec.md` §6.3). A
 * day is the board's reading of the app's own rows — each bin the app's row,
 * with the roles the board reads from it — carried in the fit's and the
 * check's requests and in the renderer, and stored nowhere: the bins and the
 * days are the app's records. Beside them, the arrivals and resources an app
 * gives the board, and the fit's question and answer.
 *
 * The types over a day take the app's bin row type, `R`: each is a
 * constructor, and the same `R` gives the same East type (`isTypeEqual`), so a
 * row type declared once matches the board's bin kind and the fit's request.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, StringType, StructType,
    VariantType, type EastType,
} from "@elaraai/east";
import { StatusTokenType, TimeStepType } from "@elaraai/east-ui";
import { ScheduleFitType, SchedulePeriodStatusType, ScheduleRefusalType } from "../schedule/types.js";

// ============================================================================
// The day, as the board reads it
// ============================================================================

/**
 * A lane: it takes one bin each `every` (an hour by default), at its offset
 * past it.
 *
 * @property key - Its key, what a bin's lane names: its row's key in the lanes' resource kind
 * @property label - Its name (`B-1`)
 * @property offset - How far past each slot's start its bins are booked (`minutes 15`)
 */
export const AllocationLaneType = StructType({ key: StringType, label: StringType, offset: TimeStepType });

/** Type representing {@link AllocationLaneType}. */
export type AllocationLaneType = typeof AllocationLaneType;

/**
 * A day's status: Schedule's period status, read from the app's days record
 * (`Schedule.periods`).
 *
 * @property draft - An editable day
 * @property published - A read-only day, and when it was published when the app's published case holds the time
 * @property other - Another case of the app's status, by its name: read-only
 */
export const AllocationStatusType = SchedulePeriodStatusType;

/** Type representing {@link AllocationStatusType}. */
export type AllocationStatusType = typeof AllocationStatusType;

/** The fields of a {@link AllocationBinType}, over the app's bin row type `R`. */
export type AllocationBinFields<R extends EastType> = {
    lane: StringType; at: DateTimeType; arrival: OptionType<StringType>; quantity: FloatType; kind: OptionType<StringType>;
    hold: typeof TimeStepType; parts: DictType<StringType, FloatType>; row: R;
};

/** A bin over the app's bin row type `R` — what {@link AllocationBinTypeFor} constructs. */
export type AllocationBinType<R extends EastType> = StructType<AllocationBinFields<R>>;

/**
 * One bin, as the board reads it from the app's row (`R`): its roles — one
 * booking in a lane slot, and the quantity it puts on each resource — beside
 * the row itself, every field of it.
 *
 * @remarks
 * Composed from the bin kind's roles (its `rows` and `read`) and the row. A
 * bin keeps what it was booked with — its kind and its hold come from its
 * arrival when it is booked, as its row's other fields do, and stay with it
 * when it moves — so a bin can differ from its arrival, as a delivery measured
 * on arrival does. A reservation books no arrival, and holds no quantity, no
 * kind and no hold.
 *
 * @typeParam R - The app's bin row type
 * @param row - The app's bin row type
 * @returns `StructType({ lane, at, arrival, quantity, kind, hold, parts, row })`
 *
 * @property lane - Its lane's key
 * @property at - Its time; a batch's bins follow one minute apart
 * @property arrival - The arrival it books, by key; `none` for a reservation
 * @property quantity - Its quantity; 0 for a reservation
 * @property kind - What it goes with on a resource (its arrival's kind when booked); `none` for a kind with no `kind` role
 * @property hold - How long a resource holds it from the plan day (its arrival's hold when booked)
 * @property parts - The quantity on each resource, by key; empty while it is not linked
 * @property row - The app's row, every field of it
 */
export function AllocationBinTypeFor<R extends EastType>(row: R): AllocationBinType<R> {
    return StructType({
        lane: StringType, at: DateTimeType, arrival: OptionType(StringType), quantity: FloatType, kind: OptionType(StringType),
        hold: TimeStepType, parts: DictType(StringType, FloatType), row,
    }) as unknown as AllocationBinType<R>;
}

/** A day over the app's bin row type `R` — what {@link AllocationDayTypeFor} constructs. */
export type AllocationDayType<R extends EastType> = StructType<{ status: AllocationStatusType; bins: DictType<StringType, AllocationBinType<R>> }>;

/**
 * One day of the app's bins, as the board reads them: its period's status and
 * its bins, the drafts in place.
 *
 * @typeParam R - The app's bin row type
 * @param row - The app's bin row type
 * @returns `StructType({ status, bins })`
 *
 * @property status - The day's status, from the app's days record; a draft with no `periods`, or no row for the day
 * @property bins - The bins whose `at` falls in the day, by their keys
 */
export function AllocationDayTypeFor<R extends EastType>(row: R): AllocationDayType<R> {
    return StructType({ status: AllocationStatusType, bins: DictType(StringType, AllocationBinTypeFor(row)) }) as unknown as AllocationDayType<R>;
}

// ============================================================================
// Arrivals and resources
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
 * One line of an arrival's details, shown read-only in a bin's inspector.
 *
 * @property label - Its label (`Settings`)
 * @property value - Its text
 */
export const AllocationDetailType = StructType({ label: StringType, value: StringType });

/** Type representing {@link AllocationDetailType}. */
export type AllocationDetailType = typeof AllocationDetailType;

/**
 * What the board books from: an arrival, resolved from the app's rows
 * (`Allocation.arrivals`).
 *
 * @property key - Its key in the app's rows, what a bin's `arrival` names
 * @property label - Its code on cards, chips and lists (`LD-2231`)
 * @property meta - Its second line (`BRK · R2 · spec MC12`)
 * @property quantity - Its quantity, booked whole unless split
 * @property hold - How long a resource holds a bin of it
 * @property kind - What it goes with: a resource holding the same kind ranks higher in `Allocation.fit`
 * @property due - When it is due; overdue before the plan day
 * @property window - Its ready window
 * @property details - Read-only lines in a bin's inspector
 */
export const AllocationArrivalType = StructType({
    key: StringType, label: StringType, meta: OptionType(StringType), quantity: FloatType, hold: TimeStepType, kind: OptionType(StringType),
    due: OptionType(DateTimeType), window: OptionType(AllocationIntervalType), details: ArrayType(AllocationDetailType),
});

/** Type representing {@link AllocationArrivalType}. */
export type AllocationArrivalType = typeof AllocationArrivalType;

/**
 * A resource bins are allocated to, resolved from the app's rows through its
 * resource kind's accessors (`Schedule.resources`).
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
 * Everything a fit and the checks read besides the day: the board's
 * configuration, every arrival and every resource — whatever the narrowing
 * hides.
 *
 * @property lanes - The lanes, in order
 * @property every - The slot spacing
 * @property arrivals - Every arrival, by key
 * @property resources - Every resource, by key
 * @property rules - The built-in rules
 * @property unit - The quantity's unit (`m³`), or empty
 */
export const AllocationContextType = StructType({
    lanes: ArrayType(AllocationLaneType), every: TimeStepType, arrivals: DictType(StringType, AllocationArrivalType),
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
 * A resource's line on the plan day, as its row and its bins' cards show it
 * (A16, A19).
 *
 * @property text - Its line: the load it holds (`11 m³ · max 9 · 2 over`, `reserved · takes 26–48`, with `· 1 d into next job`), `busy until Fri 14`, or what it is and takes when free (`Hall B · 40 m³ · takes 20–40 m³`)
 * @property tone - `danger` over its maximum, `warning` overlapping its next job or under its minimum, else `neutral`
 * @property over - Whether it holds more than its maximum
 * @property under - Whether it holds something, but less than its minimum
 * @property overlap - Whether its hold runs into its next job
 * @property next - Its next job: where an overlap starts
 */
export const AllocationResourceLineType = StructType({
    text: StringType, tone: StatusTokenType, over: BooleanType, under: BooleanType, overlap: BooleanType, next: OptionType(AllocationJobType),
});

/** Type representing {@link AllocationResourceLineType}. */
export type AllocationResourceLineType = typeof AllocationResourceLineType;

/**
 * One quantity on one resource, against the drafted day: what a fit is asked
 * about, one candidate at a time.
 *
 * @property day - The plan day
 * @property bin - The bin it is for; `none` for an arrival not yet booked and for a new reservation
 * @property reserve - Whether it reserves a slot (a reservation, or a bin booking no arrival): checked with no quantity, and refused when the resource is full
 * @property quantity - What the resource would hold of it
 * @property arrival - Its arrival, if it has one
 * @property kind - Its kind
 * @property resource - The resource
 * @property load - The resource's load as the day stands
 * @property after - What the resource would hold with it: the other bins' parts, and its quantity
 * @property hold - From the plan day for the longer of its hold and the resource's other bins' holds
 * @property spare - The days between the hold's end and the resource's next job; `none` with no next job
 * @property kindMates - Whether a bin of its kind is already on the resource
 * @property otherMates - Whether the resource holds other bins, none of its kind
 * @property rules - The built-in rules
 * @property unit - The quantity's unit
 */
export const AllocationCandidateType = StructType({
    day: DateTimeType, bin: OptionType(StringType), reserve: BooleanType, quantity: FloatType, arrival: OptionType(AllocationArrivalType),
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
 * @property place - Where can this subject — a bin, or an arrival — go with this quantity: a verdict per resource
 * @property take - What can this resource take: a verdict per bin, one per arrival the day has not booked, and one for reserving an empty slot on it
 */
export const AllocationFitAskType = VariantType({
    place: StructType({ subject: VariantType({ bin: StringType, arrival: StringType }), quantity: FloatType }),
    take: StructType({ resource: StringType }),
});

/** Type representing {@link AllocationFitAskType}. */
export type AllocationFitAskType = typeof AllocationFitAskType;

/** A fit's request over the app's bin row type `R` — what {@link AllocationFitRequestTypeFor} constructs. */
export type AllocationFitRequestType<R extends EastType> = StructType<{
    day: DateTimeType; plan: AllocationDayType<R>; ask: AllocationFitAskType; context: AllocationContextType;
}>;

/**
 * One question to the app's fit, about the drafted day.
 *
 * @typeParam R - The app's bin row type
 * @param row - The app's bin row type
 * @returns `StructType({ day, plan, ask, context })`
 *
 * @property day - The plan day
 * @property plan - The day as drafted: each bin its roles and its own row
 * @property ask - The question
 * @property context - Every arrival and resource, and the board's configuration
 */
export function AllocationFitRequestTypeFor<R extends EastType>(row: R): AllocationFitRequestType<R> {
    return StructType({ day: DateTimeType, plan: AllocationDayTypeFor(row), ask: AllocationFitAskType, context: AllocationContextType }) as unknown as AllocationFitRequestType<R>;
}

/**
 * A fit's answer. It echoes its question, so the board matches each answer to
 * the question it asked.
 *
 * @property ask - The question answered
 * @property resources - A place's verdicts, by resource
 * @property bins - A take's verdicts, by bin
 * @property arrivals - A take's verdicts for booking each arrival the day has not booked onto the resource, by arrival (the Table's arrival Chooser, a reservation's Book list)
 * @property reserve - A take's verdict for reserving an empty slot
 * @property basis - How the fits are ranked, in words (`ranked by load, kind and spare days`)
 */
export const AllocationFitResultType = StructType({
    ask: AllocationFitAskType, resources: DictType(StringType, AllocationFitType), bins: DictType(StringType, AllocationFitType),
    arrivals: DictType(StringType, AllocationFitType), reserve: OptionType(AllocationFitType), basis: StringType,
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
 * One warning about the drafted day. Issues never block Save or Publish.
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

/** The app's check's input over the app's bin row type `R` — what {@link AllocationCheckContextTypeFor} constructs. */
export type AllocationCheckContextType<R extends EastType> = StructType<{
    day: DateTimeType; plan: AllocationDayType<R>; context: AllocationContextType; loads: DictType<StringType, AllocationLoadType>;
}>;

/**
 * What the app's `check` is given: the drafted day and every load.
 *
 * @typeParam R - The app's bin row type
 * @param row - The app's bin row type
 * @returns `StructType({ day, plan, context, loads })`
 *
 * @property day - The plan day
 * @property plan - The day as drafted: each bin its roles and its own row, which the app's check reads
 * @property context - Every arrival and resource
 * @property loads - Every resource's load, by key
 */
export function AllocationCheckContextTypeFor<R extends EastType>(row: R): AllocationCheckContextType<R> {
    return StructType({
        day: DateTimeType, plan: AllocationDayTypeFor(row), context: AllocationContextType, loads: DictType(StringType, AllocationLoadType),
    }) as unknown as AllocationCheckContextType<R>;
}

/**
 * A slot's state.
 *
 * @property free - No bin is in it
 * @property booked - A bin booking an arrival is in it
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

// ============================================================================
// The optimiser's request and answer (#1409)
// ============================================================================

/** The optimiser's request over the app's bin row type `R` — what {@link AllocationOptimiseRequestTypeFor} constructs. */
export type AllocationOptimiseRequestType<R extends EastType> = StructType<{
    day: DateTimeType; run: IntegerType; bins: DictType<StringType, R>; arrivals: ArrayType<AllocationArrivalType>; context: AllocationContextType;
}>;

/**
 * One request to the app's optimiser (#1409, `Optimise Spec.md` §5.1): the day
 * in view and its bins, as drafted, for the optimiser to book and allocate —
 * the Elara eye's one call.
 *
 * @typeParam R - The app's bin row type
 * @param row - The app's bin row type
 * @returns `StructType({ day, run, bins, arrivals, context })`
 *
 * @property day - The plan day
 * @property run - The run's number, from 1 per board per browser
 * @property bins - The day's bins by key, the app's own rows as the session holds them: the base with every unapplied draft in place, every row whatever the rail shows
 * @property arrivals - Every arrival, as the board reads them
 * @property context - The board's configuration, every arrival and every resource
 */
export function AllocationOptimiseRequestTypeFor<R extends EastType>(row: R): AllocationOptimiseRequestType<R> {
    return StructType({
        day: DateTimeType, run: IntegerType, bins: DictType(StringType, row), arrivals: ArrayType(AllocationArrivalType), context: AllocationContextType,
    }) as unknown as AllocationOptimiseRequestType<R>;
}

/** The optimiser's answer over the app's bin row type `R` — what {@link AllocationOptimiseResultTypeFor} constructs. */
export type AllocationOptimiseResultType<R extends EastType> = StructType<{ bins: DictType<StringType, R> }>;

/**
 * The app's optimiser's answer (#1409): the day's bins, complete, by key. The
 * board diffs it against the request by key — a key the request did not hold
 * is a bin added, one it held with another row a bin changed, one missing a
 * bin removed — and records the diff as one step of its history.
 *
 * @typeParam R - The app's bin row type
 * @param row - The app's bin row type
 * @returns `StructType({ bins })`
 *
 * @property bins - The day's bins by key, complete; a new bin's key the optimiser's own
 */
export function AllocationOptimiseResultTypeFor<R extends EastType>(row: R): AllocationOptimiseResultType<R> {
    return StructType({ bins: DictType(StringType, row) }) as unknown as AllocationOptimiseResultType<R>;
}
