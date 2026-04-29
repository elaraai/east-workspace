/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    ArrayType,
    BooleanType,
    FloatType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import {
    LabelInputType,
    SizeType,
    type SizeLiteral,
} from "../../style.js";

// NOTE: Any Matrix type that references `UIComponentType` (row header,
// column header, cell tooltip, cell overlay content) lives in
// `collections/matrix/index.ts`, alongside the factory. This file
// stays UIComp-free so it can be imported from `component.ts` without
// a circular dependency.

// Re-export shared `AlignType` under the historical Matrix name so
// existing call sites continue to work.
export { AlignType, type AlignLiteral } from "../../style.js";

// ============================================================================
// Cell segment
// ============================================================================

/**
 * East StructType for a single horizontal slice of a cell's fill.
 *
 * @remarks
 * Segments are weighted — the renderer normalizes so `Σ weight = 100%`
 * of the cell's horizontal space. `min` / `max` / `step` are resize
 * constraints honoured by the renderer only when the Matrix has an
 * `onSegmentChange` callback on main (segment handles are shown).
 *
 * Per-segment label: when `label` is set, the renderer paints the
 * label's `value` text inside the segment using the shared
 * {@link LabelInputType} alignment + typography fields. The Matrix's
 * `style.segmentLabelColor` / `segmentLabelFontSize` /
 * `segmentLabelFontWeight` / `minLabelSize` act as cascading defaults.
 *
 * @property category - Category name (matches the legend entry)
 * @property weight - Proportional weight (normalized with sibling segments)
 * @property color - Optional explicit swatch colour
 * @property label - Optional rich label (text + alignment + typography)
 * @property min - Optional minimum weight for resize
 * @property max - Optional maximum weight for resize
 * @property step - Optional snap increment for resize
 */
export const MatrixCellSegmentType = StructType({
    category: StringType,
    weight: FloatType,
    color: OptionType(StringType),
    label: OptionType(LabelInputType),
    min: OptionType(FloatType),
    max: OptionType(FloatType),
    step: OptionType(FloatType),
});

export type MatrixCellSegmentType = typeof MatrixCellSegmentType;

// ============================================================================
// Brush-selection types
// ============================================================================

/**
 * Rectangular brush-selection coordinate.
 *
 * @property row - Row key
 * @property column - Column key
 */
export const MatrixBrushCoordType = StructType({
    row: StringType,
    column: StringType,
});

export type MatrixBrushCoordType = typeof MatrixBrushCoordType;

/**
 * Brush-selection state.
 *
 * @remarks
 * Controlled-component pattern: `selected` is the source of truth;
 * the renderer reflects it and emits `onChange` when the user drags
 * a new selection on mouse-up.
 *
 * @property enabled - Whether brush selection is active
 * @property selected - Currently-selected cell coordinates
 * @property onChange - Callback fired with the new selected set
 */
export const MatrixBrushSelectionType = StructType({
    enabled: BooleanType,
    selected: OptionType(ArrayType(MatrixBrushCoordType)),
    onChange: OptionType(FunctionType([ArrayType(MatrixBrushCoordType)], NullType)),
});

export type MatrixBrushSelectionType = typeof MatrixBrushSelectionType;

// ============================================================================
// Legend position
// ============================================================================

/**
 * Legend position — where the legend rail sits relative to the grid.
 *
 * @property top - Above the grid
 * @property bottom - Below the grid (default)
 * @property left - To the left of the grid
 * @property right - To the right of the grid
 */
export const MatrixLegendPositionType = VariantType({
    top: NullType,
    bottom: NullType,
    left: NullType,
    right: NullType,
});

export type MatrixLegendPositionType = typeof MatrixLegendPositionType;

export type MatrixLegendPositionLiteral = "top" | "bottom" | "left" | "right";

// ============================================================================
// Cell orientation
// ============================================================================

