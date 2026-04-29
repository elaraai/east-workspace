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
    DictType,
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

import {
    SizeType,
    LabelInputType,
    FontWeightType,
    FontStyleType,
    type LabelInput,
} from "../../style.js";
import { UIComponentType } from "../../component.js";
import {
    AlignType,
    MatrixCellSegmentType,
    MatrixBrushCoordType,
    MatrixBrushSelectionType,
    MatrixLegendPositionType,
    MatrixCellOrientationType,
    MatrixSegmentChangeEventType,
    MatrixSegmentClickEventType,
    MatrixStyleType,
    type MatrixStyle,
    type AlignLiteral,
    type MatrixCellOrientationLiteral,
} from "./types.js";

export {
    AlignType,
    MatrixCellSegmentType,
    MatrixBrushCoordType,
    MatrixBrushSelectionType,
    MatrixLegendPositionType,
    MatrixCellOrientationType,
    MatrixSegmentChangeEventType,
    MatrixSegmentClickEventType,
    MatrixStyleType,
    type MatrixStyle,
    type AlignLiteral,
    type MatrixLegendPositionLiteral,
    type MatrixCellOrientationLiteral,
} from "./types.js";

// ============================================================================
// Cell overlay (UIComp-coupled)
// ============================================================================

/**
 * East StructType for a cell overlay.
 *
 * @remarks
 * The overlay's content is a full UIComponent — its own sizing rules
 * govern its footprint. Alignment uses the same axis-based `align` /
 * `verticalAlign` pair as segment labels so the two APIs are
 * consistent.
 *
 * @property content - Overlay content (UIComponent)
 * @property align - Horizontal alignment within the cell (default `"center"`)
 * @property verticalAlign - Vertical alignment within the cell (default `"center"`)
 */
export const MatrixCellOverlayType = StructType({
    content: UIComponentType,
    align: AlignType,
    verticalAlign: AlignType,
});

export type MatrixCellOverlayType = typeof MatrixCellOverlayType;

// ============================================================================
// Cell
// ============================================================================

/**
 * East StructType for a matrix cell.
 *
 * @remarks
 * Cells live inside a `DictType(StringType, MatrixCellType)` keyed by
 * column key, so the cell itself no longer needs a `columnKey` field.
 * Emphasis is expressed by the presence of `emphasisColor` (nullable
 * string) — no separate boolean flag.
 *
 * Two rich-content slots:
 * - `tooltip` — hover-triggered, a Chakra Tooltip wraps the cell.
 * - `popover` — click-triggered, a Chakra Popover wraps the cell.
 *
 * Both accept any UIComponent (Stat, Badge, mini chart, form, …).
 * `popover` coexists with `onCellClick`: the click both fires the
 * callback and opens the popover.
 *
 * @property segments - Horizontal / vertical segments (weighted, normalized)
 * @property overlays - Overlay annotations
 * @property emphasisColor - Presence = emphasized; value = ring colour override
 * @property tooltip - Optional rich tooltip content (hover-triggered, UIComponent)
 * @property popover - Optional rich popover content (click-triggered, UIComponent)
 */
export const MatrixCellType: StructType<{
    segments: ArrayType<MatrixCellSegmentType>,
    overlays: ArrayType<MatrixCellOverlayType>,
    emphasisColor: OptionType<StringType>,
    tooltip: OptionType<UIComponentType>,
    popover: OptionType<UIComponentType>,
}> = StructType({
    segments: ArrayType(MatrixCellSegmentType),
    overlays: ArrayType(MatrixCellOverlayType),
    emphasisColor: OptionType(StringType),
    tooltip: OptionType(UIComponentType),
    popover: OptionType(UIComponentType),
});

export type MatrixCellType = typeof MatrixCellType;

// ============================================================================
// Row / Column
// ============================================================================

/**
 * East StructType for a matrix row.
 *
 * @property key - Unique row key
 * @property header - Optional rich header (UIComponent)
 * @property cells - Dict of column key → cell
 */
export const MatrixRowType: StructType<{
    key: StringType,
    header: OptionType<UIComponentType>,
    cells: DictType<StringType, MatrixCellType>,
}> = StructType({
    key: StringType,
    header: OptionType(UIComponentType),
    cells: DictType(StringType, MatrixCellType),
});

