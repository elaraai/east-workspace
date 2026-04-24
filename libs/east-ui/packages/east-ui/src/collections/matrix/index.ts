/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    BooleanType,
    FloatType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import {
    MatrixCellOverlayKindType,
    MatrixCellOverlayPositionType,
    MatrixCellSegmentType,
    MatrixBrushCoordType,
    MatrixBrushSelectionType,
    MatrixLegendPositionType,
    MatrixStyleType,
    type MatrixStyle,
    type MatrixCellOverlayKindLiteral,
    type MatrixCellOverlayPositionLiteral,
} from "./types.js";

export {
    MatrixCellOverlayKindType,
    MatrixCellOverlayPositionType,
    MatrixCellSegmentType,
    MatrixBrushCoordType,
    MatrixBrushSelectionType,
    MatrixLegendPositionType,
    MatrixStyleType,
    type MatrixStyle,
    type MatrixCellOverlayKindLiteral,
    type MatrixCellOverlayPositionLiteral,
    type MatrixLegendPositionLiteral,
} from "./types.js";

// ============================================================================
// Cell Overlay (UIComp-coupled — lives in index.ts)
// ============================================================================

/**
 * East StructType for a cell overlay.
 *
 * @remarks
 * Overlays are small pieces of rich content rendered at one of five
 * positions (top-left / top-right / bottom-left / bottom-right /
 * center) over a cell's segment background. The `kind` field hints to
 * the renderer about sizing; the `content` is a full UIComponent.
 *
 * @property kind - Overlay kind (icon / text / badge)
 * @property content - Overlay content (UIComponent)
 * @property position - Position within the cell
 */
export const MatrixCellOverlayType = StructType({
    kind: MatrixCellOverlayKindType,
    content: UIComponentType,
    position: MatrixCellOverlayPositionType,
});

/** Type alias for MatrixCellOverlayType. */
export type MatrixCellOverlayType = typeof MatrixCellOverlayType;

// ============================================================================
// Cell
// ============================================================================

/**
 * East StructType for a matrix cell.
 *
 * @remarks
 * Cells are keyed by `columnKey` within a row. Segments render as a
 * horizontal stack proportional to each segment's `value`. Overlays
 * are positioned around the segment fill. `emphasis` toggles a
 * highlight ring; `emphasisColor` overrides the ring colour.
 *
 * @property columnKey - Column key (matches the Matrix's columns)
 * @property segments - Horizontal segments (stacked bar per cell)
 * @property overlays - Overlay annotations at cell corners / center
 * @property emphasis - Highlight flag (draws a ring)
 * @property emphasisColor - Ring colour override
 * @property note - Optional text note (shown on hover / in a11y tree)
 */
export const MatrixCellType = StructType({
    columnKey: StringType,
    segments: ArrayType(MatrixCellSegmentType),
    overlays: ArrayType(MatrixCellOverlayType),
    emphasis: OptionType(BooleanType),
    emphasisColor: OptionType(StringType),
    note: OptionType(StringType),
});

/** Type alias for MatrixCellType. */
export type MatrixCellType = typeof MatrixCellType;

// ============================================================================
// Row / Column
// ============================================================================

/**
 * East StructType for a matrix row.
 *
 * @remarks
 * Each row has a string key (used as part of `cellId =
 * "{rowKey}:{columnKey}"`), an optional rich header (UIComp — e.g. a
 * name + avatar compound), and its cells.
 *
 * @property key - Unique row key
 * @property header - Optional rich header (UIComponent)
 * @property cells - Cell values in this row
 */
export const MatrixRowType = StructType({
    key: StringType,
    header: OptionType(UIComponentType),
    cells: ArrayType(MatrixCellType),
});

/** Type alias for MatrixRowType. */
export type MatrixRowType = typeof MatrixRowType;

