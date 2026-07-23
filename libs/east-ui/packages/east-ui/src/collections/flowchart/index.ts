/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    type TypeOf,
    East,
    Expr,
    variant,
    some,
    none,
    ArrayType,
    BooleanType,
    DateTimeType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { mapRows } from "../../shared/reify.js";
import { DensityType, type DensityLiteral } from "../../style/interaction.js";
import { SliceBindType, SliceChromeType } from "../../platform/slice/index.js";
import { SliceAffordanceType, type SliceAffordanceLiteral } from "../../contracts/slice-affordances.js";
import {
    FlowchartLinkKindType,
    FlowchartOrientationType,
    FlowchartLinkModeType,
    FlowchartEvidenceType,
    FlowchartStateType,
    FlowchartLinkType,
    FlowchartLaneType,
    FlowchartTriggerType,
    FlowchartFreshnessType,
    FlowchartLinkCreateEventType,
    FlowchartLaneRenameEventType,
    FlowchartStateAddEventType,
    FlowchartStateEditEventType,
    FlowchartStateMoveEventType,
} from "./types.js";

// Re-export types
export {
    FlowchartLinkKindType,
    FlowchartOrientationType,
    FlowchartLinkModeType,
    FlowchartEvidenceType,
    FlowchartStateType,
    FlowchartLinkType,
    FlowchartLaneType,
    FlowchartTriggerType,
    FlowchartFreshnessType,
    FlowchartLinkCreateEventType,
    FlowchartLaneRenameEventType,
    FlowchartStateAddEventType,
    FlowchartStateEditEventType,
    FlowchartStateMoveEventType,
} from "./types.js";

/**
 * East type for the Flowchart root — the resolved mirror of the inline
 * `Flowchart` struct in `component.ts`. Keep the two spellings in sync
 * field-for-field.
 *
 * @remarks
 * Per-field docs live on {@link FlowchartConfig}; events and collection
 * row types are documented in `./types.ts`.
 */
export const FlowchartRootType: StructType<{
    states: ArrayType<FlowchartStateType>,
    links: ArrayType<FlowchartLinkType>,
    lanes: ArrayType<FlowchartLaneType>,
    triggers: ArrayType<FlowchartTriggerType>,
    orientation: OptionType<FlowchartOrientationType>,
    freshness: OptionType<FlowchartFreshnessType>,
    minimap: OptionType<BooleanType>,
    legend: OptionType<BooleanType>,
    density: OptionType<DensityType>,
    height: OptionType<StringType>,
    maxHeight: OptionType<StringType>,
    slice: OptionType<SliceChromeType>,
    stateHover: OptionType<FunctionType<[StringType], UIComponentType>>,
    linkHover: OptionType<FunctionType<[StringType], UIComponentType>>,
    triggerHover: OptionType<FunctionType<[StringType], UIComponentType>>,
    onSelectState: OptionType<FunctionType<[StringType], NullType>>,
    onSelectLink: OptionType<FunctionType<[StringType], NullType>>,
    onSelectTrigger: OptionType<FunctionType<[StringType], NullType>>,
    onTracePath: OptionType<FunctionType<[StringType], NullType>>,
    linkMode: OptionType<FlowchartLinkModeType>,
    onCreateLink: OptionType<FunctionType<[FlowchartLinkCreateEventType], NullType>>,
    onDeleteLink: OptionType<FunctionType<[StringType], NullType>>,
    canConnect: OptionType<FunctionType<[StringType, StringType], BooleanType>>,
    onAddLane: OptionType<FunctionType<[], NullType>>,
    onRenameLane: OptionType<FunctionType<[FlowchartLaneRenameEventType], NullType>>,
    onDeleteLane: OptionType<FunctionType<[StringType], NullType>>,
    onAddState: OptionType<FunctionType<[FlowchartStateAddEventType], NullType>>,
    onEditState: OptionType<FunctionType<[FlowchartStateEditEventType], NullType>>,
    onMoveState: OptionType<FunctionType<[FlowchartStateMoveEventType], NullType>>,
    readOnly: OptionType<BooleanType>,
}> = StructType({
    states: ArrayType(FlowchartStateType),
    links: ArrayType(FlowchartLinkType),
    lanes: ArrayType(FlowchartLaneType),
    triggers: ArrayType(FlowchartTriggerType),
    orientation: OptionType(FlowchartOrientationType),
    freshness: OptionType(FlowchartFreshnessType),
    minimap: OptionType(BooleanType),
    legend: OptionType(BooleanType),
    density: OptionType(DensityType),
    height: OptionType(StringType),
    maxHeight: OptionType(StringType),
    slice: OptionType(SliceChromeType),
    stateHover: OptionType(FunctionType([StringType], UIComponentType)),
    linkHover: OptionType(FunctionType([StringType], UIComponentType)),
    triggerHover: OptionType(FunctionType([StringType], UIComponentType)),
    onSelectState: OptionType(FunctionType([StringType], NullType)),
    onSelectLink: OptionType(FunctionType([StringType], NullType)),
    onSelectTrigger: OptionType(FunctionType([StringType], NullType)),
    onTracePath: OptionType(FunctionType([StringType], NullType)),
    linkMode: OptionType(FlowchartLinkModeType),
    onCreateLink: OptionType(FunctionType([FlowchartLinkCreateEventType], NullType)),
    onDeleteLink: OptionType(FunctionType([StringType], NullType)),
    canConnect: OptionType(FunctionType([StringType, StringType], BooleanType)),
    onAddLane: OptionType(FunctionType([], NullType)),
    onRenameLane: OptionType(FunctionType([FlowchartLaneRenameEventType], NullType)),
    onDeleteLane: OptionType(FunctionType([StringType], NullType)),
    onAddState: OptionType(FunctionType([FlowchartStateAddEventType], NullType)),
    onEditState: OptionType(FunctionType([FlowchartStateEditEventType], NullType)),
    onMoveState: OptionType(FunctionType([FlowchartStateMoveEventType], NullType)),
    readOnly: OptionType(BooleanType),
});