export type MatrixRowType = typeof MatrixRowType;

/**
 * East StructType for a matrix column definition.
 *
 * @property key - Unique column key
 * @property header - Optional rich header (UIComponent)
 */
export const MatrixColumnType = StructType({
    key: StringType,
    header: OptionType(UIComponentType),
});

export type MatrixColumnType = typeof MatrixColumnType;

// ============================================================================
// Legend entry
// ============================================================================

/**
 * East StructType for a legend entry.
 *
 * @property category - Category name (matches segment.category)
 * @property color - Swatch colour
 * @property label - Optional human-readable label
 */
export const MatrixLegendEntryType = StructType({
    category: StringType,
    color: StringType,
    label: OptionType(StringType),
});

export type MatrixLegendEntryType = typeof MatrixLegendEntryType;

// ============================================================================
// Root
// ============================================================================

/**
 * Standalone East StructType mirror of the inline `Matrix` variant in
 * `component.ts`.
 *
 * @property rows - Row definitions (each row carries a dict of cells)
 * @property columns - Column definitions (establishes the columnKey universe)
 * @property legend - Optional legend entries
 * @property brushSelection - Optional controlled brush-selection state
 * @property onCellClick - Optional cell click callback
 * @property onSegmentClick - Optional segment click callback
 * @property onSegmentChange - Optional segment-weight change callback (drag-resize)
 * @property style - Optional visual style
 */
export const MatrixRootType: StructType<{
    rows: ArrayType<MatrixRowType>,
    columns: ArrayType<MatrixColumnType>,
    legend: OptionType<ArrayType<MatrixLegendEntryType>>,
    brushSelection: OptionType<MatrixBrushSelectionType>,
    onCellClick: OptionType<FunctionType<[MatrixBrushCoordType], NullType>>,
    onSegmentClick: OptionType<FunctionType<[MatrixSegmentClickEventType], NullType>>,
    onSegmentChange: OptionType<FunctionType<[MatrixSegmentChangeEventType], NullType>>,
    style: OptionType<MatrixStyleType>,
}> = StructType({
    rows: ArrayType(MatrixRowType),
    columns: ArrayType(MatrixColumnType),
    legend: OptionType(ArrayType(MatrixLegendEntryType)),
    brushSelection: OptionType(MatrixBrushSelectionType),
    onCellClick: OptionType(FunctionType([MatrixBrushCoordType], NullType)),
    onSegmentClick: OptionType(FunctionType([MatrixSegmentClickEventType], NullType)),
    onSegmentChange: OptionType(FunctionType([MatrixSegmentChangeEventType], NullType)),
    style: OptionType(MatrixStyleType),
});

export type MatrixRootType = typeof MatrixRootType;

// ============================================================================
// TypeScript input interfaces
// ============================================================================

/**
 * TS input for a cell segment — primitives + optional resize
 * constraints (only honoured when the Matrix has an
 * `onSegmentChange` callback).
 *
 * @remarks
 * `label` accepts either a plain string (shorthand for
 * `{ value: <string> }`) or a full {@link LabelInput} struct for
 * alignment + typography overrides.
 */
export interface MatrixCellSegmentInput {
    category: SubtypeExprOrValue<StringType>;
    weight: SubtypeExprOrValue<FloatType>;
    color?: SubtypeExprOrValue<StringType>;
    /** Text label shown inside the segment. String shorthand expands to `{ value }`. */
    label?: SubtypeExprOrValue<StringType> | LabelInput;
    min?: SubtypeExprOrValue<FloatType>;
    max?: SubtypeExprOrValue<FloatType>;
    step?: SubtypeExprOrValue<FloatType>;
}

/**
 * TS input for a cell overlay. `align` / `verticalAlign` mirror the
 * segment-label pattern so the positioning surface is consistent.
 */
export interface MatrixCellOverlayInput {
    content: SubtypeExprOrValue<UIComponentType>;
    /** Horizontal alignment within the cell. Default `"center"`. */
    align?: AlignLiteral | SubtypeExprOrValue<AlignType>;
    /** Vertical alignment within the cell. Default `"center"`. */
    verticalAlign?: AlignLiteral | SubtypeExprOrValue<AlignType>;
}

/**
 * TS input for a matrix cell (without a `columnKey` — the dict key
 * supplies it).
 */
