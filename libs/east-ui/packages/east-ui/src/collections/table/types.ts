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
    DictType,
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
import { PlotGutterType, type PlotGutter } from "../../shared/plot-gutter.js";
// Type-only (erased at runtime — safe against the component.ts import cycle).
import type { ApprovalStateType, ReviewConfig, RowRefType } from "../../contracts/review.js";
import type { StatusValueType } from "../../feedback/status/types.js";

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
// Nested rows (#954)
// ============================================================================

/**
 * The subtotal a column shows on a PARENT row (#954) — composed bottom-up
 * over what the parent's children show: a leaf child its own value, a parent
 * child its own subtotal.
 *
 * @property sum - The sum of the children's values (Integer / Float columns)
 * @property mean - The mean of the children's values — a mean of means where children are parents (Integer / Float columns)
 * @property min - The least of the children's values (native ordering)
 * @property max - The greatest of the children's values (native ordering)
 * @property count - How many leaf rows lie beneath the parent (a leaf child counts 1, a parent child its own count)
 */
export const TableAggregateType = VariantType({
    sum: NullType,
    mean: NullType,
    min: NullType,
    max: NullType,
    count: NullType,
});

export type TableAggregateType = typeof TableAggregateType;

/** String-literal shorthand for {@link TableAggregateType}. */
export type TableAggregateLiteral = "sum" | "mean" | "min" | "max" | "count";

const TableRowTypeImpl = StructType({
    cells: DictType(StringType, LiteralValueType),
    depth: IntegerType,
    collapsed: BooleanType,
});
type TableRowTypeImpl = typeof TableRowTypeImpl;

/**
 * One row of a Table as the renderer receives it (#954) — the row's cells,
 * and where it sits in the data's tree.
 *
 * @remarks
 * A Table's rows arrive in PRE-ORDER: each parent, then its subtree — the
 * rows after it with a greater `depth`, up to the next row at its depth or
 * shallower. A flat table's rows are all at depth 0. A row's position in
 * this order is its `rowIndex`, the index every row reference carries.
 *
 * Declared through an interface: the Table arm of `UIComponentType` spells
 * this type, and a structural type there would serialize into every
 * declaration that names the component (the `TickFormatType` rule, #874).
 *
 * @property cells - The row's cells by column key (sortable primitives)
 * @property depth - How deep the row sits — 0 for a top-level row
 * @property collapsed - Whether the row starts collapsed (a parent's; a leaf's is false)
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface TableRowType extends TableRowTypeImpl {}

/** One row of a Table as the renderer receives it — see the interface above. */
export const TableRowType: TableRowType = TableRowTypeImpl;

/**
 * The Table's own row COLLECTION — its rows in pre-order (#954).
 *
 * @remarks
 * Table is POSITIONAL: its rows have no identity field, so the collection is
 * an `Array` and a row is addressed by its index in it. That is the
 * counterpart to the Plan's keyed row stream (#568), and the reason the
 * row-source contract is parameterised on the COLLECTION rather than the row
 * (#576) — one vocabulary, two differently-shaped components. A paged source
 * pages the author's TOP-LEVEL rows, each with its whole subtree, and each
 * window arrives flattened to this collection.
 */
