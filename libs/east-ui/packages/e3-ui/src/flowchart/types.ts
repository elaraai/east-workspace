/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's East types (#1500, `Flowchart Records Spec.md` §3): the
 * value types its accessors return and its canvas carries (`Flowchart.Types`)
 * — an app's records hold their own types, which the kinds map — and the
 * kinds' wire: each kind closed over the app's record behind East functions
 * over beast2 bytes, as the Schematic's are, so the payload is one type
 * whatever the rows hold.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, BooleanType, DateTimeType, DictType, FloatType, FunctionType, IntegerType, NullType, OptionType, StringType, StructType,
    VariantType,
} from "@elaraai/east";
import { ColorSchemeType, StyleVariantType } from "@elaraai/east-ui/internal";
import { KindSideFields } from "../utils/record-kind.js";

// ============================================================================
// The value types the accessors return
// ============================================================================

/**
 * Link kind — the transition's provenance class.
 *
 * @remarks
 * `planned` renders solid; `observed` renders dashed (5/4). A link whose
 * `from` / `to` reference has no state row is *unresolved* — that is a
 * derived render class (dashed 4/4 in the negative tone against a ghost
 * "No state row" node), never an authored kind.
 *
 * @property planned - A designed / expected transition (solid stroke)
 * @property observed - A transition mined from evidence (dashed stroke)
 */
export const FlowchartLinkKindType = VariantType({
    /** A designed / expected transition (solid stroke) */
    planned: NullType,
    /** A transition mined from evidence (dashed stroke) */
    observed: NullType,
});

/**
 * Type representing flowchart link kinds.
 */
export type FlowchartLinkKindType = typeof FlowchartLinkKindType;

/**
 * Canvas orientation — which axis the lane bands run along.
 *
 * @remarks
 * Orientation is VIEW state, not slice state: the eyebrow's orientation
 * segment toggles it and it never appears as a filter chip. `LR` lays
 * lanes left→right (links flow rightward); `TD` swaps the axes.
 *
 * @property LR - Lanes run left → right
 * @property TD - Lanes run top → down
 */
export const FlowchartOrientationType = VariantType({
    /** Lanes run left → right */
    LR: NullType,
    /** Lanes run top → down */
    TD: NullType,
});

/**
 * Type representing flowchart orientations.
 */
export type FlowchartOrientationType = typeof FlowchartOrientationType;

/**
 * Imported evidence carried by a transition — never hand-authored: what a
 * transitions kind's `evidence` accessor builds from the app's own fields.
 *
 * @remarks
 * Evidence drives derived marks only: stroke weight scales with `volume`
 * (log scale 1.6 / 2 / 2.5 px, floor 1.4), `volume` + `unit` print as the
 * paper-filled badge on the longest straight run, and the inspector shows
 * all four, read only, under the transition's fields (#1250).
 *
 * @property volume - Total measured volume behind the arrow
 * @property count - Event count behind the arrow (e.g. cage moves)
 * @property measuredAt - When the evidence was measured
 * @property unit - Volume unit suffix for badges ("parcels")
 */
export const FlowchartEvidenceType = StructType({
    /** Total measured volume behind the arrow */
    volume: OptionType(FloatType),
    /** Event count behind the arrow (e.g. cage moves) */
    count: OptionType(IntegerType),
    /** When the evidence was measured */
    measuredAt: OptionType(DateTimeType),
    /** Volume unit suffix for badges ("parcels") */
    unit: OptionType(StringType),
});

/**
 * Type representing link evidence.
 */
export type FlowchartEvidenceType = typeof FlowchartEvidenceType;

/**
 * Eyebrow freshness chip content.
 *
 * @property label - Chip label ("evidence-2026.06")
 * @property date - Optional stamp printed after the label
 */
export const FlowchartFreshnessType = StructType({
    /** Chip label ("evidence-2026.06") */
    label: StringType,
    /** Optional stamp printed after the label */
    date: OptionType(DateTimeType),
});

/**
 * Type representing the freshness chip.
 */