export interface MatrixCellInput {
    segments?: MatrixCellSegmentInput[];
    overlays?: MatrixCellOverlayInput[];
    /** Presence = emphasized; value = ring colour override. */
    emphasisColor?: SubtypeExprOrValue<StringType>;
    /** Rich tooltip content (hover-triggered UIComponent). */
    tooltip?: SubtypeExprOrValue<UIComponentType>;
    /** Rich popover content (click-triggered UIComponent). Coexists with `onCellClick`. */
    popover?: SubtypeExprOrValue<UIComponentType>;
}

/**
 * TS input for a matrix row. `cells` is dict-keyed by column key
 * (narrowed to `ColumnKeys`).
 */
export interface MatrixRowInput<ColumnKeys extends string = string> {
    key: SubtypeExprOrValue<StringType>;
    header?: SubtypeExprOrValue<UIComponentType>;
    cells: { [K in ColumnKeys]?: MatrixCellInput };
}

/**
 * TS input for a matrix column.
 */
export interface MatrixColumnInput<ColumnKeys extends string = string> {
    key: ColumnKeys;
    header?: SubtypeExprOrValue<UIComponentType>;
}

/**
 * TS input for a legend entry. `color` may be omitted — the factory
 * will look up the first matching `category` among the supplied
 * cell segments and copy its colour.
 */
export interface MatrixLegendEntryInput {
    category: string;
    color?: SubtypeExprOrValue<StringType>;
    label?: SubtypeExprOrValue<StringType>;
}

/**
 * TS input for brush-selection state (controlled-component pattern).
 */
export interface MatrixBrushSelectionInput {
    enabled: SubtypeExprOrValue<BooleanType>;
    selected?: SubtypeExprOrValue<ArrayType<MatrixBrushCoordType>>;
    onChange?: SubtypeExprOrValue<FunctionType<[ArrayType<MatrixBrushCoordType>], NullType>>;
}

/**
 * Options bag for `Matrix.Root` — visual style + main-struct content
 * / wiring / behaviour fields.
 */
export interface MatrixOptions<ColumnKeys extends string = string> extends MatrixStyle {
    legend?: MatrixLegendEntryInput[];
    brushSelection?: MatrixBrushSelectionInput;
    onCellClick?: SubtypeExprOrValue<FunctionType<[MatrixBrushCoordType], NullType>>;
    onSegmentClick?: SubtypeExprOrValue<FunctionType<[MatrixSegmentClickEventType], NullType>>;
    onSegmentChange?: SubtypeExprOrValue<FunctionType<[MatrixSegmentChangeEventType], NullType>>;
    /** Marker so TypeScript keeps the `ColumnKeys` parameter reachable. */
    readonly __columnKeys?: ColumnKeys;
}

// ============================================================================
// CellAddressableComponent
// ============================================================================

export interface CellAddressableComponent {
    /** `cellId = "{rowKey}:{columnKey}"` — matches the renderer's
     *  `data-cell-id` attribute. */
    cellId(rowKey: string, columnKey: string): string;
}

const CellAddressableHelper: CellAddressableComponent = {
    cellId: (rowKey, columnKey) => `${rowKey}:${columnKey}`,
};

// ============================================================================
// Helpers
// ============================================================================

function buildAlign(a: AlignLiteral | SubtypeExprOrValue<AlignType> | undefined): SubtypeExprOrValue<AlignType> {
    if (a === undefined) return East.value(variant("center", null), AlignType);
    if (typeof a === "string") {
        return East.value(variant(a as AlignLiteral, null), AlignType);
    }
    return a;
}

function isLabelInputObject(input: SubtypeExprOrValue<StringType> | LabelInput): input is LabelInput {
    // LabelInput is a plain JS object with a `value` field. Strings, numbers,
    // and East expressions (which are objects keyed by symbols + `type`) don't
    // expose a `value` property.
    return (
        typeof input === "object"
        && input !== null
        && !Array.isArray(input)
        && Object.prototype.hasOwnProperty.call(input, "value")
        && typeof (input as { type?: unknown }).type === "undefined"
    );
}