/**
 * East StructType for a matrix column definition.
 *
 * @remarks
 * Column key is referenced by `MatrixCell.columnKey`. The header can
 * be a rich UIComponent (e.g. a label with a sub-label or sort icon).
 *
 * @property key - Unique column key
 * @property header - Optional rich header (UIComponent)
 */
export const MatrixColumnType = StructType({
    key: StringType,
    header: OptionType(UIComponentType),
});

/** Type alias for MatrixColumnType. */
export type MatrixColumnType = typeof MatrixColumnType;

// ============================================================================
// Legend entry
// ============================================================================

/**
 * East StructType for a legend entry.
 *
 * @remarks
 * Legend entries explain the colour-to-category mapping of cell
 * segments. The renderer draws them in the legend rail below /
 * above / beside the grid.
 *
 * @property category - Category name (matches `MatrixCellSegment.category`)
 * @property color - Legend swatch colour
 * @property label - Optional human-readable label (defaults to `category`)
 */
export const MatrixLegendEntryType = StructType({
    category: StringType,
    color: StringType,
    label: OptionType(StringType),
});

/** Type alias for MatrixLegendEntryType. */
export type MatrixLegendEntryType = typeof MatrixLegendEntryType;

// ============================================================================
// Root
// ============================================================================

/**
 * Standalone East StructType mirror of the inline `Matrix` variant in
 * `component.ts`.
 *
 * @remarks
 * Per §0.10, main carries content (`rows` / `columns` / `legend`),
 * wiring (`brushSelection`), and callbacks (`onCellClick`); `style`
 * carries visual fields only.
 *
 * @property rows - Row definitions
 * @property columns - Column definitions
 * @property legend - Optional legend entries
 * @property brushSelection - Optional brush-selection state
 * @property onCellClick - Optional cell-click callback
 * @property style - Optional visual style sub-struct
 */
export const MatrixRootType: StructType<{
    rows: ArrayType<MatrixRowType>,
    columns: ArrayType<MatrixColumnType>,
    legend: OptionType<ArrayType<MatrixLegendEntryType>>,
    brushSelection: OptionType<MatrixBrushSelectionType>,
    onCellClick: OptionType<FunctionType<[MatrixBrushCoordType], NullType>>,
    style: OptionType<MatrixStyleType>,
}> = StructType({
    rows: ArrayType(MatrixRowType),
    columns: ArrayType(MatrixColumnType),
    legend: OptionType(ArrayType(MatrixLegendEntryType)),
    brushSelection: OptionType(MatrixBrushSelectionType),
    onCellClick: OptionType(FunctionType([MatrixBrushCoordType], NullType)),
    style: OptionType(MatrixStyleType),
});

/** Type alias for MatrixRootType. */
export type MatrixRootType = typeof MatrixRootType;

// ============================================================================
// TypeScript input interfaces
// ============================================================================

/**
 * TypeScript input for a cell segment.
 *
 * @property category - Category name
 * @property value - Proportional weight
 * @property color - Optional explicit colour override
 */
export interface MatrixCellSegmentInput {
    category: SubtypeExprOrValue<StringType>;
    value: SubtypeExprOrValue<FloatType>;
    color?: SubtypeExprOrValue<StringType>;
}

/**
 * TypeScript input for a cell overlay.
 *
 * @property kind - Overlay kind (`"icon"` / `"text"` / `"badge"`)
 * @property content - Overlay content (UIComponent)
 * @property position - Position (`"tl"` / `"tr"` / `"bl"` / `"br"` / `"center"`)
 */
export interface MatrixCellOverlayInput {
    kind: MatrixCellOverlayKindLiteral | SubtypeExprOrValue<MatrixCellOverlayKindType>;
    content: SubtypeExprOrValue<UIComponentType>;
    position: MatrixCellOverlayPositionLiteral | SubtypeExprOrValue<MatrixCellOverlayPositionType>;
}

/**
 * TypeScript input for a matrix cell.
 *
 * @property columnKey - Column key
 * @property segments - Optional horizontal segments
 * @property overlays - Optional overlay annotations
 * @property emphasis - Optional highlight flag
 * @property emphasisColor - Optional ring colour
 * @property note - Optional text note
 */
