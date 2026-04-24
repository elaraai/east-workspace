/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    VariantType,
    StringType,
    BooleanType,
    NullType,
    IntegerType,
    FloatType,
    DateTimeType,
    ArrayType,
    FunctionType,
    LiteralValueType,
} from "@elaraai/east";

import {
    ColorSchemeType,
    type ColorSchemeLiteral,
} from "../../style.js";
import {
    DensityType,
    type DensityLiteral,
    StatusTokenType,
} from "../../style/interaction.js";

// ============================================================================
// Table Variant Types
// ============================================================================

/**
 * Table variant type for Chakra UI v3 table styling.
 *
 * @property line - Table with horizontal lines between rows
 * @property outline - Table with full border outline
 */
export const TableVariantType = VariantType({
    line: NullType,
    outline: NullType,
});

export type TableVariantType = typeof TableVariantType;

export type TableVariantLiteral = "line" | "outline";

// ============================================================================
// Table Size Type
// ============================================================================

/**
 * Size options for Table component.
 *
 * @property sm - Small table
 * @property md - Medium table (default)
 * @property lg - Large table
 */
export const TableSizeType = VariantType({
    sm: NullType,
    md: NullType,
    lg: NullType,
});

export type TableSizeType = typeof TableSizeType;

export type TableSizeLiteral = "sm" | "md" | "lg";

// ============================================================================
// Table Selection Mode
// ============================================================================

/**
 * Selection mode for Table rows.
 *
 * @property single - Only one row selected at a time
 * @property multiple - Multiple rows (checkbox model)
 * @property range - Click-drag range selection
 */
export const TableSelectionModeType = VariantType({
    single: NullType,
    multiple: NullType,
    range: NullType,
});

export type TableSelectionModeType = typeof TableSelectionModeType;

export type TableSelectionModeLiteral = "single" | "multiple" | "range";

// ============================================================================
// Primitive East Types
// ============================================================================

export type PrimitiveEastType = BooleanType | IntegerType | FloatType | StringType | DateTimeType;

// ============================================================================
// Table Cell Render Context Type
// ============================================================================

/**
 * Context passed to a column render function at render time.
 *
 * @property rowIndex - The row index (0-based)
 * @property columnKey - The column key
 * @property cellValue - The cell value as a LiteralValueType
 */
export const TableCellRenderContextType = StructType({
    rowIndex: IntegerType,
    columnKey: StringType,
    cellValue: LiteralValueType,
});

export type TableCellRenderContextType = typeof TableCellRenderContextType;

// ============================================================================
// Table Callback Event Types
// ============================================================================

/**
 * Event data for table cell click.
 *
 * @property rowIndex - The row index (0-based)
 * @property columnKey - The column key
 * @property cellValue - The cell value as a LiteralValueType
 */
export const TableCellClickEventType = StructType({
    rowIndex: IntegerType,
    columnKey: StringType,
    cellValue: LiteralValueType,
});

export type TableCellClickEventType = typeof TableCellClickEventType;

/**
 * Event data for table row click.
 *
 * @property rowIndex - The row index (0-based)
 */
export const TableRowClickEventType = StructType({
    rowIndex: IntegerType,
});

export type TableRowClickEventType = typeof TableRowClickEventType;

/**
 * Event data for table row selection changes.
 *
 * @property rowIndex - The row index (0-based) that triggered the change
 * @property selected - Whether the row is now selected
 * @property selectedRowsIndices - Full array of currently selected row indices
 */
export const TableRowSelectionEventType = StructType({
    rowIndex: IntegerType,
    selected: BooleanType,
    selectedRowsIndices: ArrayType(IntegerType),
});

export type TableRowSelectionEventType = typeof TableRowSelectionEventType;

/**
 * Sort direction for table column.
 *
 * @property asc - Ascending sort
 * @property desc - Descending sort
 */
export const TableSortDirectionType = VariantType({
    asc: NullType,
    desc: NullType,
});

export type TableSortDirectionType = typeof TableSortDirectionType;

/**
 * Event data for table sort changes.
 *
 * @property columnKey - The column key being sorted
 * @property sortIndex - The sort index (for multi-column sorting)
 * @property sortDirection - The sort direction
 */
export const TableSortEventType = StructType({
    columnKey: StringType,
    sortIndex: IntegerType,
    sortDirection: TableSortDirectionType,
});

export type TableSortEventType = typeof TableSortEventType;