export type FlowchartFreshnessType = typeof FlowchartFreshnessType;

// ============================================================================
// The roles, as each kind reads them from the app's row
// ============================================================================

/**
 * A state's roles, as its kind reads them from the app's row (R2).
 *
 * @property label - Its card's name: its `label` field, empty for an Option field holding none
 * @property lane - The lane it stands in, by the lane's key: its `lane` field; `none` for a kind with no `lane`
 * @property order - Its place in its lane: its `order` field; `none` for a kind with no `order`, whose states stand by key
 * @property members - A class of interchangeable states: the ×N badge, its `members` accessor's
 */
export const FlowchartStateRolesType = StructType({
    label: StringType,
    lane: OptionType(StringType),
    order: OptionType(FloatType),
    members: OptionType(IntegerType),
});

/** Type representing a state's roles. */
export type FlowchartStateRolesType = typeof FlowchartStateRolesType;

/**
 * What a gesture writes into a state's row (R8): each role's field, `none`
 * leaving it as it was — or, for a new row, as a card's values give it, else
 * its type's default.
 *
 * @property label - Its label: a rename; an empty label is `none` in an Option field
 * @property lane - Its lane's key: a move across lanes
 * @property order - Its place in its lane: a move between two cards
 */
export const FlowchartStateWriteType = StructType({
    label: OptionType(StringType),
    lane: OptionType(StringType),
    order: OptionType(FloatType),
});

/** Type representing a state's write. */
export type FlowchartStateWriteType = typeof FlowchartStateWriteType;

/**
 * A transition's roles, as its kind reads them from the app's row (R2).
 *
 * @property from - The state it leaves, by key
 * @property to - The state it enters, by key
 * @property decision - The decision that governs it, by key; `none` for none, an empty String field among them
 * @property kind - Planned or observed: its `kind` accessor's, planned unless given
 * @property evidence - The label's evidence line and the stroke's weight: its `evidence` accessor's
 */
export const FlowchartTransitionRolesType = StructType({
    from: StringType,
    to: StringType,
    decision: OptionType(StringType),
    kind: FlowchartLinkKindType,
    evidence: OptionType(FlowchartEvidenceType),
});

/** Type representing a transition's roles. */
export type FlowchartTransitionRolesType = typeof FlowchartTransitionRolesType;

/**
 * What a gesture writes into a transition's row (R8): its ends — Connect and
 * a retarget — and its decision, each `none` leaving it as it was, or for a
 * new row as a card's values give it, else its type's default.
 *
 * @property from - The state it leaves, by key
 * @property to - The state it enters, by key
 * @property decision - The decision that governs it: `some(none)` clears it — a decision's Del — and `some(some(key))` names one
 */
export const FlowchartTransitionWriteType = StructType({
    from: OptionType(StringType),
    to: OptionType(StringType),
    decision: OptionType(OptionType(StringType)),
});

/** Type representing a transition's write. */
export type FlowchartTransitionWriteType = typeof FlowchartTransitionWriteType;

/**
 * A lane's roles, as its kind reads them from the app's row (R2).
 *
 * @property label - Its header: its `label` field, empty for an Option field holding none
 * @property order - Its place among the lanes: its `order` field, an Integer one read as a Float; `none` for a kind with no `order`, whose lanes stand by key
 */
export const FlowchartLaneRolesType = StructType({
    label: StringType,
    order: OptionType(FloatType),
});

/** Type representing a lane's roles. */
export type FlowchartLaneRolesType = typeof FlowchartLaneRolesType;

/**
 * What a gesture writes into a lane's row (R8): + LANE, a rename and a card
 * dropped between two lanes — each role's field, `none` leaving it as it was,
 * or for a new row as a card's values give it, else its type's default. An
 * `order` an Integer field can't hold — between two whole numbers — is refused
 * (`none` from the write), and the renderer moves the lanes after it on.
 *
 * @property label - Its header
 * @property order - Its place among the lanes
 */
export const FlowchartLaneWriteType = StructType({
    label: OptionType(StringType),
    order: OptionType(FloatType),
});

