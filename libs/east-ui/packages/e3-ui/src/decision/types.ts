/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The DecisionQueue's East types (#1447, `Decision Queue Spec.md` §5): what
 * its kinds read from the app's rows — a case and its options, each change a
 * tag and a patch as bytes — the verdict it writes, and the closed builds its
 * payload carries. The app's rows cross as beast2 bytes behind East functions
 * the kinds reify over the app's row types, so the payload is one type
 * whatever the app's records hold, as Schedule's kinds are.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, BooleanType, DateTimeType, DictType, FloatType, FunctionType, IntegerType, NullType, OptionType, SetType, StringType,
    StructType, VariantType,
} from "@elaraai/east";
import { ColorTokenType, Format, TimeStepType } from "@elaraai/east-ui";
import { EditingType } from "@elaraai/east-ui/internal";
import { CalendarPagedType } from "../calendar/paged.js";
import { AllocationLabelsType } from "../allocation/index.js";
import * as A from "../allocation/types.js";
import { RosterPayloadType } from "../roster/index.js";
import {
    PlanEventKindType, PlanResourcesType, ScheduleAllocationKindType, ScheduleEntriesType, ScheduleKindType, ScheduleResourcesType,
} from "../schedule/types.js";
import { SheetPayloadType } from "../sheet/sheet.js";
import { RecordSideFields } from "../utils/record-side.js";

// ============================================================================
// What the cases read
// ============================================================================

/**
 * An option's change, as the queue reads it from the app's variant: its tag,
 * the kind of decision, and its value, a patch of the record that tag's
 * target changes, as beast2 bytes at the patch's type.
 *
 * @property tag - The variant's case: which target draws it, and what Apply writes it through
 * @property patch - The patch, as bytes at `PatchType(DictType(K, R))`, `DictType(K, R)` the target's record
 */
export const DecisionChangeType = StructType({ tag: StringType, patch: BlobType });

/** Type representing {@link DecisionChangeType}. */
export type DecisionChangeType = typeof DecisionChangeType;

/**
 * One way to decide a case, as its roles read it (§5.1): the option's own
 * words, what it is worth, and its change.
 *
 * @property key - Its key among the case's options; `none` for a case that is its own one proposal (D15)
 * @property label - Its row in Options; its key when the app maps no `label`
 * @property title - The card's title, when it is the option shown; a receipt's words
 * @property summary - The line beside Proposed / Modified
 * @property detail - The sentence under Change
 * @property note - Its line in Options (`lands at 38 h of 38`)
 * @property value - The value line, its figure in Options and its share of the section's total
 * @property confidence - The model's confidence in it, 0 to 1; `none` reads `no data`
 * @property question - A question only a person can answer, which gates Apply
 * @property warn - The warning box's words
 * @property refused - Why it is refused: off in Options, its reason on its line
 * @property knockOn - The keys of the target's rows moved because of the change, not by it (P16)
 * @property guesses - The changed rows the model is unsure of, by key, and its confidence in each (P26)
 * @property change - Its change: the tag and its patch
 * @property row - The option's own row as bytes, for a projection's target, which reads its series from it; `none` when
 *   no target reads it
 */
export const DecisionOptionType = StructType({
    key: OptionType(StringType),
    label: StringType,
    title: StringType,
    summary: StringType,
    detail: StringType,
    note: OptionType(StringType),
    value: FloatType,
    confidence: OptionType(FloatType),
    question: OptionType(StringType),
    warn: OptionType(StringType),
    refused: OptionType(StringType),
    knockOn: SetType(StringType),
    guesses: DictType(StringType, FloatType),
    change: DecisionChangeType,
    row: OptionType(BlobType),
});

/** Type representing {@link DecisionOptionType}. */
export type DecisionOptionType = typeof DecisionOptionType;

/**
 * A case a model leaves to a person, as its roles read it (§5.1).
 *
 * @property key - Its key in the cases' record: the key its verdict is written under
 * @property scope - The eyebrow after where it lands (`Inbound · W10`)
 * @property due - When it is due, which places it in a section; `none` for no deadline
 * @property routine - Whether it belongs to the Routine band
 * @property unit - The value's word (`saved / wk`)
 * @property format - How its values print (east-ui's `Format`); `none` prints plain numbers
 * @property ifWrong - What it costs if the recommendation is wrong; `none` reads `no data`
 * @property model - Why's line (`rota-opt · run #204`)
 * @property why - Why's paragraph
 * @property recommended - The key of the option the card opens on; `none` for a case that is its own one proposal
 * @property options - Its options, in their key order; one, keyed `none`, for a case that is its own one proposal
 */
export const DecisionCaseType = StructType({
    key: StringType,
    scope: StringType,
    due: OptionType(DateTimeType),
    routine: BooleanType,
    unit: StringType,
    format: OptionType(Format.Types.Tick),
    ifWrong: OptionType(FloatType),
    model: StringType,
    why: StringType,
    recommended: OptionType(StringType),
    options: ArrayType(DecisionOptionType),
});

