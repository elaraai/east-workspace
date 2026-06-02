/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import {
    LabelInputType,
    type LabelInput,
} from "../../style.js";
import { StatusValueType, type StatusValueLiteral } from "../../feedback/status/types.js";

// NOTE: Any Matrix type that references `UIComponentType` (cell free slot,
// cell popover) lives in `collections/matrix/index.ts`, alongside the factory.
// This file stays UIComp-free so it can be imported from `component.ts`
// without a circular dependency.

// Re-export shared content primitives for ergonomic discovery via Matrix.Types.*.
export { AlignType, LabelInputType, type AlignLiteral, type LabelInput } from "../../style.js";
export { StatusValueType, type StatusValueLiteral } from "../../feedback/status/types.js";

// ============================================================================
// Segment fill — status-leveraged
// ============================================================================

/**
 * The fill of a cell-bar segment. A superset of {@link StatusValueType} (the
 * semantic statuses, identical to Planner markers / Gantt task status) plus the
 * three matrix-native fills.
 *
 * @property brand - Primary utilisation fill (brand teal — the "booked" segment)
 * @property success - Positive / committed (green)
 * @property warning - Caution / pending (gold)
 * @property danger - Negative / at-risk (red)
 * @property info - Informational (blue)
 * @property neutral - Muted solid fill
 * @property slack - Diagonal-hatched remainder (auto-fill slack)
 * @property free - Transparent track — empty / available capacity
 */
export const MatrixFillType = VariantType({
    brand: NullType,
    success: NullType,
    warning: NullType,
    danger: NullType,
    info: NullType,
    neutral: NullType,
    slack: NullType,
    free: NullType,
});

export type MatrixFillType = typeof MatrixFillType;

/** String shorthand for {@link MatrixFillType}. */
export type MatrixFillLiteral =
    "brand" | "success" | "warning" | "danger" | "info" | "neutral" | "slack" | "free";

// ============================================================================
// Segment — a weighted slice of the cell bar
// ============================================================================

/**
 * East StructType for a single weighted slice of a cell's bar.
 *
 * @remarks
 * Segments are weighted — the renderer normalises so `Σ weight = 100%` of the
 * cell axis (width when horizontal, height when vertical). `fill` drives the
 * colour from the theme (no raw hex needed); `color` is an override-only escape
 * hatch. `min` / `max` / `step` are honoured only when the Matrix carries an
 * `onSegmentChange` callback (drag-resize handles shown). `label` paints
 * in-bar text, suppressed under `minLabelSize`.
 *
 * @property fill - Status-leveraged fill ({@link MatrixFillType})
 * @property weight - Proportional weight (normalised with sibling segments)
 * @property label - Optional rich in-bar label (text + alignment + typography)
 * @property color - Optional explicit colour override (bypasses `fill`)
 * @property min - Optional minimum weight for drag-resize
 * @property max - Optional maximum weight for drag-resize
 * @property step - Optional snap increment for drag-resize
 */
export const MatrixSegmentType = StructType({
    fill: MatrixFillType,
    weight: FloatType,
    label: OptionType(LabelInputType),
    color: OptionType(StringType),
    min: OptionType(FloatType),
    max: OptionType(FloatType),
    step: OptionType(FloatType),
});

export type MatrixSegmentType = typeof MatrixSegmentType;

// ============================================================================
// Marker — a status flag on a cell (the Matrix analogue of Planner.marker)
// ============================================================================

/**
 * The corner a marker's icon / badge sits in.
 *
 * @property tl - Top-left
 * @property tr - Top-right
 * @property bl - Bottom-left
 * @property br - Bottom-right
 */
export const MatrixCornerType = VariantType({
    tl: NullType,
    tr: NullType,
    bl: NullType,
    br: NullType,
});

export type MatrixCornerType = typeof MatrixCornerType;

/** String shorthand for {@link MatrixCornerType}. */
export type MatrixCornerLiteral = "tl" | "tr" | "bl" | "br";

/**
 * East StructType for a cell status marker — the Matrix analogue of
 * `Planner.marker`. Reuses the shared {@link StatusValueType}: `status` tints
 * the cell's emphasis ring and selects the paired corner icon, `message` is the
 * hover tooltip, and `label` (when set) replaces the status icon with custom
 * badge text (`"OT"`). `at` chooses the corner the icon/badge sits in.
 *
 * @property at - Which corner the marker icon / badge sits in ({@link MatrixCornerType})
 * @property status - The semantic status — drives the ring tint + paired corner icon
 * @property message - The marker text surfaced as a hover tooltip
 * @property label - Optional custom badge text that replaces the status icon
 */
export const MatrixMarkerType = StructType({
    at: MatrixCornerType,
    status: StatusValueType,
    message: StringType,
    label: OptionType(StringType),
});

export type MatrixMarkerType = typeof MatrixMarkerType;

// ============================================================================
// Orientation
// ============================================================================

/**
 * How a cell's segment bar is laid out.
 *
 * @property horizontal - Segments flow left-to-right, sized by width
 * @property vertical - Segments stack bottom-to-top, sized by height (capacity bar)
 */
export const MatrixOrientationType = VariantType({
    horizontal: NullType,
    vertical: NullType,
});