// ============================================================================
// Table Column Group Type
// ============================================================================

/**
 * Column-group definition — renders a grouping row above the column headers.
 *
 * @property label - Group heading text
 * @property columnKeys - Array of column keys covered by the group
 */
export const TableColumnGroupType = StructType({
    label: StringType,
    columnKeys: ArrayType(StringType),
});

export type TableColumnGroupType = typeof TableColumnGroupType;

// NOTE: The footer-cell type references `UIComponentType` (via
// `content: OptionType(UIComponentType)`) so it lives in
// `collections/table/index.ts` as `TableFooterCellType`, alongside the
// `TableFooterCellInput` TypeScript options interface. The inline
// `Table` variant in `component.ts` defines the same shape using
// `node` for content.

// ============================================================================
// Table Pagination Type (embedded)
// ============================================================================

/**
 * Embedded pagination state for a Table.
 *
 * @remarks
 * Distinct from the standalone `Pagination` primitive — this struct
 * lives on the main `Table` variant so the Table renderer owns the
 * visual layout. Consumers use the standalone `Pagination.Root`
 * primitive for out-of-Table use.
 *
 * @property pageSize - Items per page
 * @property page - Current 0-based page index
 * @property onPageChange - Callback fired with the new 0-based page index
 */
export const TablePaginationType = StructType({
    pageSize: IntegerType,
    page: IntegerType,
    onPageChange: FunctionType([IntegerType], NullType),
});

export type TablePaginationType = typeof TablePaginationType;

// ============================================================================
// Table Selection Type
// ============================================================================

/**
 * Row-selection state for a Table.
 *
 * @property mode - Selection mode (single / multiple / range)
 * @property selected - Currently selected row indices
 * @property onChange - Callback fired with the new selected row indices
 */
export const TableSelectionType = StructType({
    mode: TableSelectionModeType,
    selected: ArrayType(IntegerType),
    onChange: FunctionType([ArrayType(IntegerType)], NullType),
});

export type TableSelectionType = typeof TableSelectionType;

// ============================================================================
// Table Style Type — visual-only per §0.10
// ============================================================================

/**
 * Style type for the table root component — visual-only per §0.10.
 *
 * @remarks
 * Interactive wiring (`interactive`) and all callbacks are on the main
 * `Table` variant in `component.ts`. This struct only carries visual
 * fields.
 *
 * @property height - CSS height for the table container
 * @property variant - Table variant (line or outline)
 * @property size - Table size (sm / md / lg)
 * @property striped - Zebra-stripe rows
 * @property stickyHeader - Sticky header row
 * @property stickyFirstColumn - Pin the first column while scrolling horizontally
 * @property showColumnBorder - Borders between columns
 * @property colorPalette - Color scheme for hover / selection
 * @property headerBackground - Explicit header background
 * @property headerColor - Explicit header text colour
 * @property borderColor - Explicit border colour
 * @property zebraBackground - Explicit background for zebra-striped rows
 * @property hoverBackground - Explicit hover background
 * @property selectedBackground - Explicit background for selected rows
 * @property selectedBorderColor - Explicit border colour for selected rows
 * @property footerBackground - Explicit background for the footer row
 */
export const TableStyleType = StructType({
    height: OptionType(StringType),
    variant: OptionType(TableVariantType),
    size: OptionType(TableSizeType),
    striped: OptionType(BooleanType),
    stickyHeader: OptionType(BooleanType),
    stickyFirstColumn: OptionType(BooleanType),
    showColumnBorder: OptionType(BooleanType),
    colorPalette: OptionType(ColorSchemeType),
    headerBackground: OptionType(StringType),
    headerColor: OptionType(StringType),
    borderColor: OptionType(StringType),
    zebraBackground: OptionType(StringType),
    hoverBackground: OptionType(StringType),
    selectedBackground: OptionType(StringType),
    selectedBorderColor: OptionType(StringType),
    footerBackground: OptionType(StringType),
});

export type TableStyleType = typeof TableStyleType;