function buildLabel(input: SubtypeExprOrValue<StringType> | LabelInput): ExprType<LabelInputType> {
    if (!isLabelInputObject(input)) {
        return East.value({
            value: input as SubtypeExprOrValue<StringType>,
            align: none,
            verticalAlign: none,
            color: none,
            fontWeight: none,
            fontStyle: none,
            fontSize: none,
        }, LabelInputType);
    }
    const li = input;
    const fontWeightValue = li.fontWeight !== undefined
        ? (typeof li.fontWeight === "string"
            ? East.value(variant(li.fontWeight as any, null), FontWeightType)
            : li.fontWeight)
        : undefined;
    const fontStyleValue = li.fontStyle !== undefined
        ? (typeof li.fontStyle === "string"
            ? East.value(variant(li.fontStyle as any, null), FontStyleType)
            : li.fontStyle)
        : undefined;
    const fontSizeValue = li.fontSize !== undefined
        ? (typeof li.fontSize === "string"
            ? East.value(variant(li.fontSize as any, null), SizeType)
            : li.fontSize)
        : undefined;
    return East.value({
        value: li.value,
        align: li.align !== undefined ? some(buildAlign(li.align)) : none,
        verticalAlign: li.verticalAlign !== undefined ? some(buildAlign(li.verticalAlign)) : none,
        color: li.color !== undefined ? some(li.color) : none,
        fontWeight: fontWeightValue ? some(fontWeightValue) : none,
        fontStyle: fontStyleValue ? some(fontStyleValue) : none,
        fontSize: fontSizeValue ? some(fontSizeValue) : none,
    }, LabelInputType);
}

function buildSegment(s: MatrixCellSegmentInput): ExprType<MatrixCellSegmentType> {
    return East.value({
        category: s.category,
        weight: s.weight,
        color: s.color !== undefined ? some(s.color) : none,
        label: s.label !== undefined ? some(buildLabel(s.label)) : none,
        min: s.min !== undefined ? some(s.min) : none,
        max: s.max !== undefined ? some(s.max) : none,
        step: s.step !== undefined ? some(s.step) : none,
    }, MatrixCellSegmentType);
}

function buildOverlay(o: MatrixCellOverlayInput): ExprType<MatrixCellOverlayType> {
    return East.value({
        content: o.content,
        align: buildAlign(o.align),
        verticalAlign: buildAlign(o.verticalAlign),
    }, MatrixCellOverlayType);
}

function buildCell(c: MatrixCellInput): ExprType<MatrixCellType> {
    return East.value({
        segments: (c.segments ?? []).map(buildSegment),
        overlays: (c.overlays ?? []).map(buildOverlay),
        emphasisColor: c.emphasisColor !== undefined ? some(c.emphasisColor) : none,
        tooltip: c.tooltip !== undefined ? some(c.tooltip) : none,
        popover: c.popover !== undefined ? some(c.popover) : none,
    }, MatrixCellType);
}

function buildRowCells<ColumnKeys extends string>(
    cells: { [K in ColumnKeys]?: MatrixCellInput },
): ExprType<DictType<StringType, MatrixCellType>> {
    const entries = new Map<string, ExprType<MatrixCellType>>();
    for (const [key, cell] of Object.entries(cells)) {
        if (cell) entries.set(key, buildCell(cell as MatrixCellInput));
    }
    return East.value(entries, DictType(StringType, MatrixCellType));
}

function buildRow<ColumnKeys extends string>(r: MatrixRowInput<ColumnKeys>): ExprType<MatrixRowType> {
    return East.value({
        key: r.key,
        header: r.header !== undefined ? some(r.header) : none,
        cells: buildRowCells(r.cells),
    }, MatrixRowType);
}

function buildColumn<ColumnKeys extends string>(c: MatrixColumnInput<ColumnKeys>): ExprType<MatrixColumnType> {
    return East.value({
        key: c.key,
        header: c.header !== undefined ? some(c.header) : none,
    }, MatrixColumnType);
}

function autoColourForCategory(
    category: string,
    rows: MatrixRowInput<string>[],
): string | undefined {
    for (const row of rows) {
        for (const cell of Object.values(row.cells)) {
            if (!cell) continue;
            const c = cell as MatrixCellInput;
            for (const seg of c.segments ?? []) {
                if (seg.category === category && typeof seg.color === "string") {
                    return seg.color;
                }
            }
        }
    }
    return undefined;
}