/** Type representing {@link DecisionCaseType}. */
export type DecisionCaseType = typeof DecisionCaseType;

/**
 * The cases, as a read gives them: every one, or — past the cap — how many
 * there are, and none read (§12).
 *
 * @property cases - The cases, in their key order
 * @property tooMany - How many cases the source holds, past the cap: the banner names the count, and nothing is read
 */
export const DecisionCasesType = VariantType({ cases: ArrayType(DecisionCaseType), tooMany: IntegerType });

/** Type representing {@link DecisionCasesType}. */
export type DecisionCasesType = typeof DecisionCasesType;

/**
 * The cases' kind, closed (§5.4): the cases read through their roles.
 *
 * @property read - The cases: the record read whole, or the slice's `decisions` source read complete; `none` while a
 *   read is in flight
 */
export const DecisionsKindType = StructType({ read: FunctionType([], OptionType(DecisionCasesType)) });

/** Type representing {@link DecisionsKindType}. */
export type DecisionsKindType = typeof DecisionsKindType;

// ============================================================================
// What the verdicts write
// ============================================================================

/**
 * What a person decided (§5.2).
 *
 * @property applied - The option's change written
 * @property overridden - Another way chosen, the option's change not written
 * @property deferred - Left for later
 * @property handedOff - Given to someone else
 */
export const DecisionVerdictCaseType = VariantType({ applied: NullType, overridden: NullType, deferred: NullType, handedOff: NullType });

/** Type representing {@link DecisionVerdictCaseType}. */
export type DecisionVerdictCaseType = typeof DecisionVerdictCaseType;

/**
 * A person's answer to an option's question.
 *
 * @property yes - Yes
 * @property no - No
 * @property unsure - Not sure
 */
export const DecisionAnswerType = VariantType({ yes: NullType, no: NullType, unsure: NullType });

/** Type representing {@link DecisionAnswerType}. */
export type DecisionAnswerType = typeof DecisionAnswerType;

/**
 * Why a person overrode the recommendation.
 *
 * @property context - They know something the model does not
 * @property data - The model's data is wrong
 * @property priorities - Their priorities differ
 * @property other - Another reason, which the note gives
 */
export const DecisionReasonType = VariantType({ context: NullType, data: NullType, priorities: NullType, other: NullType });

/** Type representing {@link DecisionReasonType}. */
export type DecisionReasonType = typeof DecisionReasonType;

/**
 * A verdict, as the queue writes it into the app's row through the verdicts'
 * roles (§5.2).
 *
 * @property verdict - What was decided
 * @property at - When: written into the verdict's case where the app's case holds `{ at: DateTime }`
 * @property option - The option taken — for an override, the one the person started from; `none` for a case that is its own proposal
 * @property answer - The answer to the option's question
 * @property reason - An override's reason
 * @property note - The case's note
 */
export const DecisionVerdictType = StructType({
    verdict: DecisionVerdictCaseType,
    at: DateTimeType,
    option: OptionType(StringType),
    answer: OptionType(DecisionAnswerType),
    reason: OptionType(DecisionReasonType),
    note: OptionType(StringType),
});

/** Type representing {@link DecisionVerdictType}. */
export type DecisionVerdictType = typeof DecisionVerdictType;

/**
 * The verdicts' kind, closed (§5.2, §5.4): the app's record of verdicts, its
 * session and its read by key, and how a verdict is written into its row.
 *
 * @property editing - The shared session over the verdicts' record, with its patch door: Save writes through it
 * @property entries - The record read by key: a case with a verdict under its key never shows (D1)
 * @property write - The verdict written into a row — the stored one, or a new row of the type's defaults for `none` — the
 *   fields its roles map written and every other field as it was, as bytes
 * @property roles - Which of the verdict's parts the app's row holds: without one the card asks for none of it
 */
export const DecisionVerdictsKindType = StructType({
    editing: EditingType,
    entries: ScheduleEntriesType,
    write: FunctionType([OptionType(BlobType), DecisionVerdictType], BlobType),
    roles: StructType({ option: BooleanType, answer: BooleanType, reason: BooleanType, note: BooleanType }),
});

/** Type representing {@link DecisionVerdictsKindType}. */
export type DecisionVerdictsKindType = typeof DecisionVerdictsKindType;

// ============================================================================
// Where each kind of decision draws
// ============================================================================

/**
 * One zone of a zones target: its key, which a row's `zone` names, its name
 * and its colour token.
 *
 * @property key - Its key
 * @property label - Its name, in the key under the preview
 * @property color - Its fill, a theme colour token
 */
export const DecisionZoneType = StructType({ key: StringType, label: StringType, color: ColorTokenType });

/** Type representing {@link DecisionZoneType}. */
export type DecisionZoneType = typeof DecisionZoneType;

/**
 * A point of a projection's series.
 *
 * @property x - Along the plot
 * @property y - Up the plot
 */
export const DecisionPointType = StructType({ x: FloatType, y: FloatType });

/** Type representing {@link DecisionPointType}. */
export type DecisionPointType = typeof DecisionPointType;