/**
 * Type representing the flowchart root.
 */
export type FlowchartRootType = typeof FlowchartRootType;

/**
 * The struct element type of a `SubtypeExprOrValue<ArrayType<StructType>>`.
 */
export type RowElement<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    TypeOf<T> extends ArrayType<infer S> ? (S extends StructType ? S : never) : never;

// ============================================================================
// Literal shorthands
// ============================================================================

/** String shorthand for {@link FlowchartLinkKindType}. */
export type FlowchartLinkKindLiteral = "planned" | "observed";

/** String shorthand for {@link FlowchartOrientationType}. */
export type FlowchartOrientationLiteral = "LR" | "TD";

/** String shorthand for {@link FlowchartLinkModeType}. */
export type FlowchartLinkModeLiteral = "draw" | "connect";


// ============================================================================
// Row fields
// ============================================================================

/**
 * Fields the `state` mapper returns — one state node, before defaults.
 */
export interface FlowchartStateFields {
    /** Short mono code — the node identity ("RCT"). */
    key: SubtypeExprOrValue<StringType>;
    /** Optional display label under the code. */
    label?: SubtypeExprOrValue<StringType>;
    /** The lane (ordered phase) this state belongs to. */
    lane: SubtypeExprOrValue<StringType>;
    /** Optional state-class member count → the ×N badge (an Option so per-row absence is expressible). */
    members?: SubtypeExprOrValue<OptionType<IntegerType>>;
    /** Optional free-text notes surfaced on hover / inspector. */
    notes?: SubtypeExprOrValue<StringType>;
}

/**
 * Evidence fields the `link` mapper may return — all optional, per-row
 * absence via each field's Option.
 */
export interface FlowchartEvidenceFields {
    /** Total measured volume behind the arrow (drives stroke weight + badge). */
    volume?: SubtypeExprOrValue<OptionType<FloatTypeAlias>>;
    /** Event count behind the arrow (e.g. transfers). */
    count?: SubtypeExprOrValue<OptionType<IntegerType>>;
    /** When the evidence was measured. */
    measuredAt?: SubtypeExprOrValue<OptionType<DateTimeType>>;
    /** Volume unit suffix for badges ("kt"). */
    unit?: SubtypeExprOrValue<StringType>;
}

// FloatType is shadowed by nothing here; alias keeps the import list honest.
type FloatTypeAlias = import("@elaraai/east").FloatType;

/**
 * Fields the `link` mapper returns — one transition, before defaults.
 */
