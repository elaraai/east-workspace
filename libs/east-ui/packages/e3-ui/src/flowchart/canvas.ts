/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The flowchart's canvas (#1244, `Flowchart Builder Spec.md` §5.2): what it
 * draws with besides its kinds — orientation, the freshness chip, the legend
 * and the minimap, the selection callbacks and the connect veto. The payload
 * carries one whole, as its `canvas`. The flowchart fills the box it is given
 * (#1245): it takes no height of its own. Its gestures are its editing
 * session's (#1247): it takes no callback for an edit. It has no hover cards
 * (#1250): the inspector shows what is selected. It draws at one rhythm, the
 * spec's cards in their lanes (#1251): it takes no density. Its one narrowing
 * is its `slice` over the app's records (#1500), the payload's, never the
 * canvas's.
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
    BooleanType,
    DateTimeType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
} from "@elaraai/east";

import { FlowchartOrientationType, FlowchartFreshnessType } from "./types.js";

/**
 * The flowchart on a phone: a frame 560 px wide or narrower shows a window of
 * its lanes across its width, which its pager steps through. Above 560 px it
 * does nothing.
 *
 * @property lanes - How many lanes the window shows at once, 1 to 3; `none` shows 2
 */
export const FlowchartNarrowType = StructType({ lanes: OptionType(IntegerType) });
/** Type alias for {@link FlowchartNarrowType}. */
export type FlowchartNarrowType = typeof FlowchartNarrowType;

/**
 * East type for the flowchart's canvas — what it draws its kinds with: the
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
    onSelectState: OptionType<FunctionType<[StringType], NullType>>,
    onSelectLink: OptionType<FunctionType<[StringType], NullType>>,
    onSelectTrigger: OptionType<FunctionType<[StringType], NullType>>,
    onTracePath: OptionType<FunctionType<[StringType], NullType>>,
    canConnect: OptionType<FunctionType<[StringType, StringType], BooleanType>>,
    narrow: OptionType<FlowchartNarrowType>,
}> = StructType({
    orientation: OptionType(FlowchartOrientationType),
    freshness: OptionType(FlowchartFreshnessType),
    minimap: OptionType(BooleanType),
    legend: OptionType(BooleanType),
    onSelectState: OptionType(FunctionType([StringType], NullType)),
    onSelectLink: OptionType(FunctionType([StringType], NullType)),
    onSelectTrigger: OptionType(FunctionType([StringType], NullType)),
    onTracePath: OptionType(FunctionType([StringType], NullType)),
    canConnect: OptionType(FunctionType([StringType, StringType], BooleanType)),
    narrow: OptionType(FlowchartNarrowType),
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
 * The freshness chip's input: the toolbar's chip naming the evidence the
 * flowchart was drawn from.
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
 * The canvas's options — what every `<Flowchart>` takes beside its kinds.
 *
 * @remarks
 * The host is told of the selection (`onSelectState`, `onSelectLink`,
 * `onSelectTrigger`) and of a traced path (`onTracePath`), and `canConnect`
 * vetoes a pair before a connection snaps. Every edit is the flowchart's own
 * (#1247): "+ LANE", a lane's header double-clicked into its rename and its
 * ×, the "+ STATE" ghost, a state double-clicked into its editor or dragged
 * across lanes, a handle dragged to connect, and Del on the selection — each
 * one transaction of its editing session, which Save writes through each
 * record's own patch door (#1500). The selection — a state, a transition, a
 * decision, a lane by its header (#1250), or several states — and the
 * pointer-highlight grammar are built in, and the inspector shows what is
 * selected: the flowchart takes no hover card.
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

    /** On a phone: how many lanes the window shows at once, 1 to 3 (default 2), its pager stepping through them. */
    narrow?: { lanes?: 1 | 2 | 3 };
}

// ============================================================================
// Build
// ============================================================================

/**
 * Builds the canvas the payload carries: every option given, `none` for every
 * one left out.
 *
 * @param options - The canvas's options ({@link FlowchartCanvasOptions})
 * @returns An East expression of {@link FlowchartCanvasType}
 * @internal
 */
export function buildCanvas(options: FlowchartCanvasOptions): ExprType<FlowchartCanvasType> {
    const lanes = options.narrow?.lanes;
    if (lanes !== undefined && ![1, 2, 3].includes(lanes)) {
        throw new Error(`Flowchart: \`narrow.lanes\` is how many lanes a phone shows at once, 1 to 3 — got ${String(lanes)}`);
    }
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
        onSelectState: options.onSelectState !== undefined ? some(options.onSelectState) : none,
        onSelectLink: options.onSelectLink !== undefined ? some(options.onSelectLink) : none,
        onSelectTrigger: options.onSelectTrigger !== undefined ? some(options.onSelectTrigger) : none,
        onTracePath: options.onTracePath !== undefined ? some(options.onTracePath) : none,
        canConnect: options.canConnect !== undefined ? some(options.canConnect) : none,
        narrow: options.narrow !== undefined ? some({ lanes: lanes !== undefined ? some(BigInt(lanes)) : none }) : none,
    }, FlowchartCanvasType);
}
