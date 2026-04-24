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
    SizeType,
    type SizeLiteral,
} from "../../style.js";

// NOTE: Any Matrix type that references `UIComponentType` (e.g. the
// row header, cell overlays) lives in `collections/matrix/index.ts`,
// alongside the factory. This file stays pure so it can be imported
// from `component.ts` without a circular dependency.

// ============================================================================
// Matrix Cell Overlay Kind / Position
// ============================================================================

/**
 * Overlay kind — describes what the overlay's UIComponent content
 * should look like.
 *
 * @remarks
 * The enum is a hint to the renderer about sizing / spacing: `icon`
 * overlays get a 12–14 px square; `text` overlays inline the text with
 * baseline alignment; `badge` overlays are given a small pill wrapper.
 *
 * @property icon - Icon-shaped overlay (square, 12–14 px)
 * @property text - Plain-text overlay
 * @property badge - Badge-shaped overlay (rounded pill)
 */
export const MatrixCellOverlayKindType = VariantType({
    icon: NullType,
    text: NullType,
    badge: NullType,
});

/** Type alias for MatrixCellOverlayKindType. */
export type MatrixCellOverlayKindType = typeof MatrixCellOverlayKindType;

/** String literal union of overlay kind values. */
export type MatrixCellOverlayKindLiteral = "icon" | "text" | "badge";

/**
 * Overlay position within a cell.
 *
 * @property tl - Top-left corner
 * @property tr - Top-right corner
 * @property bl - Bottom-left corner
 * @property br - Bottom-right corner
 * @property center - Centred
 */
export const MatrixCellOverlayPositionType = VariantType({
    tl: NullType,
    tr: NullType,
    bl: NullType,
    br: NullType,
    center: NullType,
});

/** Type alias for MatrixCellOverlayPositionType. */
export type MatrixCellOverlayPositionType = typeof MatrixCellOverlayPositionType;

/** String literal union of overlay position values. */
export type MatrixCellOverlayPositionLiteral = "tl" | "tr" | "bl" | "br" | "center";

// ============================================================================
// Matrix Cell Segment
// ============================================================================

/**
 * Cell segment — one horizontal slice of a cell's background, inside
 * the flex row. Multiple segments share the cell's horizontal space in
 * proportion to their `value` (like a stacked bar).
 *
 * @property category - Category label (e.g. "committed", "actual")
 * @property value - Numeric weight (share of the horizontal space)
 * @property color - Optional explicit colour override (falls back to the palette)
 */
export const MatrixCellSegmentType = StructType({
    category: StringType,
    value: FloatType,
    color: OptionType(StringType),
});

/** Type alias for MatrixCellSegmentType. */
export type MatrixCellSegmentType = typeof MatrixCellSegmentType;

// ============================================================================
// Matrix Brush Selection
// ============================================================================

/**
 * Rectangular brush-selection coordinate — identifies one cell by
 * its (rowKey, columnKey) pair.
 *
 * @property row - Row key
 * @property column - Column key
 */
export const MatrixBrushCoordType = StructType({
    row: StringType,
    column: StringType,
});

/** Type alias for MatrixBrushCoordType. */
export type MatrixBrushCoordType = typeof MatrixBrushCoordType;

/**
 * Brush-selection state for a Matrix.
 *
 * @remarks
 * When `enabled` is `true` the renderer attaches pointer-down /
 * pointer-move / pointer-up handlers to the grid and emits
 * `onChange([{row, column}, …])` on mouse-up with the cells the
 * rectangle intersects.
 *
 * @property enabled - Whether brush selection is active
 * @property onChange - Callback fired with the selected-cell coordinates
 */
export const MatrixBrushSelectionType = StructType({
    enabled: BooleanType,
    onChange: OptionType(FunctionType([ArrayType(MatrixBrushCoordType)], NullType)),
});

/** Type alias for MatrixBrushSelectionType. */
export type MatrixBrushSelectionType = typeof MatrixBrushSelectionType;

// ============================================================================
// Matrix Legend Position
// ============================================================================

/**
 * Legend position — where the optional legend rail sits relative to
 * the grid.
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

/** Type alias for MatrixLegendPositionType. */
export type MatrixLegendPositionType = typeof MatrixLegendPositionType;

/** String literal union of legend position values. */
export type MatrixLegendPositionLiteral = "top" | "bottom" | "left" | "right";

// ============================================================================
// Matrix Style — visual-only per §0.10
// ============================================================================

/**
 * East StructType holding every visual field for a Matrix.
 *
 * @remarks
 * Visual-only per §0.10. Content (rows / columns / legend), wiring
 * (brushSelection), and behaviour callbacks live on the main `Matrix`
 * variant in `component.ts`.
 *
 * @property size - Size preset (xs / sm / md / lg)
 * @property showGridLines - Whether to draw grid lines between cells
 * @property gridColor - Explicit grid-line colour
 * @property headerBackground - Row / column header background
 * @property headerColor - Row / column header text colour
 * @property cellBackground - Default cell background (fallback when no segments)
 * @property rowHeaderWidth - CSS width of the sticky first column (row header)
 * @property columnHeaderHeight - CSS height of the column header row
 * @property legendPosition - Position of the legend rail (top / bottom / left / right)
 */
export const MatrixStyleType = StructType({
    size: OptionType(SizeType),
    showGridLines: OptionType(BooleanType),
    gridColor: OptionType(StringType),
    headerBackground: OptionType(StringType),
    headerColor: OptionType(StringType),
    cellBackground: OptionType(StringType),
    rowHeaderWidth: OptionType(StringType),
    columnHeaderHeight: OptionType(StringType),
    legendPosition: OptionType(MatrixLegendPositionType),
});

/** Type alias for MatrixStyleType. */
export type MatrixStyleType = typeof MatrixStyleType;

// ============================================================================
// Matrix TS options bag
// ============================================================================

/**
 * TypeScript options bag for `Matrix.Root`.
 *
 * @remarks
 * Pure visual-style options. Main-struct fields (`legend`,
 * `brushSelection`, `onCellClick`, etc.) are explicit positional /
 * named parameters at the index.ts factory level — the options bag
 * here only covers `style` sub-struct fields.
 *
 * @property size - Size preset
 * @property showGridLines - Whether to draw grid lines between cells
 * @property gridColor - Explicit grid-line colour
 * @property headerBackground - Header background colour
 * @property headerColor - Header text colour
 * @property cellBackground - Default cell background
 * @property rowHeaderWidth - Width of the sticky first column
 * @property columnHeaderHeight - Height of the column header row
 * @property legendPosition - Position of the legend rail
 */
export interface MatrixStyle {
    /** Size preset (xs / sm / md / lg). Default `"md"`. */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Whether to draw grid lines between cells. */
    showGridLines?: SubtypeExprOrValue<BooleanType>;
    /** Explicit grid-line colour. */
    gridColor?: SubtypeExprOrValue<StringType>;
    /** Row / column header background. */
    headerBackground?: SubtypeExprOrValue<StringType>;
    /** Row / column header text colour. */
    headerColor?: SubtypeExprOrValue<StringType>;
    /** Default cell background (fallback when no segments). */
    cellBackground?: SubtypeExprOrValue<StringType>;
    /** CSS width of the sticky first column (row header). Default `"180px"`. */
    rowHeaderWidth?: SubtypeExprOrValue<StringType>;
    /** CSS height of the column header row. */
    columnHeaderHeight?: SubtypeExprOrValue<StringType>;
    /** Position of the legend rail. Default `"bottom"`. */
    legendPosition?: SubtypeExprOrValue<MatrixLegendPositionType> | MatrixLegendPositionLiteral;
}
