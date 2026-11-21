/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's East types (#1371, `Builder Interfaces Spec.md` §6.3). A
 * day is the board's reading of the app's own rows — each bin the app's row,
 * with the roles the board reads from it — carried in the check's request and
 * in the renderer, and stored nowhere: the bins and the days are the app's
 * records. Beside them, the arrivals and resources an app gives the board, and
 * the fit's question and answer, neither of which carries a row
 * (east-workspace#1624).
 *
 * The types over a day take the app's bin row type, `R`: each is a
 * constructor, and the same `R` gives the same East type (`isTypeEqual`), so a
 * row type declared once matches the board's bin kind and the check's request.
 * The fit's take the bins' key type (east-workspace#1709, ruling 12): a fit
 * names a bin by its key at the bins' record's own key type, String where
 * none is given.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, PatchType, StringType, StructType,
    VariantType, type EastType, type PatchTypeOf,
} from "@elaraai/east";
import { StatusTokenType, TimeStepType } from "@elaraai/east-ui";
import { ScheduleAllocationRolesType, ScheduleFitType, SchedulePeriodStatusType, ScheduleRefusalType } from "../schedule/types.js";
import { OptimiseSliceType, optimisedRecordType, optionKeyType } from "../utils/optimise.js";

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
 * What the fit's types and its ready-made parts are made over (east-workspace#1709, ruling 12): the bins' record's key
 * type, which they name a bin by.
 *
 * @typeParam K - The bins' key type
 * @property key - The bins' key type — `IntegerType` for bins keyed by number; omitted, String
 */
export interface AllocationFitOptions<K extends EastType = StringType> {
    readonly key?: K;
}

/**
 * The bins' key type a fit's type or part is made over, from its options.
 *
 * @param options - The options the app gave, if any
 * @param where - The constructor, as its refusal names it
 * @returns The key type; String where none is given
 * @throws {Error} When the options are no `{ key }`, or `key` is no East type, naming the constructor
 * @internal
 */
export function allocationFitKey(options: unknown, where: string): EastType {
    return optionKeyType(options, where, "bins", "{ key: IntegerType }");
}

/**
 * Type representing {@link AllocationCandidateTypeFor}: one candidate, its bin by a key of type `K`.
 *
 * @typeParam K - The bins' key type
 */
export type AllocationCandidateType<K extends EastType = StringType> = StructType<{
    day: DateTimeType; bin: OptionType<K>; reserve: BooleanType; quantity: FloatType; arrival: OptionType<AllocationArrivalType>;
    kind: OptionType<StringType>; resource: AllocationResourceType; load: AllocationLoadType; after: FloatType; hold: AllocationIntervalType;
    spare: OptionType<FloatType>; kindMates: BooleanType; otherMates: BooleanType; rules: AllocationRulesType; unit: StringType;
}>;

/**
 * One quantity on one resource, against the drafted day: what a fit is asked
 * about, one candidate at a time — its bin by its key at the bins' own key type
 * (ruling 12).
 *
 * @typeParam K - The bins' key type
 * @param options - The bins' key type, `key`, where they are keyed by other than String: `{ key: IntegerType }`
 * @returns `StructType({ day, bin, reserve, quantity, arrival, kind, resource, load, after, hold, spare, kindMates, otherMates, rules, unit })`
 * @throws {Error} When the options are no `{ key }`, or `key` is no East type
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
export function AllocationCandidateTypeFor<K extends EastType = StringType>(options?: AllocationFitOptions<K>): AllocationCandidateType<K> {
    const key = allocationFitKey(options, "Allocation.Types.Candidate");
    return StructType({
        day: DateTimeType, bin: OptionType(key), reserve: BooleanType, quantity: FloatType, arrival: OptionType(AllocationArrivalType),
        kind: OptionType(StringType), resource: AllocationResourceType, load: AllocationLoadType, after: FloatType, hold: AllocationIntervalType,
        spare: OptionType(FloatType), kindMates: BooleanType, otherMates: BooleanType, rules: AllocationRulesType, unit: StringType,
    }) as unknown as AllocationCandidateType<K>;
}

/** A candidate over bins keyed by String: the board's own, over the ids it names its bins by. @internal */
export const AllocationCandidateType = AllocationCandidateTypeFor();

/** Why something does not fit — Schedule's, shared with the Roster. */
export const AllocationRefusalType = ScheduleRefusalType;

/** Type representing {@link AllocationRefusalType}. */
export type AllocationRefusalType = typeof AllocationRefusalType;

/** One verdict of a fit — Schedule's, shared with the Roster. */
export const AllocationFitType = ScheduleFitType;

/** Type representing {@link AllocationFitType}. */
export type AllocationFitType = typeof AllocationFitType;

/**
 * Type representing {@link AllocationFitAskTypeFor}: a fit's question, a bin by a key of type `K`.
 *
 * @typeParam K - The bins' key type
 */
export type AllocationFitAskType<K extends EastType = StringType> = VariantType<{
    place: StructType<{ subject: VariantType<{ bin: K; arrival: StringType }>; quantity: FloatType }>;
    take: StructType<{ resource: StringType }>;
}>;

/**
 * The question a fit answers — a bin by its key at the bins' own key type (ruling 12).
 *
 * @typeParam K - The bins' key type
 * @param options - The bins' key type, `key`, where they are keyed by other than String: `{ key: IntegerType }`
 * @returns `VariantType({ place, take })`
 * @throws {Error} When the options are no `{ key }`, or `key` is no East type
 *
 * @property place - Where can this subject — a bin, or an arrival — go with this quantity: a verdict per resource
 * @property take - What can this resource take: a verdict per bin, one per arrival the day has not booked, and one for reserving an empty slot on it
 */
export function AllocationFitAskTypeFor<K extends EastType = StringType>(options?: AllocationFitOptions<K>): AllocationFitAskType<K> {
    const key = allocationFitKey(options, "Allocation.Types.FitAsk");
    return VariantType({
        place: StructType({ subject: VariantType({ bin: key, arrival: StringType }), quantity: FloatType }),
        take: StructType({ resource: StringType }),
    }) as unknown as AllocationFitAskType<K>;
}

/** A question over bins keyed by String: the board's own, over the ids it names its bins by. @internal */
export const AllocationFitAskType = AllocationFitAskTypeFor();

/**
 * Type representing {@link AllocationFitRequestTypeFor}: a fit's request, its question's bin by a key of type `K`.
 *
 * @typeParam K - The bins' key type
 */
export type AllocationFitRequestType<K extends EastType = StringType> = StructType<{ day: DateTimeType; ask: AllocationFitAskType<K>; scope: OptimiseSliceType }>;

/**
 * One question to the app's fit (east-workspace#1624): the plan day, the
 * question about it, and the page's scope. It carries no row: the call carries
 * the board's unsaved edits as drafts, and the function reads what it needs
 * from the workspace with them laid over — the day's bins through the bins'
 * record's index, and the arrivals and the resources from the app's own
 * records. A bin it names it names by its key at the bins' own key type
 * (ruling 12): `Allocation.Types.FitRequest({ key: IntegerType })` over bins
 * keyed by number.
 *
 * @typeParam K - The bins' key type
 * @param options - The bins' key type, `key`, where they are keyed by other than String: `{ key: IntegerType }`
 * @returns `StructType({ day, ask, scope })`
 * @throws {Error} When the options are no `{ key }`, or `key` is no East type
 *
 * @property day - The plan day
 * @property ask - The question
 * @property scope - Each rail source's scope by the source's name (#1621): the narrowing the page holds and the viewer
 *   cannot clear, typed as an optimiser's `slice` is, each field its exact values as East prints them; empty for a page
 *   with no scope. The rail's own choices are never sent: a fit answers whatever the rail shows
 */
export function AllocationFitRequestTypeFor<K extends EastType = StringType>(options?: AllocationFitOptions<K>): AllocationFitRequestType<K> {
    const key = allocationFitKey(options, "Allocation.Types.FitRequest");
    return StructType({ day: DateTimeType, ask: AllocationFitAskTypeFor({ key }), scope: OptimiseSliceType }) as unknown as AllocationFitRequestType<K>;
}

/** A request over bins keyed by String: the board's own, over the ids it names its bins by. @internal */
export const AllocationFitRequestType = AllocationFitRequestTypeFor();

/**
 * Type representing {@link AllocationFitContextTypeFor}: what a fit's function read, its bins by keys of type `K`.
 *
 * @typeParam K - The bins' key type
 */
export type AllocationFitContextType<K extends EastType = StringType> = StructType<{
    bins: DictType<K, typeof ScheduleAllocationRolesType>; arrivals: DictType<StringType, AllocationArrivalType>;
    resources: DictType<StringType, AllocationResourceType>; rules: AllocationRulesType; unit: StringType;
}>;

/**
 * What a fit's function read (east-workspace#1624): what `Allocation.candidates()`,
 * `Allocation.answer()` and `Allocation.lookahead()` answer from, which the
 * function makes of the app's own records, in the board's types — its bins by
 * their keys at the bins' own key type (ruling 12).
 *
 * @typeParam K - The bins' key type
 * @param options - The bins' key type, `key`, where they are keyed by other than String: `{ key: IntegerType }`
 * @returns `StructType({ bins, arrivals, resources, rules, unit })`
 * @throws {Error} When the options are no `{ key }`, or `key` is no East type
 *
 * @property bins - The day's bins by key, each its roles: those the function read of the plan day, the board's unsaved
 *   edits among them
 * @property arrivals - The arrivals by key: every one a place may be asked of, and a take may book
 * @property resources - The resources by key: every one a verdict is given for
 * @property rules - The built-in rules
 * @property unit - The quantity's unit (`m³`), or empty
 */
export function AllocationFitContextTypeFor<K extends EastType = StringType>(options?: AllocationFitOptions<K>): AllocationFitContextType<K> {
    const key = allocationFitKey(options, "Allocation.Types.FitContext");
    return StructType({
        bins: DictType(key, ScheduleAllocationRolesType), arrivals: DictType(StringType, AllocationArrivalType),
        resources: DictType(StringType, AllocationResourceType), rules: AllocationRulesType, unit: StringType,
    }) as unknown as AllocationFitContextType<K>;
}

/** What a fit's function read, over bins keyed by String: the board's own, over the ids it names its bins by. @internal */
export const AllocationFitContextType = AllocationFitContextTypeFor();

/**
 * Type representing {@link AllocationFitResultTypeFor}: a fit's answer, its bins by keys of type `K`.
 *
 * @typeParam K - The bins' key type
 */
export type AllocationFitResultType<K extends EastType = StringType> = StructType<{
    ask: AllocationFitAskType<K>; resources: DictType<StringType, AllocationFitType>; bins: DictType<K, AllocationFitType>;
    arrivals: DictType<StringType, AllocationFitType>; reserve: OptionType<AllocationFitType>; basis: StringType;
}>;

/**
 * A fit's answer. It echoes its question, so the board matches each answer to
 * the question it asked; a bin it names it names by its key at the bins' own key
 * type (ruling 12).
 *
 * @typeParam K - The bins' key type
 * @param options - The bins' key type, `key`, where they are keyed by other than String: `{ key: IntegerType }`
 * @returns `StructType({ ask, resources, bins, arrivals, reserve, basis })`
 * @throws {Error} When the options are no `{ key }`, or `key` is no East type
 *
 * @property ask - The question answered
 * @property resources - A place's verdicts, by resource: one for each resource the function considered (east-workspace#1624)
 * @property bins - A take's verdicts, by bin
 * @property arrivals - A take's verdicts for booking each arrival the day has not booked onto the resource, by arrival (the Table's arrival Chooser, a reservation's Book list)
 * @property reserve - A take's verdict for reserving an empty slot
 * @property basis - How the fits are ranked, in words (`ranked by load, kind and spare days`)
 */
export function AllocationFitResultTypeFor<K extends EastType = StringType>(options?: AllocationFitOptions<K>): AllocationFitResultType<K> {
    const key = allocationFitKey(options, "Allocation.Types.FitResult");
    return StructType({
        ask: AllocationFitAskTypeFor({ key }), resources: DictType(StringType, AllocationFitType), bins: DictType(key, AllocationFitType),
        arrivals: DictType(StringType, AllocationFitType), reserve: OptionType(AllocationFitType), basis: StringType,
    }) as unknown as AllocationFitResultType<K>;
}

/** An answer over bins keyed by String: the board's own, over the ids it names its bins by. @internal */
export const AllocationFitResultType = AllocationFitResultTypeFor();

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

/** The app's check's input over its bin row type `R` and a reference record's row type `P` (#1551) — what {@link AllocationCheckContextTypeFor} constructs given `P`. */
export type AllocationReferenceCheckContextType<R extends EastType, P extends EastType> = StructType<{
    day: DateTimeType; plan: AllocationDayType<R>; context: AllocationContextType; loads: DictType<StringType, AllocationLoadType>;
    reference: DictType<StringType, P>;
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
export function AllocationCheckContextTypeFor<R extends EastType>(row: R): AllocationCheckContextType<R>;
/**
 * What the app's `check` is given over a reference record of the app's
 * (#1551) — a delivery schedule its bookings carry out — read through the
 * slice's `reference` source, which the board windows as it does its bins: the
 * drafted day, every load, and the record's rows in the day.
 *
 * @typeParam R - The app's bin row type
 * @typeParam P - The reference record's row type
 * @param row - The app's bin row type
 * @param reference - The reference record's row type
 * @returns `StructType({ day, plan, context, loads, reference })`
 *
 * @property day - The plan day
 * @property plan - The day as drafted: each bin its roles and its own row, which the app's check reads
 * @property context - Every arrival and resource
 * @property loads - Every resource's load, by key
 * @property reference - The record's rows overlapping the day, by key: every one, whatever the rail shows, never the record whole
 */
export function AllocationCheckContextTypeFor<R extends EastType, P extends EastType>(row: R, reference: P): AllocationReferenceCheckContextType<R, P>;
export function AllocationCheckContextTypeFor<R extends EastType, P extends EastType>(row: R, reference?: P): AllocationCheckContextType<R> | AllocationReferenceCheckContextType<R, P> {
    const plan = AllocationDayTypeFor(row), loads = DictType(StringType, AllocationLoadType);
    return (reference === undefined
        ? StructType({ day: DateTimeType, plan, context: AllocationContextType, loads })
        : StructType({ day: DateTimeType, plan, context: AllocationContextType, loads, reference: DictType(StringType, reference) })) as unknown as
        AllocationCheckContextType<R> | AllocationReferenceCheckContextType<R, P>;
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
// The optimiser's request and answer (#1409, east-workspace#1622)
// ============================================================================

/**
 * One request to the app's optimiser (#1409, east-workspace#1622): the day in
 * view, the run's number and the rail's narrowing — the Elara eye's one call.
 * It carries no row: the function reads the day's bins through the bins'
 * record's indexes, the board's unsaved edits laid over them, and the arrivals
 * and the resources from the app's own records.
 *
 * @property day - The plan day
 * @property run - The run's number, from 1 per board per browser
 * @property slice - The rail's narrowing: each source's, by the source's name ({@link OptimiseSliceType}), the page's
 *   scope among it; empty for a board with no rail
 */
export const AllocationOptimiseRequestType = StructType({ day: DateTimeType, run: IntegerType, slice: OptimiseSliceType });

/** Type representing {@link AllocationOptimiseRequestType}. */
export type AllocationOptimiseRequestType = typeof AllocationOptimiseRequestType;

/**
 * An optimiser's answer over the bins' record `D` — what
 * {@link AllocationOptimiseResultTypeFor} constructs.
 *
 * @typeParam D - The bins' record type
 */
export type AllocationOptimiseResultType<D extends DictType<EastType, EastType> = DictType<EastType, EastType>> = StructType<{ bins: PatchTypeOf<D> }>;

/**
 * The app's optimiser's answer (#1409, east-workspace#1622): a patch of the
 * bins' record — for each key, a bin inserted, deleted, or updated by a patch
 * of its row. It is what `East.diff` gives of the bins before and after, and
 * what a Save sends.
 *
 * @typeParam D - The bins' record type
 * @param bins - The bins' record type, `DictType(K, Bin)` at the bins' own key type
 * @returns `StructType({ bins })`
 * @throws {Error} When given a type that is no Dict of bins by key
 *
 * @property bins - The bins' patch; a new bin's key is the optimiser's own
 */
export function AllocationOptimiseResultTypeFor<D extends DictType<EastType, EastType>>(bins: D): AllocationOptimiseResultType<D> {
    const record = optimisedRecordType(bins as EastType, (given) =>
        `Allocation.Types.OptimiseResult: is given ${given} — it takes the bins' record type, a Dict of bins by their key: DictType(StringType, Bin), or DictType(IntegerType, Bin) for bins keyed by number`);
    return StructType({ bins: PatchType(record) }) as unknown as AllocationOptimiseResultType<D>;
}