/**
 * Cell orientation — how segments stack inside a cell.
 *
 * @remarks
 * `horizontal` (default): segments stack left-to-right, each sized by
 * `weight`. `vertical`: segments stack bottom-to-top, so each cell
 * reads like a stacked vertical bar (utilization / capacity
 * dashboards).
 *
 * @property horizontal - Segments flow left-to-right
 * @property vertical - Segments flow bottom-to-top (stacked vertical bar)
 */
export const MatrixCellOrientationType = VariantType({
    horizontal: NullType,
    vertical: NullType,
});

export type MatrixCellOrientationType = typeof MatrixCellOrientationType;

export type MatrixCellOrientationLiteral = "horizontal" | "vertical";

// ============================================================================
// Segment-change callback event (on main — declared here so `component.ts` can reference it)
// ============================================================================

/**
 * Event payload for `onSegmentChange` — fired when a user drags the
 * trailing edge of a segment to a new weight.
 *
 * @property row - Row key
 * @property column - Column key
 * @property category - Category of the resized segment
 * @property weight - New weight (post-snap, post-clamp)
 */
export const MatrixSegmentChangeEventType = StructType({
    row: StringType,
    column: StringType,
    category: StringType,
    weight: FloatType,
});

export type MatrixSegmentChangeEventType = typeof MatrixSegmentChangeEventType;

/**
 * Event payload for `onSegmentClick` — fired when the user clicks a
 * specific segment within a cell.
 *
 * @property row - Row key
 * @property column - Column key
 * @property category - Category of the clicked segment
 */
export const MatrixSegmentClickEventType = StructType({
    row: StringType,
    column: StringType,
    category: StringType,
});

export type MatrixSegmentClickEventType = typeof MatrixSegmentClickEventType;

// ============================================================================
// Style — visual-only
// ============================================================================

/**
 * East StructType holding every visual field for a Matrix.
 *
 * @remarks
 * Visual-only. Content (rows / columns / legend), wiring
 * (brushSelection), and behaviour callbacks live on the main `Matrix`
 * variant in `component.ts`.
 *
 * @property size - Size preset (xs / sm / md / lg)
 * @property showGridLines - Whether to draw grid lines between cells (default false — gutter style)
 * @property gridColor - Explicit grid-line / gutter colour
 * @property headerBackground - Row / column header background
 * @property headerColor - Row / column header text colour
 * @property cellBackground - Default cell background (fallback when no segments)
 * @property cellBorderRadius - Cell corner radius (default `"2px"` for a subtle modern feel)
 * @property rowHeaderWidth - CSS width of the sticky first column
 * @property columnHeaderHeight - CSS height of the column header row
 * @property legendPosition - Position of the legend rail
 * @property emphasisColor - Default ring colour for emphasized cells
 * @property selectedBackground - Background for brush-selected cells
 * @property selectedBorderColor - Ring colour for brush-selected cells
 * @property hoverHighlightColor - Background for cross-highlight on hovered row / column headers
 * @property segmentLabelColor - Default text colour for per-segment labels (default `"white"`); per-segment `label.color` overrides
 * @property segmentLabelFontSize - Default CSS font-size for per-segment labels (default `"0.75rem"`); per-segment `label.fontSize` overrides
 * @property segmentLabelFontWeight - Default CSS font-weight for per-segment labels (default `"600"`); per-segment `label.fontWeight` overrides
 * @property minLabelSize - Minimum rendered segment width (CSS) below which the label is hidden — avoids clipped text on tiny slices. Default `"24px"`.
 */