/**
 * TypeScript interface for table construction options.
 *
 * @remarks
 * Flat options bag. The factory splits into main-struct (content /
 * state / callbacks / wiring) and `style` sub-struct (visual-only).
 *
 * @property frozen - Column keys to freeze (pin left)
 * @property height - CSS height
 * @property variant - Table variant — visual
 * @property size - Table size — visual
 * @property striped - Zebra stripes — visual
 * @property stickyHeader - Sticky header — visual
 * @property stickyFirstColumn - Pin first column — visual
 * @property showColumnBorder - Column borders — visual
 * @property colorPalette - Colour scheme — visual
 * @property headerBackground - Header background — visual
 * @property headerColor - Header text colour — visual
 * @property borderColor - Border colour — visual
 * @property zebraBackground - Zebra row background — visual
 * @property hoverBackground - Hover row background — visual
 * @property selectedBackground - Selected row background — visual
 * @property selectedBorderColor - Selected row border — visual
 * @property footerBackground - Footer row background — visual
 * @property interactive - Row hover highlight — main
 * @property columnResize - Enable column resize — main
 * @property virtualization - Enable row virtualization (lazy TanStack Virtual) — main
 * @property density - Density preset — main
 * @property onCellClick - Cell click callback — main
 * @property onCellDoubleClick - Cell double-click callback — main
 * @property onRowClick - Row click callback — main
 * @property onRowDoubleClick - Row double-click callback — main
 * @property onRowSelectionChange - Row selection change callback — main
 * @property onSortChange - Sort change callback — main
 */
export interface TableStyle<ColumnKeys extends string = string> {
    /** Column keys to freeze (pin left). Frozen columns appear first and stay visible during horizontal scroll. */
    frozen?: ColumnKeys[];
    /** CSS height for the table container (e.g., "500px", "100%") */
    height?: SubtypeExprOrValue<StringType>;
    /** Table variant (line or outline) */
    variant?: SubtypeExprOrValue<TableVariantType> | TableVariantLiteral;
    /** Table size (sm, md, lg) */
    size?: SubtypeExprOrValue<TableSizeType> | TableSizeLiteral;
    /** Whether to show zebra stripes on rows */
    striped?: SubtypeExprOrValue<BooleanType>;
    /** Whether to highlight rows on hover (main-struct — forwarded by factory). */
    interactive?: SubtypeExprOrValue<BooleanType>;
    /** Whether the header sticks when scrolling */
    stickyHeader?: SubtypeExprOrValue<BooleanType>;
    /** Pin the first column while scrolling horizontally. */
    stickyFirstColumn?: SubtypeExprOrValue<BooleanType>;
    /** Whether to show borders between columns */
    showColumnBorder?: SubtypeExprOrValue<BooleanType>;
    /** Color scheme for hover / selection */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Explicit header background. */
    headerBackground?: SubtypeExprOrValue<StringType>;
    /** Explicit header text colour. */
    headerColor?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour. */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Explicit zebra row background. */
    zebraBackground?: SubtypeExprOrValue<StringType>;
    /** Explicit hover row background. */
    hoverBackground?: SubtypeExprOrValue<StringType>;
    /** Explicit selected row background. */
    selectedBackground?: SubtypeExprOrValue<StringType>;
    /** Explicit selected row border colour. */
    selectedBorderColor?: SubtypeExprOrValue<StringType>;
    /** Explicit footer row background. */
    footerBackground?: SubtypeExprOrValue<StringType>;
    /** Enable column resize via the header drag handle. */
    columnResize?: SubtypeExprOrValue<BooleanType>;
    /** Enable row virtualization (lazy-loads TanStack Virtual). */
    virtualization?: SubtypeExprOrValue<BooleanType>;
    /** Callback triggered when a cell is clicked */
    onCellClick?: SubtypeExprOrValue<FunctionType<[TableCellClickEventType], NullType>>;
    /** Callback triggered when a cell is double-clicked */
    onCellDoubleClick?: SubtypeExprOrValue<FunctionType<[TableCellClickEventType], NullType>>;
    /** Callback triggered when a row is clicked */
    onRowClick?: SubtypeExprOrValue<FunctionType<[TableRowClickEventType], NullType>>;
    /** Callback triggered when a row is double-clicked */
    onRowDoubleClick?: SubtypeExprOrValue<FunctionType<[TableRowClickEventType], NullType>>;
    /** Callback triggered when row selection changes */
    onRowSelectionChange?: SubtypeExprOrValue<FunctionType<[TableRowSelectionEventType], NullType>>;
    /** Callback triggered when sort column/direction changes */
    onSortChange?: SubtypeExprOrValue<FunctionType<[TableSortEventType], NullType>>;
    /** `(rowIndex) => StatusToken` — row-status tint callback. */
    rowStatus?: SubtypeExprOrValue<FunctionType<[IntegerType], StatusTokenType>>;
    /** Density preset. */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
}