/** Type representing a lane's write. */
export type FlowchartLaneWriteType = typeof FlowchartLaneWriteType;

/**
 * A decision's roles, as its kind reads them from the app's row (R2).
 *
 * @property label - Its name: its `label` accessor's
 * @property letter - The diamond's letter: its `letter` accessor's; `none`, the label's first
 * @property owner - Who owns it: its `owner` accessor's
 * @property outcomes - Its outcomes' summary line: its `outcomes` accessor's
 * @property queue - The states queued at it, by key: its `queue` field, a Set's in its order; empty for a kind with no `queue`
 */
export const FlowchartDecisionRolesType = StructType({
    label: StringType,
    letter: OptionType(StringType),
    owner: OptionType(StringType),
    outcomes: OptionType(StringType),
    queue: ArrayType(StringType),
});

/** Type representing a decision's roles. */
export type FlowchartDecisionRolesType = typeof FlowchartDecisionRolesType;

/**
 * One stored row as a kind's `rows` gives it: its roles, read in the pass
 * that reads the row, and the row as bytes at the record's row type — what a
 * write and the editing session take.
 *
 * @typeParam R - The roles' type
 * @param roles - The roles' type
 * @returns The entry's type
 */
export function FlowchartEntryType<R extends StructType>(roles: R) {
    return StructType({ roles, row: BlobType });
}

/** One stored state: its roles and its row's bytes. */
export const FlowchartStateEntryType = FlowchartEntryType(FlowchartStateRolesType);
/** One stored transition: its roles and its row's bytes. */
export const FlowchartTransitionEntryType = FlowchartEntryType(FlowchartTransitionRolesType);
/** One stored lane: its roles and its row's bytes. */
export const FlowchartLaneEntryType = FlowchartEntryType(FlowchartLaneRolesType);
/** One stored decision: its roles and its row's bytes. */
export const FlowchartDecisionEntryType = FlowchartEntryType(FlowchartDecisionRolesType);

/**
 * One card a kind's library tab lists, read from a record the app keeps
 * (R14): dropped, it makes a row of its kind from its values.
 *
 * @property key - Its key: its record's key
 * @property name - Its card's name
 * @property group - The tab's group it sits under
 * @property values - Every field of the row but those a drop writes — a state's lane and order, a transition's ends, a lane's order — as bytes
 */
export const FlowchartTemplateType = StructType({
    key: StringType,
    name: StringType,
    group: OptionType(StringType),
    values: BlobType,
});

/** Type representing a card. */
export type FlowchartTemplateType = typeof FlowchartTemplateType;

// ============================================================================
// The details' wire (#1507, §3, R18–R21)
// ============================================================================

/**
 * A tag's look, as a Tag takes it (R30): east-ui's `ColorSchemeType` and
 * `StyleVariantType`. `Flowchart.Types.TagColor`, for an app that keeps its
 * looks as data — an Array of them, the first ranked first.
 *
 * @property tag - The tag
 * @property colorPalette - Its palette
 * @property variant - Its variant: `subtle`, a 6% wash of its palette on a 1px rule of it, unless the app gives another
 */
export const FlowchartTagColorType = StructType({
    tag: StringType,
    colorPalette: ColorSchemeType,
    variant: StyleVariantType,
});

/** Type representing a tag's look. */
export type FlowchartTagColorType = typeof FlowchartTagColorType;

/**
 * Where a read shows (R21): `all`, the default — on the canvas, a state's
 * card or a transition's label, and in the inspector; `canvas` — there alone;
 * `inspector` — in the inspector alone. A variant, as the Schematic carries
 * its narrowed `show`.
 *
 * @property all - On the canvas and in the inspector
 * @property canvas - On the canvas alone
 * @property inspector - In the inspector alone
 */
export const FlowchartShowType = VariantType({
    all: NullType,
    canvas: NullType,
    inspector: NullType,
});

/** Type representing where a read shows. */
export type FlowchartShowType = typeof FlowchartShowType;