export const MatrixStyleType = StructType({
    size: OptionType(SizeType),
    showGridLines: OptionType(BooleanType),
    gridColor: OptionType(StringType),
    headerBackground: OptionType(StringType),
    headerColor: OptionType(StringType),
    cellBackground: OptionType(StringType),
    cellBorderRadius: OptionType(StringType),
    rowHeaderWidth: OptionType(StringType),
    columnHeaderHeight: OptionType(StringType),
    legendPosition: OptionType(MatrixLegendPositionType),
    emphasisColor: OptionType(StringType),
    selectedBackground: OptionType(StringType),
    selectedBorderColor: OptionType(StringType),
    hoverHighlightColor: OptionType(StringType),
    cellOrientation: OptionType(MatrixCellOrientationType),
    segmentLabelColor: OptionType(StringType),
    segmentLabelFontSize: OptionType(StringType),
    segmentLabelFontWeight: OptionType(StringType),
    minLabelSize: OptionType(StringType),
});

export type MatrixStyleType = typeof MatrixStyleType;

// ============================================================================
// Style TS options
// ============================================================================

/**
 * TypeScript options bag for `Matrix.Root` (visual-only).
 *
 * @remarks
 * Main-struct fields (legend / brushSelection / callbacks) live in the
 * extended `MatrixOptions` interface in `collections/matrix/index.ts`.
 */
export interface MatrixStyle {
    /** Size preset (xs / sm / md / lg). Default `"md"`. */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Whether to draw grid lines between cells. Default false (gutter style). */
    showGridLines?: SubtypeExprOrValue<BooleanType>;
    /** Explicit grid-line / gutter colour. */
    gridColor?: SubtypeExprOrValue<StringType>;
    /** Row / column header background. */
    headerBackground?: SubtypeExprOrValue<StringType>;
    /** Row / column header text colour. */
    headerColor?: SubtypeExprOrValue<StringType>;
    /** Default cell background (fallback when no segments). */
    cellBackground?: SubtypeExprOrValue<StringType>;
    /** Cell corner radius. Default `"2px"` for a subtle modern feel. */
    cellBorderRadius?: SubtypeExprOrValue<StringType>;
    /** CSS width of the sticky first column. Default `"180px"`. */
    rowHeaderWidth?: SubtypeExprOrValue<StringType>;
    /** CSS height of the column header row. */
    columnHeaderHeight?: SubtypeExprOrValue<StringType>;
    /** Position of the legend rail. Default `"bottom"`. */
    legendPosition?: SubtypeExprOrValue<MatrixLegendPositionType> | MatrixLegendPositionLiteral;
    /** Default ring colour for emphasized cells (overridden per-cell by `emphasisColor`). */
    emphasisColor?: SubtypeExprOrValue<StringType>;
    /** Background applied to brush-selected cells. */
    selectedBackground?: SubtypeExprOrValue<StringType>;
    /** Ring colour applied to brush-selected cells. */
    selectedBorderColor?: SubtypeExprOrValue<StringType>;
    /** Background applied to hovered row / column headers (cross-highlight). */
    hoverHighlightColor?: SubtypeExprOrValue<StringType>;
    /** Cell segment orientation. Default `"horizontal"`. `"vertical"` stacks segments bottom-up (capacity bars). */
    cellOrientation?: SubtypeExprOrValue<MatrixCellOrientationType> | MatrixCellOrientationLiteral;
    /** Default text colour for per-segment labels. Default `"white"`. Per-segment `label.color` overrides. */
    segmentLabelColor?: SubtypeExprOrValue<StringType>;
    /** Default CSS `font-size` for per-segment labels. Default `"0.75rem"`. Per-segment `label.fontSize` overrides. */
    segmentLabelFontSize?: SubtypeExprOrValue<StringType>;
    /** Default CSS `font-weight` for per-segment labels. Default `"600"`. Per-segment `label.fontWeight` overrides. */
    segmentLabelFontWeight?: SubtypeExprOrValue<StringType>;
    /**
     * Minimum rendered segment width (CSS) below which the label is hidden
     * — avoids clipped text on tiny slices. Default `"24px"`. Set `"0"` to
     * always render labels regardless of segment size.
     */
    minLabelSize?: SubtypeExprOrValue<StringType>;
}