export type MatrixOrientationType = typeof MatrixOrientationType;

/** String shorthand for {@link MatrixOrientationType}. */
export type MatrixOrientationLiteral = "horizontal" | "vertical";

// ============================================================================
// Legend entry
// ============================================================================

/**
 * East StructType for one legend swatch — a fill paired with its label.
 *
 * @property fill - The segment fill the swatch shows ({@link MatrixFillType})
 * @property label - The displayed legend label
 */
export const MatrixLegendEntryType = StructType({
    fill: MatrixFillType,
    label: StringType,
});

export type MatrixLegendEntryType = typeof MatrixLegendEntryType;

// ============================================================================
// Callback event payloads
// ============================================================================

/**
 * Event payload for `onCellClick`.
 *
 * @property row - Row key
 * @property column - Column key
 */
export const MatrixCellClickEventType = StructType({
    row: StringType,
    column: StringType,
});

export type MatrixCellClickEventType = typeof MatrixCellClickEventType;

/**
 * Event payload for `onSegmentClick`.
 *
 * @property row - Row key
 * @property column - Column key
 * @property segmentIndex - Index of the clicked segment within the cell (0-based)
 * @property fill - Fill of the clicked segment
 */
export const MatrixSegmentClickEventType = StructType({
    row: StringType,
    column: StringType,
    segmentIndex: IntegerType,
    fill: MatrixFillType,
});

export type MatrixSegmentClickEventType = typeof MatrixSegmentClickEventType;

/**
 * Event payload for `onSegmentChange` — fired when the user drags a segment
 * boundary to a new weight.
 *
 * @property row - Row key
 * @property column - Column key
 * @property segmentIndex - Index of the resized segment within the cell (0-based)
 * @property weight - New weight (post-snap, post-clamp)
 */
export const MatrixSegmentChangeEventType = StructType({
    row: StringType,
    column: StringType,
    segmentIndex: IntegerType,
    weight: FloatType,
});

export type MatrixSegmentChangeEventType = typeof MatrixSegmentChangeEventType;

// ============================================================================
// TypeScript input interfaces (flat JS in — the builders envelope them)
// ============================================================================

/**
 * Flat input for {@link MatrixSegmentType}, built by `Matrix.segment`.
 *
 * @property fill - Fill string shorthand (`"warning"`) or an East variant. Default `"brand"`.
 * @property weight - Proportional weight
 * @property label - Plain string (shorthand for `{ value }`) or a full {@link LabelInput}
 * @property color - Explicit colour override (bypasses `fill`)
 * @property min - Minimum weight for drag-resize
 * @property max - Maximum weight for drag-resize
 * @property step - Snap increment for drag-resize
 */
export interface MatrixSegmentInput {
    /** Fill string shorthand (`"warning"`) or an East variant. Default `"brand"`. */
    fill?: SubtypeExprOrValue<MatrixFillType> | MatrixFillLiteral;
    /** Proportional weight (normalised with sibling segments). */
    weight: SubtypeExprOrValue<FloatType>;
    /** In-bar label. Plain string expands to `{ value }`; or a full {@link LabelInput}. */
    label?: SubtypeExprOrValue<StringType> | LabelInput;
    /** Explicit colour override — bypasses `fill`. Avoid; prefer a fill. */
    color?: SubtypeExprOrValue<StringType>;
    /** Minimum weight for drag-resize (honoured with `onSegmentChange`). */
    min?: SubtypeExprOrValue<FloatType>;
    /** Maximum weight for drag-resize. */
    max?: SubtypeExprOrValue<FloatType>;
    /** Snap increment for drag-resize. */
    step?: SubtypeExprOrValue<FloatType>;
}

/**
 * Flat input for {@link MatrixMarkerType}, built by `Matrix.marker` (the Matrix
 * analogue of `Planner.marker`).
 *
 * @property status - Status string shorthand (`"danger"`) or an East variant. Default `"danger"`.
 * @property message - The marker text surfaced as a hover tooltip
 * @property at - Corner string shorthand (`"tr"`) or an East variant. Default `"tr"`.
 * @property label - Optional custom badge text that replaces the status icon
 */
export interface MatrixMarkerInput {
    /** Status colour string shorthand (`"danger"`) or an East variant. Default `"danger"`. */
    status?: SubtypeExprOrValue<StatusValueType> | StatusValueLiteral;
    /** The marker text surfaced as a hover tooltip. */
    message: SubtypeExprOrValue<StringType>;
    /** Corner string shorthand (`"tr"`) or an East variant. Default `"tr"`. */
    at?: SubtypeExprOrValue<MatrixCornerType> | MatrixCornerLiteral;
    /** Optional custom badge text that replaces the status icon (`"OT"`). */
    label?: SubtypeExprOrValue<StringType>;
}

/**
 * One legend swatch input for `Matrix` config.
 *
 * @property fill - Fill string shorthand or East variant
 * @property label - The displayed label
 */
export interface MatrixLegendEntryInput {
    /** Fill string shorthand (`"brand"`) or an East variant. */
    fill: SubtypeExprOrValue<MatrixFillType> | MatrixFillLiteral;
    /** The displayed legend label. */
    label: SubtypeExprOrValue<StringType>;
}