function buildLegend(
    entries: MatrixLegendEntryInput[],
    rows: MatrixRowInput<string>[],
): ExprType<ArrayType<MatrixLegendEntryType>> {
    return East.value(entries.map(e => East.value({
        category: e.category,
        color: e.color !== undefined
            ? e.color
            : (autoColourForCategory(e.category, rows) ?? "gray.400"),
        label: e.label !== undefined ? some(e.label) : none,
    }, MatrixLegendEntryType)), ArrayType(MatrixLegendEntryType));
}

function buildBrushSelection(b: MatrixBrushSelectionInput): ExprType<MatrixBrushSelectionType> {
    return East.value({
        enabled: b.enabled,
        selected: b.selected !== undefined ? some(b.selected) : none,
        onChange: b.onChange !== undefined
            ? some(East.value(b.onChange, FunctionType([ArrayType(MatrixBrushCoordType)], NullType)))
            : none,
    }, MatrixBrushSelectionType);
}

function buildMatrixStyle(style: MatrixStyle | undefined): ExprType<MatrixStyleType> | undefined {
    if (style === undefined) return undefined;
    const hasAny = style.size !== undefined
        || style.showGridLines !== undefined
        || style.gridColor !== undefined
        || style.headerBackground !== undefined
        || style.headerColor !== undefined
        || style.cellBackground !== undefined
        || style.cellBorderRadius !== undefined
        || style.rowHeaderWidth !== undefined
        || style.columnHeaderHeight !== undefined
        || style.legendPosition !== undefined
        || style.emphasisColor !== undefined
        || style.selectedBackground !== undefined
        || style.selectedBorderColor !== undefined
        || style.hoverHighlightColor !== undefined
        || style.cellOrientation !== undefined
        || style.segmentLabelColor !== undefined
        || style.segmentLabelFontSize !== undefined
        || style.segmentLabelFontWeight !== undefined
        || style.minLabelSize !== undefined;
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

    const orientationValue = style.cellOrientation !== undefined
        ? (typeof style.cellOrientation === "string"
            ? East.value(variant(style.cellOrientation as MatrixCellOrientationLiteral, null), MatrixCellOrientationType)
            : style.cellOrientation)
        : undefined;

    return East.value({
        size: sizeValue ? some(sizeValue) : none,
        showGridLines: style.showGridLines !== undefined ? some(style.showGridLines) : none,
        gridColor: style.gridColor !== undefined ? some(style.gridColor) : none,
        headerBackground: style.headerBackground !== undefined ? some(style.headerBackground) : none,
        headerColor: style.headerColor !== undefined ? some(style.headerColor) : none,
        cellBackground: style.cellBackground !== undefined ? some(style.cellBackground) : none,
        cellBorderRadius: style.cellBorderRadius !== undefined ? some(style.cellBorderRadius) : none,
        rowHeaderWidth: style.rowHeaderWidth !== undefined ? some(style.rowHeaderWidth) : none,
        columnHeaderHeight: style.columnHeaderHeight !== undefined ? some(style.columnHeaderHeight) : none,
        legendPosition: legendPositionValue ? some(legendPositionValue) : none,
        emphasisColor: style.emphasisColor !== undefined ? some(style.emphasisColor) : none,
        selectedBackground: style.selectedBackground !== undefined ? some(style.selectedBackground) : none,
        selectedBorderColor: style.selectedBorderColor !== undefined ? some(style.selectedBorderColor) : none,
        hoverHighlightColor: style.hoverHighlightColor !== undefined ? some(style.hoverHighlightColor) : none,
        cellOrientation: orientationValue ? some(orientationValue) : none,
        segmentLabelColor: style.segmentLabelColor !== undefined ? some(style.segmentLabelColor) : none,
        segmentLabelFontSize: style.segmentLabelFontSize !== undefined ? some(style.segmentLabelFontSize) : none,
        segmentLabelFontWeight: style.segmentLabelFontWeight !== undefined ? some(style.segmentLabelFontWeight) : none,
        minLabelSize: style.minLabelSize !== undefined ? some(style.minLabelSize) : none,
    }, MatrixStyleType);
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a Matrix component value.
 *
 * @typeParam ColumnKeys - String-literal union of this Matrix's column keys
 * @param rows - Row definitions. Each row's `cells` is a dict narrowed to `ColumnKeys`.
 * @param columns - Column definitions. Establishes the `ColumnKeys` universe.
 * @param options - Optional style + legend + brushSelection + callbacks
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * Per-cell interactivity is implied by callback presence:
 * - `onCellClick` defined → cells get a pointer cursor + hover state
 * - `onSegmentClick` defined → segments get pointer cursor + click firing
 * - `onSegmentChange` defined → segment edges show drag handles (the
 *   edge matches the orientation — right in horizontal, bottom in
 *   vertical); `min` / `max` / `step` on segments act as resize
 *   constraints
 *
 * Brush selection is a controlled component: `brushSelection.selected`
 * is the source of truth; the renderer syncs its local state to this
 * value and fires `onChange` on drag-release.
 *
 * The DOM publishes `data-cell-id="{rowKey}:{columnKey}"` on every
 * cell so consumer patterns (AssignmentBoard, RosterGrid) can
 * address cells by coordinate — see `Matrix.CellAddressable.cellId`.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Matrix, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, (_$) => {
 *     return Matrix.Root(
 *         [{ key: "alice", header: Text.Root("Alice"), cells: {
 *             mon: { segments: [{ category: "booked", weight: 0.8 }, { category: "free", weight: 0.2 }] },
 *             tue: { segments: [{ category: "booked", weight: 0.5 }, { category: "free", weight: 0.5 }] },
 *         }}],
 *         [{ key: "mon", header: Text.Root("Mon") }, { key: "tue", header: Text.Root("Tue") }],
 *         { legend: [{ category: "booked", label: "Booked" }, { category: "free", label: "Free" }] },
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
        ? buildLegend(options.legend, rows as MatrixRowInput<string>[])
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
        onSegmentClick: options?.onSegmentClick !== undefined
            ? some(East.value(options.onSegmentClick, FunctionType([MatrixSegmentClickEventType], NullType)))
            : none,
        onSegmentChange: options?.onSegmentChange !== undefined
            ? some(East.value(options.onSegmentChange, FunctionType([MatrixSegmentChangeEventType], NullType)))
            : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

// ============================================================================
// Namespace
// ============================================================================

interface MatrixNamespace {
    Root: typeof createMatrix;
    CellAddressable: CellAddressableComponent;
    Types: {
        Root: typeof MatrixRootType;
        Row: typeof MatrixRowType;
        Column: typeof MatrixColumnType;
        Cell: typeof MatrixCellType;
        Segment: typeof MatrixCellSegmentType;
        Overlay: typeof MatrixCellOverlayType;
        Align: typeof AlignType;
        LegendEntry: typeof MatrixLegendEntryType;
        LegendPosition: typeof MatrixLegendPositionType;
        BrushCoord: typeof MatrixBrushCoordType;
        BrushSelection: typeof MatrixBrushSelectionType;
        SegmentClickEvent: typeof MatrixSegmentClickEventType;
        SegmentChangeEvent: typeof MatrixSegmentChangeEventType;
        CellOrientation: typeof MatrixCellOrientationType;
        Style: typeof MatrixStyleType;
    };
}

/**
 * Matrix — row/column heat-grid primitive.
 *
 * @remarks
 * Chakra CSS-Grid renderer with sticky first column, dict-keyed
 * cells, multi-position overlays, optional controlled brush
 * selection, and optional segment drag-resize.
 */
export const Matrix: MatrixNamespace = {
    Root: createMatrix,
    CellAddressable: CellAddressableHelper,
    Types: {
        Root: MatrixRootType,
        Row: MatrixRowType,
        Column: MatrixColumnType,
        Cell: MatrixCellType,
        Segment: MatrixCellSegmentType,
        Overlay: MatrixCellOverlayType,
        Align: AlignType,
        LegendEntry: MatrixLegendEntryType,
        LegendPosition: MatrixLegendPositionType,
        BrushCoord: MatrixBrushCoordType,
        BrushSelection: MatrixBrushSelectionType,
        SegmentClickEvent: MatrixSegmentClickEventType,
        SegmentChangeEvent: MatrixSegmentChangeEventType,
        CellOrientation: MatrixCellOrientationType,
        Style: MatrixStyleType,
    },
};