/**
 * Where a target draws, by the builder it draws as (§5.3): each builder's
 * closed kinds and lists as that builder's payload carries them, and a record
 * no builder draws, its zones or a projection as the queue's own.
 *
 * @property roster - The Roster's payload over the duties and their people, its duty kind's slot, and its map: by people, or by cost
 * @property plan - The Plan's event kinds and resource kinds, and the slot of the kind the tags patch
 * @property calendar - The Calendar's event kinds and resource kinds as its payload carries them — a paged resource
 *   kind's resources a window at a time through `paged` — the week's first day, and the slot of the kind the tags patch
 * @property allocation - The Allocation's bin kind, its lanes, resources and arrivals, its slot spacing, the app's check, its rules and its nouns
 * @property sheet - The Sheet's payload over the record, and the queue's own session over it with its read by key — whole
 *   rows, as a record target's side holds them, which Apply drafts a change's rows into: the Sheet's own drafts a field at
 *   a time
 * @property record - A record no builder draws: its side, its rows read whole — `none` for one read by key through
 *   `entries` — its label, its measure and the field it groups by
 * @property zones - Areas on a grid, each in a zone: their side, every area read whole, each one's zone, its place and
 *   whether it is a depot, and the zones
 * @property projection - A series an option gives: its record's side, the points, the limit and how values print
 */
export const DecisionTargetKindType = VariantType({
    roster: StructType({ roster: RosterPayloadType, slot: StringType, map: VariantType({ people: NullType, cost: NullType }) }),
    plan: StructType({ events: ArrayType(PlanEventKindType), resources: ArrayType(PlanResourcesType), event: StringType }),
    calendar: StructType({
        events: ArrayType(ScheduleKindType),
        resources: ArrayType(ScheduleResourcesType),
        paged: OptionType(CalendarPagedType),
        weekStart: VariantType({ monday: NullType, sunday: NullType }),
        event: StringType,
    }),
    allocation: StructType({
        bin: ScheduleAllocationKindType,
        lanes: ArrayType(A.AllocationLaneType),
        resources: ArrayType(A.AllocationResourceType),
        arrivals: OptionType(ArrayType(A.AllocationArrivalType)),
        every: TimeStepType,
        check: OptionType(FunctionType([BlobType], ArrayType(A.AllocationIssueType))),
        rules: A.AllocationRulesType,
        labels: AllocationLabelsType,
    }),
    sheet: StructType({ sheet: SheetPayloadType, editing: EditingType, entries: OptionType(ScheduleEntriesType) }),
    record: StructType({
        ...RecordSideFields,
        rows: OptionType(FunctionType([], OptionType(DictType(StringType, BlobType)))),
        label: OptionType(FunctionType([BlobType, StringType], StringType)),
        measure: OptionType(FunctionType([BlobType, StringType], FloatType)),
        group: OptionType(StructType({ field: StringType, of: FunctionType([BlobType, StringType], StringType) })),
    }),
    zones: StructType({
        ...RecordSideFields,
        rows: FunctionType([], OptionType(DictType(StringType, BlobType))),
        zone: FunctionType([BlobType, StringType], StringType),
        x: FunctionType([BlobType, StringType], FloatType),
        y: FunctionType([BlobType, StringType], FloatType),
        depot: OptionType(FunctionType([BlobType, StringType], BooleanType)),
        zones: ArrayType(DecisionZoneType),
    }),
    projection: StructType({
        ...RecordSideFields,
        points: FunctionType([BlobType], ArrayType(DecisionPointType)),
        limit: OptionType(StructType({ y: FloatType, label: StringType })),
        format: OptionType(Format.Types.Tick),
    }),
});

/** Type representing {@link DecisionTargetKindType}. */
export type DecisionTargetKindType = typeof DecisionTargetKindType;

/**
 * One target, closed (§5.4): the tags it serves, its name and icon, how a
 * change reads against its record, and where it draws.
 *
 * @property tags - The tags of the change role's variant it serves
 * @property name - Its surface, the eyebrow's first word (D10)
 * @property icon - Its Font Awesome solid icon
 * @property touched - The keys of the rows a change's patch names, as text: its bytes at the tag's patch type in
 * @property apply - The rows a change leaves, by key — `none` for a row it deletes — from the rows it touches as they
 *   stand, by key, `none` for one the record lacks; `none` when it no longer applies to them: the Stale mark (P21)
 * @property locked - Whether a row is locked, from its bytes and its key's text: the Locked mark; `none`, never
 * @property kind - Where it draws
 */
export const DecisionTargetType = StructType({
    tags: ArrayType(StringType),
    name: StringType,
    icon: StringType,
    touched: FunctionType([BlobType], ArrayType(StringType)),
    apply: FunctionType([BlobType, DictType(StringType, OptionType(BlobType))], OptionType(DictType(StringType, OptionType(BlobType)))),
    locked: OptionType(FunctionType([BlobType, StringType], BooleanType)),
    kind: DecisionTargetKindType,
});

/** Type representing {@link DecisionTargetType}. */
export type DecisionTargetType = typeof DecisionTargetType;