export interface FlowchartLinkFields {
    /** Optional stable identity (selection / delete events); default derived from endpoints. */
    key?: SubtypeExprOrValue<StringType>;
    /** Source state key. */
    from: SubtypeExprOrValue<StringType>;
    /** Target state key. */
    to: SubtypeExprOrValue<StringType>;
    /** Optional kind — "planned" (default, solid) | "observed" (dashed). */
    kind?: SubtypeExprOrValue<FlowchartLinkKindType> | FlowchartLinkKindLiteral;
    /** Optional decision trigger key (0..1 per link) → the lettered diamond. */
    trigger?: SubtypeExprOrValue<OptionType<StringType>>;
    /** Optional imported evidence (weight, badges, provenance). */
    evidence?: FlowchartEvidenceFields;
}

/**
 * Fields the `lane` mapper returns — one ordered phase band.
 */
export interface FlowchartLaneFields {
    /** Lane identity referenced by states. */
    key: SubtypeExprOrValue<StringType>;
    /** Optional band header label (defaults to the key, uppercased). */
    label?: SubtypeExprOrValue<StringType>;
}

/**
 * Fields the `trigger` mapper returns — one decision trigger.
 */
export interface FlowchartTriggerFields {
    /** Trigger identity referenced by links. */
    key: SubtypeExprOrValue<StringType>;
    /** Decision name ("press"). */
    label: SubtypeExprOrValue<StringType>;
    /** Optional diamond letter (default: first letter of the label). */
    letter?: SubtypeExprOrValue<StringType>;
    /** Optional owning role / system ("press-scheduler"). */
    owner?: SubtypeExprOrValue<StringType>;
    /** Optional state keys queued at the decision. */
    queue?: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Optional outcome summary line ("P* (×14 slots)"). */
    outcomes?: SubtypeExprOrValue<StringType>;
}

/**
 * A literal lanes input — plain `{ key, label? }` entries in band order.
 */
export type FlowchartLaneLiteral = { key: string; label?: string };

/**
 * Eyebrow freshness chip input.
 */
export interface FlowchartFreshnessInput {
    /** Chip label ("evidence-2026.06"). */
    label: SubtypeExprOrValue<StringType>;
    /** Optional stamp printed after the label. */
    date?: SubtypeExprOrValue<DateTimeType>;
}

// ============================================================================
// Config
// ============================================================================

/**
 * Configuration for a Flowchart.
 *
 * @remarks
 * A self-contained, slice-consuming state-transition flowchart: states as
 * nodes in ordered phase lanes, H/V-routed transition arrows, optional
 * per-link decision triggers (lettered diamonds), evidence-weighted
 * strokes, and built-in hover-card / inspector / highlight surfaces
 * derived from core + declared fields ("no new canvas encodings").
 *
 * @typeParam S - The states-table row struct
 * @typeParam L - The links-table row struct
 * @typeParam N - The lanes-table row struct
 * @typeParam T - The triggers-table row struct
 */
export interface FlowchartConfig<
    S extends StructType = StructType,
    L extends StructType = StructType,
    N extends StructType = StructType,
    T extends StructType = StructType,