/**
 * A read, described (R20): what it draws a row's value as, and in which
 * words.
 *
 * @property figure - A number: its label, and its unit
 * @property histogram - Counts by duration: its label, its durations' unit, what is counted, the app's bins — none, every
 *   row's edges merged — how the bars space them, and the edges the axis names — none, round durations
 * @property list - Items by name: its label, its unit, and how many lines it draws on the canvas — 2 on a card and 1 on a
 *   label unless given, at most 3
 * @property tags - The row's tags: its label, each tag's look, first defined first shown, and whether the canvas's legend lists them
 */
export const FlowchartReadType = VariantType({
    figure: StructType({ label: StringType, unit: OptionType(StringType) }),
    histogram: StructType({
        label: StringType,
        unit: VariantType({ minutes: NullType, hours: NullType, days: NullType }),
        counts: OptionType(StringType),
        bins: OptionType(ArrayType(FloatType)),
        scale: VariantType({ band: NullType, linear: NullType }),
        ticks: OptionType(ArrayType(StructType({ at: FloatType, label: OptionType(StringType) }))),
    }),
    list: StructType({ label: StringType, unit: OptionType(StringType), top: IntegerType }),
    tags: StructType({
        label: StringType,
        colors: ArrayType(FlowchartTagColorType),
        legend: BooleanType,
    }),
});

/** Type representing a read, described. */
export type FlowchartReadType = typeof FlowchartReadType;

/**
 * What a details row holds (R18): one value a read, in the reads' order.
 *
 * @property figure - The number; `none` where the row holds none
 * @property histogram - Its counts, each at the lower edge of the bin it counts: a Dict's durations as they are, keyed; an
 *   Array's counts at their bins' edges, in order — or, for an Array whose length is not its bins', every count at `NaN`,
 *   which no bin holds, so the renderer lists the row in Issues and draws its bars absent (R27, R38)
 * @property list - Its items as the row holds them, by name: each its value, and the note its draw gives
 * @property tags - Its tags, in the row's order
 */
export const FlowchartDetailRowType = ArrayType(VariantType({
    figure: OptionType(FloatType),
    histogram: ArrayType(StructType({ from: FloatType, count: FloatType })),
    list: ArrayType(StructType({ name: StringType, value: FloatType, note: OptionType(StringType) })),
    tags: ArrayType(StringType),
}));

/** Type representing what a details row holds. */
export type FlowchartDetailRowType = typeof FlowchartDetailRowType;

/**
 * How the rail's picks weigh a kind's details (#1522, R43–R46): the source
 * whose picks of a Dict field weigh them, and the entries index the field is
 * filed through. A drawn row's picked entries — the picked keys' ranges of the
 * index, by the row's key — are what each read the picks weigh draws, added up
 * by kind; with no pick, every read draws the row's own (`values`).
 *
 * @property source - The rail's source whose picks weigh them: a source of the Flowchart's slice over the details' record
 * @property field - Its Dict field, the one the entries index files entry by entry
 * @property index - The entries index: its lean rows, under `<index>_rows`, are what the drawn rows are read by key through
 * @property reads - Whether the picks weigh each read, in the reads' order: one the entries hold, unless it says
 *   `weigh: false`. A row holding none of the picks says *no data* in these, and draws the row's own in the others
 * @property fold - A row's values, from its bytes and its picked entries' bytes, each an entry's value, in the entries'
 *   key order: one a read, in the reads' order
 */
export const FlowchartWeighedType = StructType({
    source: StringType,
    field: StringType,
    index: StringType,
    reads: ArrayType(BooleanType),
    fold: FunctionType([BlobType, ArrayType(BlobType)], FlowchartDetailRowType),
});

/** Type representing how the rail's picks weigh a kind's details. */
export type FlowchartWeighedType = typeof FlowchartWeighedType;