export interface MatrixCellInput<ColumnKeys extends string = string> {
    columnKey: ColumnKeys;
    segments?: MatrixCellSegmentInput[];
    overlays?: MatrixCellOverlayInput[];
    emphasis?: SubtypeExprOrValue<BooleanType>;
    emphasisColor?: SubtypeExprOrValue<StringType>;
    note?: SubtypeExprOrValue<StringType>;
}

/**
 * TypeScript input for a matrix row.
 *
 * @property key - Unique row key
 * @property header - Optional rich header (UIComponent)
 * @property cells - Cells by column key
 */
export interface MatrixRowInput<ColumnKeys extends string = string> {
    key: SubtypeExprOrValue<StringType>;
    header?: SubtypeExprOrValue<UIComponentType>;
    cells: MatrixCellInput<ColumnKeys>[];
}

/**
 * TypeScript input for a matrix column.
 *
 * @property key - Unique column key
 * @property header - Optional rich header (UIComponent)
 */
export interface MatrixColumnInput<ColumnKeys extends string = string> {
    key: ColumnKeys;
    header?: SubtypeExprOrValue<UIComponentType>;
}

/**
 * TypeScript input for a legend entry.
 *
 * @property category - Category name
 * @property color - Swatch colour
 * @property label - Optional human-readable label
 */
export interface MatrixLegendEntryInput {
    category: SubtypeExprOrValue<StringType>;
    color: SubtypeExprOrValue<StringType>;
    label?: SubtypeExprOrValue<StringType>;
}

/**
 * TypeScript input for brush-selection state.
 *
 * @property enabled - Whether brush selection is active
 * @property onChange - Optional callback fired with the selected cell coords
 */
export interface MatrixBrushSelectionInput {
    enabled: SubtypeExprOrValue<BooleanType>;
    onChange?: SubtypeExprOrValue<FunctionType<[ArrayType<MatrixBrushCoordType>], NullType>>;
}

/**
 * Combined options bag for `Matrix.Root` — visual style + main-struct
 * content / wiring / behaviour fields.
 *
 * @property legend - Legend entries (colour swatches + labels)
 * @property brushSelection - Brush-selection state
 * @property onCellClick - Cell click callback
 * @property …style - All visual style fields from MatrixStyle
 */
export interface MatrixOptions<ColumnKeys extends string = string> extends MatrixStyle {
    /** Legend entries. */
    legend?: MatrixLegendEntryInput[];
    /** Brush-selection state. */
    brushSelection?: MatrixBrushSelectionInput;
    /** Cell-click callback — receives `{ row, column }` coordinates. */
    onCellClick?: SubtypeExprOrValue<FunctionType<[MatrixBrushCoordType], NullType>>;
    /** Marker to make the `ColumnKeys` generic parameter non-erasable. */
    readonly __columnKeys?: ColumnKeys;
}

// ============================================================================
// CellAddressableComponent — the addressing interface
// ============================================================================

/**
 * Addressing interface exposed by Matrix — each cell's DOM has a
 * `data-cell-id="{rowKey}:{columnKey}"` attribute so consumers
 * (notably AssignmentBoard / RosterGrid patterns) can resolve a cell
 * from an (rowKey, columnKey) pair.
 */
export interface CellAddressableComponent {
    /** `cellId = "{rowKey}:{columnKey}"` */
    cellId(rowKey: string, columnKey: string): string;
}

/**
 * Helper that mirrors the renderer's cell-id convention.
 */
export const CellAddressable: CellAddressableComponent = {
    cellId: (rowKey, columnKey) => `${rowKey}:${columnKey}`,
};

// ============================================================================
// Helpers
// ============================================================================

