/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType,
    DateTimeType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

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
 * Link-authoring mode for the drag-to-connect gesture.
 *
 * @property draw - Adds locally, form-input style (the renderer appends)
 * @property connect - Event-only; the host owns the data (plan operations)
 */
export const FlowchartLinkModeType = VariantType({
    /** Adds locally, form-input style (the renderer appends) */
    draw: NullType,
    /** Event-only; the host owns the data (plan operations) */
    connect: NullType,
});

/**
 * Type representing flowchart link-authoring modes.
 */
export type FlowchartLinkModeType = typeof FlowchartLinkModeType;

/**
 * Imported evidence carried by a link — never hand-authored.
 *
 * @remarks
 * Evidence drives derived marks only: stroke weight scales with `volume`
 * (log scale 1.6 / 2 / 2.5 px, floor 1.4), `volume` + `unit` print as the
 * paper-filled badge on the longest straight run, and `count` /
 * `measuredAt` surface in hover cards and the inspector provenance block.
 *
 * @property volume - Total measured volume behind the arrow
 * @property count - Event count behind the arrow (e.g. transfers)
 * @property measuredAt - When the evidence was measured
 * @property unit - Volume unit suffix for badges ("kt")
 */
export const FlowchartEvidenceType = StructType({
    /** Total measured volume behind the arrow */
    volume: OptionType(FloatType),
    /** Event count behind the arrow (e.g. transfers) */
    count: OptionType(IntegerType),
    /** When the evidence was measured */
    measuredAt: OptionType(DateTimeType),
    /** Volume unit suffix for badges ("kt") */
    unit: OptionType(StringType),
});

/**
 * Type representing link evidence.
 */
export type FlowchartEvidenceType = typeof FlowchartEvidenceType;

/**
 * One state — a node in the flowchart.
 *
 * @remarks
 * The short mono `key` is the node identity everywhere (selection events,
 * link `from` / `to` refs, trigger queues). A state with `members` set is
 * a STATE CLASS — one node standing for N interchangeable members (the
 * `×N` badge). In-place transitions (`from == to` links) collapse to the
 * `↻ n` badge on the node and never route through handles.
 *
 * @property key - Short mono code — the node identity ("RCT")
 * @property label - Display label under the code
 * @property lane - The lane (ordered phase) this state belongs to
 * @property members - State-class member count → the ×N badge
 * @property notes - Free-text notes surfaced on hover / inspector
 */
export const FlowchartStateType = StructType({
    /** Short mono code — the node identity ("RCT") */
    key: StringType,
    /** Display label under the code */
    label: OptionType(StringType),
    /** The lane (ordered phase) this state belongs to */
    lane: StringType,
    /** State-class member count → the ×N badge */
    members: OptionType(IntegerType),
    /** Free-text notes surfaced on hover / inspector */
    notes: OptionType(StringType),
});

/**
 * Type representing flowchart states.
 */
export type FlowchartStateType = typeof FlowchartStateType;

/**
 * One link — a state transition drawn as an H/V-routed arrow.
 *
 * @remarks
 * `from` / `to` are state keys; a reference with no state row renders the
 * neg-dashed ghost "No state row" node (derived, counted in the footer).
 * At most one `trigger` per link — the lettered decision diamond anchored
 * to the midpoint of the longest straight run.
 *
 * @property key - Stable identity (selection / delete events); default derived from endpoints
 * @property from - Source state key
 * @property to - Target state key
 * @property kind - planned (default) | observed
 * @property trigger - 0..1 decision trigger key → diamond
 * @property evidence - Imported evidence (weight, badges, provenance)
 */
export const FlowchartLinkType = StructType({
    /** Stable identity (selection / delete events); default derived from endpoints */
    key: OptionType(StringType),
    /** Source state key */
    from: StringType,
    /** Target state key */
    to: StringType,
    /** planned (default) | observed */
    kind: OptionType(FlowchartLinkKindType),
    /** 0..1 decision trigger key → diamond */
    trigger: OptionType(StringType),
    /** Imported evidence (weight, badges, provenance) */
    evidence: OptionType(FlowchartEvidenceType),
});

/**
 * Type representing flowchart links.
 */
export type FlowchartLinkType = typeof FlowchartLinkType;

/**
 * One lane — an ordered phase band.
 *
 * @remarks
 * Lane order is array order; every state names its lane by `key`. The
 * dashed `+ LANE` affordance renders at the tail of the band row.
 *
 * @property key - Lane identity referenced by states
 * @property label - Band header label (defaults to the key, uppercased)
 */
export const FlowchartLaneType = StructType({
    /** Lane identity referenced by states */
    key: StringType,
    /** Band header label (defaults to the key, uppercased) */
    label: OptionType(StringType),
});

/**
 * Type representing flowchart lanes.
 */
export type FlowchartLaneType = typeof FlowchartLaneType;

/**
 * One decision trigger — a governed decision seam referenced by links.
 *
 * @remarks
 * Triggers render as diamonds (max one per link) carrying a letter per
 * TYPE, not per instance. Clicking a diamond highlights every link it
 * governs (plus queue and outcome nodes).
 *
 * @property key - Trigger identity referenced by links
 * @property label - Decision name ("press")
 * @property letter - Diamond letter (default: first letter of the label)
 * @property owner - Owning role / system ("press-scheduler")
 * @property queue - State keys queued at the decision
 * @property outcomes - Outcome summary line ("P* (×14 slots)")
 */
export const FlowchartTriggerType = StructType({
    /** Trigger identity referenced by links */
    key: StringType,
    /** Decision name ("press") */
    label: StringType,
    /** Diamond letter (default: first letter of the label) */
    letter: OptionType(StringType),
    /** Owning role / system ("press-scheduler") */
    owner: OptionType(StringType),
    /** State keys queued at the decision */
    queue: OptionType(ArrayType(StringType)),
    /** Outcome summary line ("P* (×14 slots)") */
    outcomes: OptionType(StringType),
});

/**
 * Type representing flowchart triggers.
 */
export type FlowchartTriggerType = typeof FlowchartTriggerType;

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

/**
 * Lane-rename event — a committed inline header edit.
 *
 * @property key - The renamed lane's key
 * @property label - The new label text
 */
export const FlowchartLaneRenameEventType = StructType({
    /** The renamed lane's key */
    key: StringType,
    /** The new label text */
    label: StringType,
});

/**
 * Type representing lane-rename events.
 */
export type FlowchartLaneRenameEventType = typeof FlowchartLaneRenameEventType;

/**
 * Link-creation event — a completed drag-to-connect gesture.
 *
 * @remarks
 * Handles are fixed per side, so the payload is purely topological: the
 * source and target state keys. Vetoed pairs (`canConnect` returning
 * false) never produce this event.
 *
 * @property from - Source state key (the out-handle the drag left)
 * @property to - Target state key (the node the drag released on)
 */
export const FlowchartLinkCreateEventType = StructType({
    /** Source state key (the out-handle the drag left) */
    from: StringType,
    /** Target state key (the node the drag released on) */
    to: StringType,
});

/**
 * Type representing link-creation events.
 */
export type FlowchartLinkCreateEventType = typeof FlowchartLinkCreateEventType;