/**
 * A kind's details, closed (R18, R19): each read described once, and the
 * rows' values, read as the kind is — whole, or by the drawn rows' keys
 * through the paged read named. The details' row type never reaches the
 * payload: `values` turns a row into one value a read.
 *
 * @property reads - Every read, in the details' order, each where it shows
 * @property rows - The details read whole, beside a kind read whole: `()` → each row's bytes, by key, `none` while the read
 *   is in flight; `none` beside a kind read through its source
 * @property paged - The paged read the details are read by key through, beside a kind read through its source: the drawn
 *   rows' keys, every key in one request; `none` beside a kind read whole
 * @property values - A row's values, from its bytes: one a read, in the reads' order
 * @property weighed - How the rail's picks weigh them (#1522, R43–R46), for details that name a source; `none` for any
 *   other. They are read by key whatever their kind's read, `paged` naming the binding.
 */
export const FlowchartDetailsType = StructType({
    reads: ArrayType(StructType({ show: FlowchartShowType, read: FlowchartReadType })),
    rows: OptionType(FunctionType([], OptionType(DictType(StringType, BlobType)))),
    paged: OptionType(StringType),
    values: FunctionType([BlobType], FlowchartDetailRowType),
    weighed: OptionType(FlowchartWeighedType),
});

/** Type representing a kind's details, closed. */
export type FlowchartDetailsType = typeof FlowchartDetailsType;

// ============================================================================
// The kinds' wire (§3, "What the payload carries")
// ============================================================================

/**
 * What every kind carries beside its record's side ({@link KindSideFields}):
 * its name and its icon.
 *
 * @property name - What one is called: in the inspector, Issues and the library
 * @property icon - Its Font Awesome solid icon
 */
const FlowchartKindFields = {
    name: StringType,
    icon: StringType,
    ...KindSideFields,
} as const;

/** A kind's stored rows a read holds, by key: each its roles and its row; `none` while the read is in flight. */
const RowsOf = <E extends StructType>(entry: E) => FunctionType([], OptionType(DictType(StringType, entry)));

/**
 * The states, closed (§3): a record of the app's, read whole or complete
 * through their source of the slice.
 *
 * @property rows - Its stored states a read holds, by key, each its roles and its row: its record read whole, or its narrowing read complete through its source
 * @property rowsOf - Rows a reader read by key through the states' source of the slice, as beast2 bytes of an `Array` of `{ key, row }`, made its stored states: a hidden end's, and Find's
 * @property read - A drafted row's roles, from its bytes and its key
 * @property write - The row with a gesture's roles written and every other field as it was
 * @property create - A new row from a gesture's roles, every other field a card's values, or its type's default
 * @property laneField - The field naming a state's lane by the lane's key, `none` without lanes: a conflict on it named by the lane's label
 * @property templates - Its cards, the Steps tab's
 * @property templatesSource - The slice's source its cards follow
 * @property details - Its details over the app's rows keyed as the states are, read only, drawn on each card and in the
 *   inspector (#1507); `none` for states with none, which keep today's cards
 */
export const FlowchartStateKindType = StructType({
    ...FlowchartKindFields,
    rows: RowsOf(FlowchartStateEntryType),
    rowsOf: FunctionType([BlobType], DictType(StringType, FlowchartStateEntryType)),
    read: FunctionType([BlobType, StringType], FlowchartStateRolesType),
    write: FunctionType([BlobType, FlowchartStateWriteType], OptionType(BlobType)),
    create: FunctionType([FlowchartStateWriteType, OptionType(BlobType)], OptionType(BlobType)),
    laneField: OptionType(StringType),
    templates: ArrayType(FlowchartTemplateType),
    templatesSource: OptionType(StringType),
    details: OptionType(FlowchartDetailsType),
});

/** Type representing the states, closed. */
export type FlowchartStateKindType = typeof FlowchartStateKindType;