function buildOverlayKind(kind: MatrixCellOverlayInput["kind"]): SubtypeExprOrValue<MatrixCellOverlayKindType> {
    if (typeof kind === "string") {
        return East.value(variant(kind as MatrixCellOverlayKindLiteral, null), MatrixCellOverlayKindType);
    }
    return kind;
}

function buildOverlayPosition(pos: MatrixCellOverlayInput["position"]): SubtypeExprOrValue<MatrixCellOverlayPositionType> {
    if (typeof pos === "string") {
        return East.value(variant(pos as MatrixCellOverlayPositionLiteral, null), MatrixCellOverlayPositionType);
    }
    return pos;
}

function buildSegment(s: MatrixCellSegmentInput): ExprType<MatrixCellSegmentType> {
    return East.value({
        category: s.category,
        value: s.value,
        color: s.color !== undefined ? some(s.color) : none,
    }, MatrixCellSegmentType);
}

function buildOverlay(o: MatrixCellOverlayInput): ExprType<MatrixCellOverlayType> {
    return East.value({
        kind: buildOverlayKind(o.kind),
        content: o.content,
        position: buildOverlayPosition(o.position),
    }, MatrixCellOverlayType);
}

function buildCell(c: MatrixCellInput): ExprType<MatrixCellType> {
    return East.value({
        columnKey: c.columnKey,
        segments: (c.segments ?? []).map(buildSegment),
        overlays: (c.overlays ?? []).map(buildOverlay),
        emphasis: c.emphasis !== undefined ? some(c.emphasis) : none,
        emphasisColor: c.emphasisColor !== undefined ? some(c.emphasisColor) : none,
        note: c.note !== undefined ? some(c.note) : none,
    }, MatrixCellType);
}

function buildRow(r: MatrixRowInput): ExprType<MatrixRowType> {
    return East.value({
        key: r.key,
        header: r.header !== undefined ? some(r.header) : none,
        cells: r.cells.map(buildCell),
    }, MatrixRowType);
}

function buildColumn(c: MatrixColumnInput): ExprType<MatrixColumnType> {
    return East.value({
        key: c.key,
        header: c.header !== undefined ? some(c.header) : none,
    }, MatrixColumnType);
}

function buildLegendEntry(e: MatrixLegendEntryInput): ExprType<MatrixLegendEntryType> {
    return East.value({
        category: e.category,
        color: e.color,
        label: e.label !== undefined ? some(e.label) : none,
    }, MatrixLegendEntryType);
}

function buildMatrixStyle(style: MatrixStyle | undefined): ExprType<MatrixStyleType> | undefined {
    if (style === undefined) return undefined;
    const hasAny = style.size !== undefined
        || style.showGridLines !== undefined
        || style.gridColor !== undefined
        || style.headerBackground !== undefined
        || style.headerColor !== undefined
        || style.cellBackground !== undefined
        || style.rowHeaderWidth !== undefined
        || style.columnHeaderHeight !== undefined
        || style.legendPosition !== undefined;
    if (!hasAny) return undefined;

    const sizeValue = style.size !== undefined
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    const legendPositionValue = style.legendPosition !== undefined
        ? (typeof style.legendPosition === "string"
            ? East.value(variant(style.legendPosition, null), MatrixLegendPositionType)
            : style.legendPosition)
        : undefined;

    return East.value({
        size: sizeValue ? some(sizeValue) : none,
        showGridLines: style.showGridLines !== undefined ? some(style.showGridLines) : none,
        gridColor: style.gridColor !== undefined ? some(style.gridColor) : none,
        headerBackground: style.headerBackground !== undefined ? some(style.headerBackground) : none,
        headerColor: style.headerColor !== undefined ? some(style.headerColor) : none,
        cellBackground: style.cellBackground !== undefined ? some(style.cellBackground) : none,
        rowHeaderWidth: style.rowHeaderWidth !== undefined ? some(style.rowHeaderWidth) : none,
        columnHeaderHeight: style.columnHeaderHeight !== undefined ? some(style.columnHeaderHeight) : none,
        legendPosition: legendPositionValue ? some(legendPositionValue) : none,
    }, MatrixStyleType);
}