> {
    /** Row mapper from a state row to node fields — omit when rows are already `Flowchart.Types.State`. */
    state?: (row: ExprType<S>) => FlowchartStateFields | ExprType<FlowchartStateType>;
    /** Row mapper from a link row to transition fields — omit when rows are already `Flowchart.Types.Link`. */
    link?: (row: ExprType<L>) => FlowchartLinkFields | ExprType<FlowchartLinkType>;
    /** Row mapper from a lane row to band fields — omit for literal `{ key, label? }` arrays or `Flowchart.Types.Lane` rows. */
    lane?: (row: ExprType<N>) => FlowchartLaneFields | ExprType<FlowchartLaneType>;
    /** Optional decision-trigger rows; links reference them by key. */
    triggers?: SubtypeExprOrValue<ArrayType<StructType>>;
    /** Row mapper from a trigger row — omit when rows are already `Flowchart.Types.Trigger`. */
    trigger?: (row: ExprType<T>) => FlowchartTriggerFields | ExprType<FlowchartTriggerType>;

    /** Initial orientation — "LR" (default) | "TD"; the eyebrow segment toggles it (view state, never a chip). */
    orientation?: SubtypeExprOrValue<FlowchartOrientationType> | FlowchartOrientationLiteral;
    /** Optional eyebrow freshness chip. */
    freshness?: FlowchartFreshnessInput;
    /** Optional minimap toggle (default: auto — shown at ≥ 25 states). */
    minimap?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Optional legend toggle (default true). */
    legend?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Optional density. */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Optional height — pins the component (uniform sizing #320); body scrolls within. */
    height?: SubtypeExprOrValue<StringType>;
    /** Optional maxHeight — caps the component, content-sized until the cap. */
    maxHeight?: SubtypeExprOrValue<StringType>;

    /** Optional bound slice handle — mounts the eyebrow slice cluster; consumers feed `links` via `Slice.rows`. */
    slice?: SubtypeExprOrValue<SliceBindType>;
    /** Slice affordances (default `["filter","search"]`; search = "⌕ find state"). `"brush"` is a build-time error — a flowchart has no continuous 1-D axis. */
    affordances?: SliceAffordanceLiteral[];

    /** Optional hover-card content builder for STATES — receives the hovered state's key and returns arbitrary UI, evaluated lazily on hover; absent ⇒ no state hover card. */
    stateHover?: SubtypeExprOrValue<FunctionType<[StringType], UIComponentType>>;
    /** Optional hover-card content builder for LINKS — receives the hovered link's key; absent ⇒ no link hover card. */
    linkHover?: SubtypeExprOrValue<FunctionType<[StringType], UIComponentType>>;
    /** Optional hover-card content builder for TRIGGERS — receives the hovered trigger's key; absent ⇒ no trigger hover card. */
    triggerHover?: SubtypeExprOrValue<FunctionType<[StringType], UIComponentType>>;
    /** Optional state-click callback (node key). */
    onSelectState?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Optional link-click callback (link key). */
    onSelectLink?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Optional trigger-click callback (trigger key; the click also highlights governed links). */
    onSelectTrigger?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Optional ⌥-click trace-path callback (link key). */
    onTracePath?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;

    /** Link-authoring mode — "draw" (adds locally) | "connect" (event-only); absent ⇒ read-only links. */
    linkMode?: SubtypeExprOrValue<FlowchartLinkModeType> | FlowchartLinkModeLiteral;
    /** Optional link-creation callback — a completed out-handle → node drag ({ from, to }). */
    onCreateLink?: SubtypeExprOrValue<FunctionType<[FlowchartLinkCreateEventType], NullType>>;
    /** Optional link-delete callback — Del with a link selected (link key). */
    onDeleteLink?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Optional connection validator — `(from, to)` BEFORE the draft snaps; false forbids the pair. A throwing validator logs and ALLOWS (fail-open). */
    canConnect?: SubtypeExprOrValue<FunctionType<[StringType, StringType], BooleanType>>;
    /** Optional add-lane callback — its presence renders the dashed "+ LANE" tail affordance (full lane height); absent ⇒ no affordance. */
    onAddLane?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Optional lane-rename callback — its presence makes lane headers click-to-edit (Enter / blur commits, Esc cancels); receives { key, label }. */
    onRenameLane?: SubtypeExprOrValue<FunctionType<[FlowchartLaneRenameEventType], NullType>>;
    /** Optional lane-delete callback — its presence renders an × beside each header (lane key). The HOST decides the cascade; the canvas stays safe either way: states referencing a missing lane fall into the LAST lane, and links to deleted states render as the neg-dashed "No state row" ghosts — orphans stay visible. */
    onDeleteLane?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Optional state-add callback — its presence enables the "+ STATE" ghost: hovering a lane band reveals one dashed node-footprint ghost parked one row below the lane's last node; click turns it into the inline editor (code auto-focused, label below); ⏎ commits { lane, key, label }, esc / blur-empty dismisses. The committed state starts unconnected. */
    onAddState?: SubtypeExprOrValue<FunctionType<[FlowchartStateAddEventType], NullType>>;
    /** Optional state-edit callback — its presence makes nodes double-click-to-edit in the same inline editor; receives { key, code, label } where key is the ORIGINAL identity (rekeying links is the host's call). */
    onEditState?: SubtypeExprOrValue<FunctionType<[FlowchartStateEditEventType], NullType>>;
    /** Optional state-move callback — its presence lets nodes drag across lanes (candidate bands highlight while dragging); receives { key, lane } on drop. */
    onMoveState?: SubtypeExprOrValue<FunctionType<[FlowchartStateMoveEventType], NullType>>;
    /** Optional runtime edit gate — true suppresses every authoring affordance (connect gesture, Del delete, + LANE) without unwiring the callbacks; selection and hover stay (inspecting isn't editing). Reactive-capable: feed a permission / published-mode flag. */
    readOnly?: SubtypeExprOrValue<BooleanType> | boolean;
}

// ============================================================================
// Build
// ============================================================================

/** Resolves a kind literal / value into the option envelope. */
function kindOption(
    kind: SubtypeExprOrValue<FlowchartLinkKindType> | FlowchartLinkKindLiteral | undefined,
): ExprType<OptionType<FlowchartLinkKindType>> {
    if (kind === undefined) return East.value(none, OptionType(FlowchartLinkKindType));
    if (typeof kind === "string") return East.value(some(variant(kind, null)), OptionType(FlowchartLinkKindType));
    return East.value(some(kind), OptionType(FlowchartLinkKindType));
}

function buildRoot(
    states: SubtypeExprOrValue<ArrayType<StructType>>,
    links: SubtypeExprOrValue<ArrayType<StructType>>,
    lanes: SubtypeExprOrValue<ArrayType<StructType>> | readonly FlowchartLaneLiteral[],
    config: FlowchartConfig<StructType, StructType, StructType, StructType>,
): ExprType<UIComponentType> {
    const stateMapper = config.state;
    const resolvedStates = stateMapper === undefined
        ? East.value(states as SubtypeExprOrValue<ArrayType<FlowchartStateType>>, ArrayType(FlowchartStateType))
        : mapRows(East.value(states) as ExprType<ArrayType<StructType>>, FlowchartStateType, (row) => {
            const r = stateMapper(row);
            if (r instanceof Expr) return East.value(r, FlowchartStateType);
            return East.value({
                key: r.key,
                label: r.label !== undefined ? some(r.label) : none,
                lane: r.lane,
                members: r.members !== undefined ? r.members : none,
                notes: r.notes !== undefined ? some(r.notes) : none,
            }, FlowchartStateType);
        });

    const linkMapper = config.link;
    const resolvedLinks = linkMapper === undefined
        ? East.value(links as SubtypeExprOrValue<ArrayType<FlowchartLinkType>>, ArrayType(FlowchartLinkType))
        : mapRows(East.value(links) as ExprType<ArrayType<StructType>>, FlowchartLinkType, (row) => {
            const r = linkMapper(row);
            if (r instanceof Expr) return East.value(r, FlowchartLinkType);
            return East.value({
                key: r.key !== undefined ? some(r.key) : none,
                from: r.from,
                to: r.to,
                kind: kindOption(r.kind),
                trigger: r.trigger !== undefined ? r.trigger : none,
                evidence: r.evidence !== undefined
                    ? some(East.value({
                        volume: r.evidence.volume !== undefined ? r.evidence.volume : none,
                        count: r.evidence.count !== undefined ? r.evidence.count : none,
                        measuredAt: r.evidence.measuredAt !== undefined ? r.evidence.measuredAt : none,
                        unit: r.evidence.unit !== undefined ? some(r.evidence.unit) : none,
                    }, FlowchartEvidenceType))
                    : none,
            }, FlowchartLinkType);
        });

    const laneMapper = config.lane;
    const resolvedLanes = laneMapper !== undefined
        ? mapRows(East.value(lanes as SubtypeExprOrValue<ArrayType<StructType>>) as ExprType<ArrayType<StructType>>, FlowchartLaneType, (row) => {
            const r = laneMapper(row);
            if (r instanceof Expr) return East.value(r, FlowchartLaneType);
            return East.value({
                key: r.key,
                label: r.label !== undefined ? some(r.label) : none,
            }, FlowchartLaneType);
        })
        : Array.isArray(lanes)
            ? East.value(
                (lanes as unknown as readonly FlowchartLaneLiteral[]).map(l => ({
                    key: l.key,
                    label: l.label !== undefined ? some(l.label) : none,
                })),
                ArrayType(FlowchartLaneType))
            : East.value(lanes as SubtypeExprOrValue<ArrayType<FlowchartLaneType>>, ArrayType(FlowchartLaneType));

    const triggerMapper = config.trigger;
    const resolvedTriggers = config.triggers === undefined
        ? East.value([], ArrayType(FlowchartTriggerType))
        : triggerMapper === undefined
            ? East.value(config.triggers as SubtypeExprOrValue<ArrayType<FlowchartTriggerType>>, ArrayType(FlowchartTriggerType))
            : mapRows(East.value(config.triggers) as ExprType<ArrayType<StructType>>, FlowchartTriggerType, (row) => {
                const r = triggerMapper(row);
                if (r instanceof Expr) return East.value(r, FlowchartTriggerType);
                return East.value({
                    key: r.key,
                    label: r.label,
                    letter: r.letter !== undefined ? some(r.letter) : none,
                    owner: r.owner !== undefined ? some(r.owner) : none,
                    queue: r.queue !== undefined ? some(East.value(r.queue, ArrayType(StringType))) : none,
                    outcomes: r.outcomes !== undefined ? some(r.outcomes) : none,
                }, FlowchartTriggerType);
            });

    if (config.affordances?.includes("brush")) {
        throw new Error("Flowchart does not support the 'brush' affordance — a flowchart has no continuous 1D axis.");
    }
    const sliceChromeValue = config.slice !== undefined
        ? East.value({
            slice: config.slice,
            affordances: East.value(
                (config.affordances ?? ["filter", "search"]).map(a => variant(a, null)),
                ArrayType(SliceAffordanceType),
            ),
        }, SliceChromeType)
        : undefined;

    return East.value(variant("Flowchart", {
        states: resolvedStates,
        links: resolvedLinks,
        lanes: resolvedLanes,
        triggers: resolvedTriggers,
        orientation: config.orientation !== undefined
            ? some(typeof config.orientation === "string" ? variant(config.orientation, null) : config.orientation)
            : none,
        freshness: config.freshness !== undefined
            ? some(East.value({
                label: config.freshness.label,
                date: config.freshness.date !== undefined ? some(config.freshness.date) : none,
            }, FlowchartFreshnessType))
            : none,
        minimap: config.minimap !== undefined ? some(config.minimap) : none,
        legend: config.legend !== undefined ? some(config.legend) : none,
        density: config.density !== undefined
            ? some(typeof config.density === "string" ? East.value(variant(config.density, null), DensityType) : config.density)
            : none,
        height: config.height !== undefined ? some(config.height) : none,
        maxHeight: config.maxHeight !== undefined ? some(config.maxHeight) : none,
        slice: sliceChromeValue ? some(sliceChromeValue) : none,
        stateHover: config.stateHover !== undefined ? some(East.value(config.stateHover, FunctionType([StringType], UIComponentType))) : none,
        linkHover: config.linkHover !== undefined ? some(East.value(config.linkHover, FunctionType([StringType], UIComponentType))) : none,
        triggerHover: config.triggerHover !== undefined ? some(East.value(config.triggerHover, FunctionType([StringType], UIComponentType))) : none,
        onSelectState: config.onSelectState !== undefined ? some(config.onSelectState) : none,
        onSelectLink: config.onSelectLink !== undefined ? some(config.onSelectLink) : none,
        onSelectTrigger: config.onSelectTrigger !== undefined ? some(config.onSelectTrigger) : none,
        onTracePath: config.onTracePath !== undefined ? some(config.onTracePath) : none,
        linkMode: config.linkMode !== undefined
            ? some(typeof config.linkMode === "string" ? variant(config.linkMode, null) : config.linkMode)
            : none,
        onCreateLink: config.onCreateLink !== undefined ? some(config.onCreateLink) : none,
        onDeleteLink: config.onDeleteLink !== undefined ? some(config.onDeleteLink) : none,
        canConnect: config.canConnect !== undefined ? some(config.canConnect) : none,
        onAddLane: config.onAddLane !== undefined ? some(config.onAddLane) : none,
        onRenameLane: config.onRenameLane !== undefined ? some(config.onRenameLane) : none,
        onDeleteLane: config.onDeleteLane !== undefined ? some(config.onDeleteLane) : none,
        onAddState: config.onAddState !== undefined ? some(config.onAddState) : none,
        onEditState: config.onEditState !== undefined ? some(config.onEditState) : none,
        onMoveState: config.onMoveState !== undefined ? some(config.onMoveState) : none,
        readOnly: config.readOnly !== undefined ? some(config.readOnly) : none,
    }), UIComponentType);
}

/**
 * Creates a Flowchart — a self-contained state-transition flowchart.
 *
 * @typeParam S - The states-table input
 * @typeParam L - The links-table input
 * @typeParam N - The lanes-table input
 * @typeParam T - The triggers-table input
 * @param states - The state rows (nodes)
 * @param config - The Flowchart configuration ({@link FlowchartConfig}) plus
 *   the `links` / `lanes` (required) and `triggers` (optional) tables
 * @returns An East expression of `UIComponentType`
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Flowchart, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ =>
 *     Flowchart.Root(
 *         [{ code: "RMI", name: "Raw intake", phase: "prep" },
 *          { code: "CUT", name: "Cut blanks", phase: "prep" }],
 *         {
 *             state: s => ({ key: s.code, label: s.name, lane: s.phase }),
 *             links: [{ src: "RMI", dst: "CUT" }],
 *             link: l => ({ from: l.src, to: l.dst }),
 *             lanes: [{ key: "prep", label: "Prep" }],
 *         },
 *     ),
 * );
 * ```
 */
function createFlowchart<
    S extends SubtypeExprOrValue<ArrayType<StructType>>,
    L extends SubtypeExprOrValue<ArrayType<StructType>>,
    N extends SubtypeExprOrValue<ArrayType<StructType>> = [],
    T extends SubtypeExprOrValue<ArrayType<StructType>> = [],
>(
    states: S,
    config: FlowchartConfig<RowElement<S>, RowElement<L>, RowElement<N>, RowElement<T>>
        & { links: L; lanes: N | readonly FlowchartLaneLiteral[]; triggers?: T },
): ExprType<UIComponentType> {
    const { links, lanes, ...rest } = config;
    return buildRoot(states, links, lanes, rest as unknown as FlowchartConfig<StructType, StructType, StructType, StructType>);
}

// ============================================================================
// Namespace export
// ============================================================================

/**
 * Flowchart component namespace.
 *
 * @remarks
 * `Flowchart.Root(states, config)` builds the flowchart from up to four
 * flat tables (states, links, lanes, triggers); closed-set fields in data
 * (`kind`, `orientation`, `linkMode`) are typed variant values
 * (`Flowchart.Types.*`).
 */
export const Flowchart = {
    /**
     * Creates a Flowchart — a self-contained state-transition flowchart.
     *
     * @remarks
     * See {@link FlowchartConfig} for per-field docs. States render as
     * nodes in ordered phase lanes; links as H/V-routed arrows; triggers
     * as lettered diamonds. Hover cards, the inspector and the highlight
     * grammar are built-in surfaces derived from core + declared fields.
     */
    Root: createFlowchart,

    /**
     * East types for flowchart rows, closed-set fields and events.
     */
    Types: {
        /**
         * East StructType for the Flowchart component.
         *
         * @remarks
         * See {@link FlowchartRootType} for per-field docs.
         */
        Flowchart: FlowchartRootType,
        /** One state node ({@link FlowchartStateType}). */
        State: FlowchartStateType,
        /** One transition ({@link FlowchartLinkType}). */
        Link: FlowchartLinkType,
        /** One ordered phase band ({@link FlowchartLaneType}). */
        Lane: FlowchartLaneType,
        /** One decision trigger ({@link FlowchartTriggerType}). */
        Trigger: FlowchartTriggerType,
        /** Imported link evidence ({@link FlowchartEvidenceType}). */
        Evidence: FlowchartEvidenceType,
        /** Link kind — planned | observed ({@link FlowchartLinkKindType}). */
        Kind: FlowchartLinkKindType,
        /** Canvas orientation — LR | TD ({@link FlowchartOrientationType}). */
        Orientation: FlowchartOrientationType,
        /** Link-authoring mode — draw | connect ({@link FlowchartLinkModeType}). */
        LinkMode: FlowchartLinkModeType,
        /** Eyebrow freshness chip ({@link FlowchartFreshnessType}). */
        Freshness: FlowchartFreshnessType,
        /** Link-creation event ({@link FlowchartLinkCreateEventType}). */
        LinkCreateEvent: FlowchartLinkCreateEventType,
        /** Lane-rename event ({@link FlowchartLaneRenameEventType}). */
        LaneRenameEvent: FlowchartLaneRenameEventType,
        /** State-add event ({@link FlowchartStateAddEventType}). */
        StateAddEvent: FlowchartStateAddEventType,
        /** State-edit event ({@link FlowchartStateEditEventType}). */
        StateEditEvent: FlowchartStateEditEventType,
        /** State-move event ({@link FlowchartStateMoveEventType}). */
        StateMoveEvent: FlowchartStateMoveEventType,
    },
} as const;