/**
 * The transitions, closed (§3): a record of the app's, read whole or
 * complete through their source of the slice.
 *
 * @property rows - Its stored transitions a read holds, by key, each its roles and its row
 * @property read - A drafted row's roles, from its bytes and its key
 * @property write - The row with its ends and its decision written, each where given, and every other field as it was
 * @property create - A new transition between two states — Connect — every other field a card's values, or its type's default
 * @property fromField - The field naming its start by its state's key: a conflict on it named by the state's label
 * @property toField - The field naming its end by its state's key: a conflict on it named by the state's label
 * @property decisionField - The field naming its decision by the decision's key, `none` without one: a conflict on it named by the decision's label
 * @property templates - Its cards, the Transitions tab's: dropped on a transition, one gives it its values, its ends kept
 * @property templatesSource - The slice's source its cards follow
 * @property details - Its details over the app's rows keyed as the transitions are, read only, drawn as lines under each
 *   label's evidence and in the inspector (#1507); `none` for transitions with none
 */
export const FlowchartTransitionKindType = StructType({
    ...FlowchartKindFields,
    rows: RowsOf(FlowchartTransitionEntryType),
    read: FunctionType([BlobType, StringType], FlowchartTransitionRolesType),
    write: FunctionType([BlobType, FlowchartTransitionWriteType], OptionType(BlobType)),
    create: FunctionType([FlowchartTransitionWriteType, OptionType(BlobType)], OptionType(BlobType)),
    fromField: StringType,
    toField: StringType,
    decisionField: OptionType(StringType),
    templates: ArrayType(FlowchartTemplateType),
    templatesSource: OptionType(StringType),
    details: OptionType(FlowchartDetailsType),
});

/** Type representing the transitions, closed. */
export type FlowchartTransitionKindType = typeof FlowchartTransitionKindType;

/**
 * The lanes, closed (§3): a small record of the app's, read whole.
 *
 * @property rows - Its lanes, by key, each its roles and its row; `none` while the read is in flight
 * @property read - A drafted row's roles, from its bytes and its key
 * @property write - The row with its label and its order written, each where given, and every other field as it was; `none` for an order an Integer field can't hold
 * @property create - A new lane from its label and its order, every other field a card's values, or its type's default; `none` as `write` refuses
 * @property templates - Its cards, the Lanes tab's
 * @property templatesSource - The slice's source its cards follow
 */
export const FlowchartLaneKindType = StructType({
    ...FlowchartKindFields,
    rows: RowsOf(FlowchartLaneEntryType),
    read: FunctionType([BlobType, StringType], FlowchartLaneRolesType),
    write: FunctionType([BlobType, FlowchartLaneWriteType], OptionType(BlobType)),
    create: FunctionType([FlowchartLaneWriteType, OptionType(BlobType)], OptionType(BlobType)),
    templates: ArrayType(FlowchartTemplateType),
    templatesSource: OptionType(StringType),
});

/** Type representing the lanes, closed. */
export type FlowchartLaneKindType = typeof FlowchartLaneKindType;

/**
 * The decisions, closed (§3): a small record of the app's, read whole.
 *
 * @property rows - Its decisions, by key, each its roles and its row; `none` while the read is in flight
 * @property read - A drafted row's roles, from its bytes and its key
 * @property unqueue - The row with a state's key taken out of its queue — a state's Del; `none` for a kind with no `queue`
 */
export const FlowchartDecisionKindType = StructType({
    ...FlowchartKindFields,
    rows: RowsOf(FlowchartDecisionEntryType),
    read: FunctionType([BlobType, StringType], FlowchartDecisionRolesType),
    unqueue: OptionType(FunctionType([BlobType, StringType], OptionType(BlobType))),
});

/** Type representing the decisions, closed. */
export type FlowchartDecisionKindType = typeof FlowchartDecisionKindType;

/**
 * What a narrowing does (R6): `hide`, the default — a row it leaves out is
 * never read — or `dim` — every row is read, and those it leaves out are
 * drawn as context, selected by no path.
 *
 * @property hide - A row the narrowing leaves out is never read
 * @property dim - Every row is read, those left out drawn faded
 */
export const FlowchartNarrowedType = VariantType({
    hide: NullType,
    dim: NullType,
});

/** Type representing what a narrowing does. */
export type FlowchartNarrowedType = typeof FlowchartNarrowedType;