export const TableRowsCollectionType = ArrayType(TableRowType);
/** Type alias for {@link TableRowsCollectionType}. */
export type TableRowsCollectionType = typeof TableRowsCollectionType;


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
 * @remarks
 * `rowIndex` is the row's position in the data's pre-order walk (#954) — a
 * parent, then its subtree; for a flat table, its index in the data. `path`
 * leads to the row through the tree: `[i]` for the i-th top-level row, `[i, j]`
 * for its j-th child. A parent's cell in a `sum` / `mean` / `min` / `max`
 * column carries its subtotal as `cellValue` (a `mean` is a Float); a `count`
 * prints itself, and no render sees it.
 *
 * @property rowIndex - The row's pre-order index
 * @property path - The row's path — its index among its siblings at each depth
 * @property columnKey - The column key
 * @property cellValue - The cell value as a LiteralValueType
 */
export const TableCellRenderContextType = StructType({
    rowIndex: IntegerType,
    path: ArrayType(IntegerType),
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
 * @property rowIndex - The row's pre-order index (its index in the data, for a flat table)
 * @property path - The row's path — its index among its siblings at each depth
 * @property columnKey - The column key
 * @property cellValue - The cell value as a LiteralValueType (a parent's subtotal in an `aggregate` column)
 */
export const TableCellClickEventType = StructType({
    rowIndex: IntegerType,
    path: ArrayType(IntegerType),
    columnKey: StringType,
    cellValue: LiteralValueType,
});

export type TableCellClickEventType = typeof TableCellClickEventType;

/**
 * Event data for table row click.
 *
 * @property rowIndex - The row's pre-order index (its index in the data, for a flat table)
 * @property path - The row's path — its index among its siblings at each depth
 */
export const TableRowClickEventType = StructType({
    rowIndex: IntegerType,
    path: ArrayType(IntegerType),
});

export type TableRowClickEventType = typeof TableRowClickEventType;

/**
 * Event data for table row selection changes.
 *
 * @property rowIndex - The pre-order index of the row that changed
 * @property path - That row's path — its index among its siblings at each depth
 * @property selected - Whether the row is now selected
 * @property selectedRowsIndices - Every selected row's pre-order index
 */
export const TableRowSelectionEventType = StructType({
    rowIndex: IntegerType,
    path: ArrayType(IntegerType),
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
 * @property selected - The selected rows' pre-order indices (#954)
 * @property onChange - Callback fired with the new selected rows' pre-order indices
 */
export const TableSelectionType = StructType({
    mode: TableSelectionModeType,
    selected: ArrayType(IntegerType),
    onChange: FunctionType([ArrayType(IntegerType)], NullType),
});

export type TableSelectionType = typeof TableSelectionType;

// ============================================================================
// Table Style Type — visual-only
// ============================================================================

/**
 * Style type for the table root component — visual-only.
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
    maxHeight: OptionType(StringType),
    variant: OptionType(TableVariantType),
    size: OptionType(TableSizeType),
    striped: OptionType(BooleanType),
    stickyHeader: OptionType(BooleanType),
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
    rowHeight: OptionType(IntegerType),
    plotGutter: OptionType(PlotGutterType),
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
    /** Uniform sizing (#320): bound the table — a pixel `number`, `"fill"` (fill the parent box; the parent must have a definite height), or a CSS length (`"500px"`, `"100%"`). Chrome-inclusive; the rows scroll within. */
    height?: SubtypeExprOrValue<StringType>;
    /** Uniform sizing (#320): max-height cap — a pixel `number` or CSS length; the table is content-sized up to it, then scrolls. */
    maxHeight?: SubtypeExprOrValue<StringType>;
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
    /** `(rowIndex) => StatusToken` — the row's tint, by its pre-order index (#954), so it stays with the row under sorting and pagination. */
    rowStatus?: SubtypeExprOrValue<FunctionType<[IntegerType], StatusTokenType>>;
    /** Optional review chrome (#264) — the shared contract's per-row
     *  Approve/Reject Decision column (pinned right) + commitBar batch foot,
     *  identical to the Planner's. Presence is the opt-in. Callbacks receive
     *  `{ rowIndex }` — the row's pre-order index (#954), stable under sorting
     *  AND pagination (the `expandedContent` convention). */
    review?: ReviewConfig<RowRefType>;
    /** `(rowIndex) => Option<StatusValue>` — the review chrome's quiet per-row
     *  dot (some ⇒ flagged, none ⇒ clean), over the row's pre-order index. Only
     *  rendered when `review` is set. */
    reviewStatus?: SubtypeExprOrValue<FunctionType<[IntegerType], OptionType<StatusValueType>>>;
    /** `(rowIndex) => Option<ApprovalState>` — the row's review decision
     *  (see the shared `deriveApproval` helper: clean ⇒ approved, flagged ⇒
     *  pending), over the row's pre-order index. Only rendered when `review` is
     *  set. */
    reviewApproval?: SubtypeExprOrValue<FunctionType<[IntegerType], OptionType<ApprovalStateType>>>;
    /** Density preset. */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Explicit pixel row height. Overrides the `density` preset when set, and is fed to the virtualizer so scroll offsets stay correct. */
    rowHeight?: SubtypeExprOrValue<IntegerType>;
    /** Shared plot gutter (#147) — pins the data columns to `[left, W−right]` (px) so a Table stacked under a Chart lines up on shared categories; the frozen columns fill `left`. */
    plotGutter?: PlotGutter;
}