function buildBrushSelection(b: MatrixBrushSelectionInput): ExprType<MatrixBrushSelectionType> {
    return East.value({
        enabled: b.enabled,
        onChange: b.onChange !== undefined
            ? some(East.value(b.onChange, FunctionType([ArrayType(MatrixBrushCoordType)], NullType)))
            : none,
    }, MatrixBrushSelectionType);
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a Matrix component value — a row/column heat-grid with rich
 * headers, multi-overlay cells, and optional brush selection.
 *
 * @typeParam ColumnKeys - String-literal union of this Matrix's column keys
 * @param rows - Row definitions
 * @param columns - Column definitions (establishes the columnKey universe)
 * @param options - Optional visual style + legend + brush selection + callbacks
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * The IR publishes a `CellAddressableComponent` convention — each
 * rendered cell has `data-cell-id="{rowKey}:{columnKey}"` in the DOM
 * so consumer patterns (AssignmentBoard / RosterGrid) can address
 * cells by their (rowKey, columnKey) pair.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Matrix, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, (_$) => {
 *     return Matrix.Root(
 *         [
 *             { key: "alice", header: Text.Root("Alice"), cells: [
 *                 { columnKey: "mon", segments: [{ category: "booked", value: 0.8 }] },
 *                 { columnKey: "tue", segments: [{ category: "booked", value: 0.5 }] },
 *             ]},
 *         ],
 *         [{ key: "mon", header: Text.Root("Mon") }, { key: "tue", header: Text.Root("Tue") }],
 *         { legend: [{ category: "booked", color: "blue.500", label: "Booked" }] },
 *     );
 * });
 * ```
 */
function createMatrix<ColumnKeys extends string = string>(
    rows: MatrixRowInput<ColumnKeys>[],
    columns: MatrixColumnInput<ColumnKeys>[],
    options?: MatrixOptions<ColumnKeys>,
): ExprType<UIComponentType> {
    const styleValue = buildMatrixStyle(options);
    const legendValue = options?.legend
        ? East.value(options.legend.map(buildLegendEntry), ArrayType(MatrixLegendEntryType))
        : undefined;
    const brushValue = options?.brushSelection
        ? buildBrushSelection(options.brushSelection)
        : undefined;

    return East.value(variant("Matrix", {
        rows: East.value(rows.map(buildRow), ArrayType(MatrixRowType)),
        columns: East.value(columns.map(buildColumn), ArrayType(MatrixColumnType)),
        legend: legendValue ? some(legendValue) : none,
        brushSelection: brushValue ? some(brushValue) : none,
        onCellClick: options?.onCellClick !== undefined
            ? some(East.value(options.onCellClick, FunctionType([MatrixBrushCoordType], NullType)))
            : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

// ============================================================================
// Namespace Export
// ============================================================================

interface MatrixNamespace {
    Root: typeof createMatrix;
    Types: {
        Root: typeof MatrixRootType;
        Row: typeof MatrixRowType;
        Column: typeof MatrixColumnType;
        Cell: typeof MatrixCellType;
        Segment: typeof MatrixCellSegmentType;
        Overlay: typeof MatrixCellOverlayType;
        OverlayKind: typeof MatrixCellOverlayKindType;
        OverlayPosition: typeof MatrixCellOverlayPositionType;
        LegendEntry: typeof MatrixLegendEntryType;
        LegendPosition: typeof MatrixLegendPositionType;
        BrushCoord: typeof MatrixBrushCoordType;
        BrushSelection: typeof MatrixBrushSelectionType;
        Style: typeof MatrixStyleType;
    };
}

/**
 * Matrix — row/column heat-grid primitive.
 *
 * @remarks
 * CSS-grid-based renderer (no chart framework) with sticky first
 * column, multi-overlay cells, and optional brush selection.
 */
export const Matrix: MatrixNamespace = {
    /**
     * Creates a Matrix component value.
     *
     * @param rows - Row definitions
     * @param columns - Column definitions
     * @param options - Optional style + legend + brush selection
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Matrix, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, (_$) => {
     *     return Matrix.Root(
     *         [{ key: "alice", header: Text.Root("Alice"), cells: [
     *             { columnKey: "mon", segments: [{ category: "booked", value: 0.8 }] },
     *         ]}],
     *         [{ key: "mon", header: Text.Root("Mon") }],
     *     );
     * });
     * ```
     */
    Root: createMatrix,
    Types: {
        /**
         * Standalone East StructType mirror of the inline `Matrix` variant.
         *
         * @property rows - Row definitions
         * @property columns - Column definitions
         * @property legend - Optional legend entries
         * @property brushSelection - Optional brush-selection state
         * @property onCellClick - Optional cell-click callback
         * @property style - Optional visual style
         */
        Root: MatrixRootType,
        /**
         * East StructType for a matrix row.
         *
         * @property key - Unique row key
         * @property header - Optional rich header
         * @property cells - Cells in this row
         */
        Row: MatrixRowType,
        /**
         * East StructType for a matrix column definition.
         *
         * @property key - Unique column key
         * @property header - Optional rich header
         */
        Column: MatrixColumnType,
        /**
         * East StructType for a matrix cell.
         *
         * @property columnKey - Column key this cell belongs to
         * @property segments - Horizontal segments
         * @property overlays - Overlay annotations
         * @property emphasis - Highlight flag
         * @property emphasisColor - Ring colour
         * @property note - Optional text note
         */
        Cell: MatrixCellType,
        /**
         * East StructType for a cell segment.
         *
         * @property category - Category name
         * @property value - Proportional weight
         * @property color - Optional explicit colour
         */
        Segment: MatrixCellSegmentType,
        /**
         * East StructType for a cell overlay.
         *
         * @property kind - Overlay kind (icon / text / badge)
         * @property content - Overlay UIComponent
         * @property position - Position within the cell
         */
        Overlay: MatrixCellOverlayType,
        /**
         * East VariantType for overlay kind.
         *
         * @property icon - Icon-shaped overlay
         * @property text - Plain-text overlay
         * @property badge - Badge-shaped overlay
         */
        OverlayKind: MatrixCellOverlayKindType,
        /**
         * East VariantType for overlay position.
         *
         * @property tl - Top-left
         * @property tr - Top-right
         * @property bl - Bottom-left
         * @property br - Bottom-right
         * @property center - Centred
         */
        OverlayPosition: MatrixCellOverlayPositionType,
        /**
         * East StructType for a legend entry.
         *
         * @property category - Category name
         * @property color - Swatch colour
         * @property label - Optional human-readable label
         */
        LegendEntry: MatrixLegendEntryType,
        /**
         * East VariantType for legend position.
         *
         * @property top - Above the grid
         * @property bottom - Below the grid
         * @property left - Left of the grid
         * @property right - Right of the grid
         */
        LegendPosition: MatrixLegendPositionType,
        /**
         * East StructType for a brush-selection coordinate.
         *
         * @property row - Row key
         * @property column - Column key
         */
        BrushCoord: MatrixBrushCoordType,
        /**
         * East StructType for brush-selection state.
         *
         * @property enabled - Whether brush selection is active
         * @property onChange - Optional callback fired with selected coords
         */
        BrushSelection: MatrixBrushSelectionType,
        /**
         * East StructType holding every visual field for a Matrix.
         *
         * @property size - Size preset
         * @property showGridLines - Whether to draw grid lines
         * @property gridColor - Explicit grid-line colour
         * @property headerBackground - Header background
         * @property headerColor - Header text colour
         * @property cellBackground - Default cell background
         * @property rowHeaderWidth - Sticky first-column width
         * @property columnHeaderHeight - Column-header row height
         * @property legendPosition - Legend position
         */
        Style: MatrixStyleType,
    },
};
