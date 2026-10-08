/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The flowchart's canvas (#1244, `Flowchart Builder Spec.md` §5.2): what it
 * draws with besides its flow — orientation, the freshness chip, the legend
 * and the minimap, density, the hover cards, the selection callbacks, the
 * connect veto and the bound slice. The payload carries one whole, as its
 * `canvas`. The flowchart fills the box it is given (#1245): it takes no
 * height of its own. Its gestures are its editing session's (#1247): it takes
 * no callback for an edit.
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
import { FlowchartOrientationType, FlowchartFreshnessType } from "./types.js";

/**
 * East type for the flowchart's canvas — what it draws its flow with: the
 * payload's `canvas`.
 *
 * @remarks
 * Per-field docs live on {@link FlowchartCanvasOptions}. It carries no
 * callback for an edit: every gesture is one transaction of the flowchart's
 * editing session, which Save commits (#1247).
 */
export const FlowchartCanvasType: StructType<{
    orientation: OptionType<FlowchartOrientationType>,
    freshness: OptionType<FlowchartFreshnessType>,
    minimap: OptionType<BooleanType>,
    legend: OptionType<BooleanType>,
    density: OptionType<DensityType>,
    slice: OptionType<SliceChromeType>,
    stateHover: OptionType<FunctionType<[StringType], UIComponentType>>,
    linkHover: OptionType<FunctionType<[StringType], UIComponentType>>,
    triggerHover: OptionType<FunctionType<[StringType], UIComponentType>>,
    onSelectState: OptionType<FunctionType<[StringType], NullType>>,
    onSelectLink: OptionType<FunctionType<[StringType], NullType>>,
    onSelectTrigger: OptionType<FunctionType<[StringType], NullType>>,
    onTracePath: OptionType<FunctionType<[StringType], NullType>>,
    canConnect: OptionType<FunctionType<[StringType, StringType], BooleanType>>,
}> = StructType({
    orientation: OptionType(FlowchartOrientationType),
    freshness: OptionType(FlowchartFreshnessType),
    minimap: OptionType(BooleanType),
    legend: OptionType(BooleanType),
    density: OptionType(DensityType),
    slice: OptionType(SliceChromeType),
    stateHover: OptionType(FunctionType([StringType], UIComponentType)),
    linkHover: OptionType(FunctionType([StringType], UIComponentType)),
    triggerHover: OptionType(FunctionType([StringType], UIComponentType)),
    onSelectState: OptionType(FunctionType([StringType], NullType)),
    onSelectLink: OptionType(FunctionType([StringType], NullType)),
    onSelectTrigger: OptionType(FunctionType([StringType], NullType)),
    onTracePath: OptionType(FunctionType([StringType], NullType)),
    canConnect: OptionType(FunctionType([StringType, StringType], BooleanType)),
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

/**
 * The freshness chip's input: the toolbar's chip naming the evidence the flow
 * was drawn from.
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
 * The host is told of the selection (`onSelectState`, `onSelectLink`,
 * `onSelectTrigger`) and of a traced path (`onTracePath`), and `canConnect`
 * vetoes a pair before a connection snaps. Every edit is the flowchart's own
 * (#1247): "+ LANE", a lane's header renamed and its ×, the "+ STATE" ghost,
 * a state double-clicked into its editor or dragged across lanes, a handle
 * dragged to connect, and Del on the selection — each one transaction of its
 * editing session, which Save commits through the record's patch mutation, or
 * the host's `onApply` over `data`. Hover cards, the selection and the
 * pointer-highlight grammar are built in.
 */
export interface FlowchartCanvasOptions {
    /** Initial orientation — "LR" (default) | "TD"; the toolbar's LR · TD segment toggles it (view state, never a chip). */
    orientation?: SubtypeExprOrValue<FlowchartOrientationType> | FlowchartOrientationLiteral;
    /** Optional freshness chip, in the toolbar. */
    freshness?: FlowchartFreshnessInput;
    /** Optional minimap toggle (default: auto — shown at ≥ 25 states). */
    minimap?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Optional legend toggle (default true). */
    legend?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Optional density. */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;

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

    /** Optional connection validator — `(from, to)` BEFORE the draft snaps; false forbids the pair. A throwing validator logs and ALLOWS (fail-open). */
    canConnect?: SubtypeExprOrValue<FunctionType<[StringType, StringType], BooleanType>>;
}

/**
 * The host's slice over the transitions it builds its flow from — given over
 * `data` only: a flow from a record is the record's, never narrowed.
 */
export interface FlowchartSliceOptions {
    /** Optional bound slice handle — mounts the slice's rail in the toolbar; the host feeds `Flowchart.over`'s `links` through `Slice.rows`. */
    slice?: SubtypeExprOrValue<SliceBindType>;
    /** The rail's affordances (default `["filter","search"]`), narrowing the transitions. `"brush"` is refused at build — a flowchart has no continuous 1-D axis. */
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
        slice: sliceChromeValue ? some(sliceChromeValue) : none,
        stateHover: options.stateHover !== undefined ? some(East.value(options.stateHover, FunctionType([StringType], UIComponentType))) : none,
        linkHover: options.linkHover !== undefined ? some(East.value(options.linkHover, FunctionType([StringType], UIComponentType))) : none,
        triggerHover: options.triggerHover !== undefined ? some(East.value(options.triggerHover, FunctionType([StringType], UIComponentType))) : none,
        onSelectState: options.onSelectState !== undefined ? some(options.onSelectState) : none,
        onSelectLink: options.onSelectLink !== undefined ? some(options.onSelectLink) : none,
        onSelectTrigger: options.onSelectTrigger !== undefined ? some(options.onSelectTrigger) : none,
        onTracePath: options.onTracePath !== undefined ? some(options.onTracePath) : none,
        canConnect: options.canConnect !== undefined ? some(options.canConnect) : none,
    }, FlowchartCanvasType);
}
