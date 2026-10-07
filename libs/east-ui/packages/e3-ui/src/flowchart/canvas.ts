/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The flowchart's canvas (#1244, `Flowchart Builder Spec.md` §5.2): what it
 * draws with besides its flow — orientation, the freshness chip, the legend
 * and the minimap, density, the hover cards, the selection callbacks, the
 * connect veto, the bound slice — and the edit callbacks the flowchart still
 * takes until its session replaces them (#1247). The payload carries one
 * whole, as its `canvas`.
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    variant,
    some,
    none,
    ArrayType,
    BooleanType,
    DateTimeType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
} from "@elaraai/east";

import { DensityType, UIComponentType, type DensityLiteral } from "@elaraai/east-ui";
import { SliceAffordanceType, SliceBindType, SliceChromeType, type SliceAffordanceLiteral } from "@elaraai/east-ui/internal";
import {
    FlowchartOrientationType,
    FlowchartLinkModeType,
    FlowchartFreshnessType,
    FlowchartLinkCreateEventType,
    FlowchartLaneRenameEventType,
    FlowchartStateAddEventType,
    FlowchartStateEditEventType,
    FlowchartStateMoveEventType,
} from "./types.js";

/**
 * East type for the flowchart's canvas — what it draws its flow with: the
 * payload's `canvas`.
 *
 * @remarks
 * Per-field docs live on {@link FlowchartCanvasOptions}; events are
 * documented in `./types.ts`. The edit callbacks (`linkMode`, `onCreateLink`,
 * `onDeleteLink`, `onAddLane`, `onRenameLane`, `onDeleteLane`, `onAddState`,
 * `onEditState`, `onMoveState`) and `height` / `maxHeight` stay until the
 * session (#1247) and the frame (#1245) replace them.
 */
export const FlowchartCanvasType: StructType<{
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
}> = StructType({
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
});

/**
 * Type representing the flowchart's canvas.
 */
export type FlowchartCanvasType = typeof FlowchartCanvasType;

// ============================================================================
// Literal shorthands
// ============================================================================

/** String shorthand for {@link FlowchartOrientationType}. */
export type FlowchartOrientationLiteral = "LR" | "TD";

/** String shorthand for {@link FlowchartLinkModeType}. */
export type FlowchartLinkModeLiteral = "draw" | "connect";

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
// Options
// ============================================================================

/**
 * The canvas's options — what every `<Flowchart>` takes beside its flows.
 *
 * @remarks
 * Interaction is opt-in per channel: selection (`onSelectState`,
 * `onSelectLink`, `onSelectTrigger`), path tracing (`onTracePath`), link
 * authoring (`linkMode`, `onCreateLink`, `onDeleteLink`, `canConnect`) and
 * lane and state editing (`onAddLane`, `onRenameLane`, `onDeleteLane`,
 * `onAddState`, `onEditState`, `onMoveState`). Hover cards, the selection
 * and the pointer-highlight grammar are built in.
 */
export interface FlowchartCanvasOptions {
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
}

/**
 * The host's slice over the transitions it builds its flow from — given over
 * `data` only: a flow from a record is the record's, never narrowed.
 */
export interface FlowchartSliceOptions {
    /** Optional bound slice handle — mounts the eyebrow slice cluster; the host feeds `Flowchart.over`'s `links` through `Slice.rows`. */
    slice?: SubtypeExprOrValue<SliceBindType>;
    /** Slice affordances (default `["filter","search"]`; search = "⌕ find state"). `"brush"` is refused at build — a flowchart has no continuous 1-D axis. */
    affordances?: SliceAffordanceLiteral[];
}

// ============================================================================
// Build
// ============================================================================

/**
 * Builds the canvas the payload carries: every option given, `none` for every
 * one left out.
 *
 * @param options - The canvas's options ({@link FlowchartCanvasOptions})
 * @param slice - The host's slice and its affordances, over `data`
 * @returns An East expression of {@link FlowchartCanvasType}
 * @throws {Error} When `affordances` lists `"brush"`
 * @internal
 */
export function buildCanvas(options: FlowchartCanvasOptions, slice: FlowchartSliceOptions): ExprType<FlowchartCanvasType> {
    if (slice.affordances?.includes("brush")) {
        throw new Error("Flowchart: `affordances` lists \"brush\", and a flowchart has no continuous axis to brush along — give \"filter\" and \"search\", or leave `affordances` out for both");
    }
    const sliceChromeValue = slice.slice !== undefined
        ? East.value({
            slice: slice.slice,
            affordances: East.value(
                (slice.affordances ?? ["filter", "search"]).map(a => variant(a, null)),
                ArrayType(SliceAffordanceType),
            ),
        }, SliceChromeType)
        : undefined;

    return East.value({
        orientation: options.orientation !== undefined
            ? some(typeof options.orientation === "string" ? variant(options.orientation, null) : options.orientation)
            : none,
        freshness: options.freshness !== undefined
            ? some(East.value({
                label: options.freshness.label,
                date: options.freshness.date !== undefined ? some(options.freshness.date) : none,
            }, FlowchartFreshnessType))
            : none,
        minimap: options.minimap !== undefined ? some(options.minimap) : none,
        legend: options.legend !== undefined ? some(options.legend) : none,
        density: options.density !== undefined
            ? some(typeof options.density === "string" ? East.value(variant(options.density, null), DensityType) : options.density)
            : none,
        height: options.height !== undefined ? some(options.height) : none,
        maxHeight: options.maxHeight !== undefined ? some(options.maxHeight) : none,
        slice: sliceChromeValue ? some(sliceChromeValue) : none,
        stateHover: options.stateHover !== undefined ? some(East.value(options.stateHover, FunctionType([StringType], UIComponentType))) : none,
        linkHover: options.linkHover !== undefined ? some(East.value(options.linkHover, FunctionType([StringType], UIComponentType))) : none,
        triggerHover: options.triggerHover !== undefined ? some(East.value(options.triggerHover, FunctionType([StringType], UIComponentType))) : none,
        onSelectState: options.onSelectState !== undefined ? some(options.onSelectState) : none,
        onSelectLink: options.onSelectLink !== undefined ? some(options.onSelectLink) : none,
        onSelectTrigger: options.onSelectTrigger !== undefined ? some(options.onSelectTrigger) : none,
        onTracePath: options.onTracePath !== undefined ? some(options.onTracePath) : none,
        linkMode: options.linkMode !== undefined
            ? some(typeof options.linkMode === "string" ? variant(options.linkMode, null) : options.linkMode)
            : none,
        onCreateLink: options.onCreateLink !== undefined ? some(options.onCreateLink) : none,
        onDeleteLink: options.onDeleteLink !== undefined ? some(options.onDeleteLink) : none,
        canConnect: options.canConnect !== undefined ? some(options.canConnect) : none,
        onAddLane: options.onAddLane !== undefined ? some(options.onAddLane) : none,
        onRenameLane: options.onRenameLane !== undefined ? some(options.onRenameLane) : none,
        onDeleteLane: options.onDeleteLane !== undefined ? some(options.onDeleteLane) : none,
        onAddState: options.onAddState !== undefined ? some(options.onAddState) : none,
        onEditState: options.onEditState !== undefined ? some(options.onEditState) : none,
        onMoveState: options.onMoveState !== undefined ? some(options.onMoveState) : none,
    }, FlowchartCanvasType);
}
