/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type EastType,
    type ExprType,
    type RecursiveType,
    type SubtypeExprOrValue,
    type TypeOf,
    East,
    Expr,
    ArrayType,
    BooleanType,
    DictType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import {
    AlignType,
    LabelInputType,
    FontWeightType,
    FontStyleType,
    SizeType,
    type LabelInput,
    type AlignLiteral,
} from "../../style.js";
import { DensityType, type DensityLiteral } from "../../style/interaction.js";
import { PlotGutterType, type PlotGutter } from "../../shared/plot-gutter.js";
import { UIComponentType } from "../../component.js";
import { preOrderRows, treeElement, type TreeInput, type TreeNode } from "../../shared/tree.js";
import {
    MatrixFillType,
    MatrixSegmentType,
    MatrixMarkerType,
    MatrixCornerType,
    MatrixOrientationType,
    MatrixLegendEntryType,
    MatrixCellClickEventType,
    MatrixSegmentClickEventType,
    MatrixSegmentChangeEventType,
    StatusValueType,
    type MatrixFillLiteral,
    type MatrixOrientationLiteral,
    type MatrixCornerLiteral,
    type StatusValueLiteral,
    type MatrixSegmentInput,
    type MatrixMarkerInput,
    type MatrixLegendEntryInput,
} from "./types.js";

// Re-export the UIComp-free types so consumers can reach everything via this module.
export {
    MatrixFillType,
    MatrixSegmentType,
    MatrixMarkerType,
    MatrixCornerType,
    MatrixOrientationType,
    MatrixLegendEntryType,
    MatrixCellClickEventType,
    MatrixSegmentClickEventType,
    MatrixSegmentChangeEventType,
    type MatrixFillLiteral,
    type MatrixOrientationLiteral,
    type MatrixCornerLiteral,
    type MatrixSegmentInput,
    type MatrixMarkerInput,
    type MatrixLegendEntryInput,
} from "./types.js";

// ============================================================================
// Cell / Row / Column (UIComp-coupled — cell carries free slot + popover)
// ============================================================================

/**
 * East StructType for a Matrix cell.
 *
 * @remarks
 * A cell's body is a weighted **segment bar** (status-coloured), unless `slot`
 * is set — then the free-slot UIComponent renders in its place. `markers` are
 * status flags (the Matrix analogue of `Planner.marker`): each tints a corner
 * ring and pins a status icon/badge over the bar. `orientation` overrides the
 * matrix default for this cell. `popover` is the click-triggered rich body
 * (popover-only, like the Planner event — no tooltip).
 *
 * @property segments - The weighted segment bar ({@link MatrixSegmentType})
 * @property markers - Status flags layered over the bar ({@link MatrixMarkerType})
 * @property orientation - Optional per-cell orientation override
 * @property slot - Optional free-slot UIComponent (replaces the segment bar)
 * @property popover - Optional click-triggered rich popover (UIComponent)
 */
export const MatrixCellType: StructType<{
    segments: ArrayType<MatrixSegmentType>,
    markers: ArrayType<MatrixMarkerType>,
    orientation: OptionType<MatrixOrientationType>,
    slot: OptionType<UIComponentType>,
    popover: OptionType<UIComponentType>,
}> = StructType({
    segments: ArrayType(MatrixSegmentType),
    markers: ArrayType(MatrixMarkerType),
    orientation: OptionType(MatrixOrientationType),
    slot: OptionType(UIComponentType),
    popover: OptionType(UIComponentType),
});

export type MatrixCellType = typeof MatrixCellType;

/**
 * East StructType for a Matrix row.
 *
 * @remarks
 * `value` is the row-header main text and `sublabel` its optional secondary
 * line — the Planner row-header model (no avatar). `cells` is keyed by column
 * key. A Matrix's rows arrive in PRE-ORDER (#955): each parent, then its
 * subtree — the rows after it with a greater `depth`, up to the next row at
 * its depth or shallower. A flat matrix's rows are all at depth 0.
 *
 * @property key - Stable row key
 * @property value - Row-header main text (defaults to `key`)
 * @property sublabel - Optional row-header secondary text
 * @property depth - How deep the row sits — 0 for a top-level row
 * @property collapsed - Whether the row starts collapsed (a parent's; a leaf's is false)
 * @property cells - Dict of column key → cell
 */
export const MatrixRowType: StructType<{
    key: StringType,
    value: StringType,
    sublabel: OptionType<StringType>,
    depth: IntegerType,
    collapsed: BooleanType,
    cells: DictType<StringType, MatrixCellType>,
}> = StructType({
    key: StringType,
    value: StringType,
    sublabel: OptionType(StringType),
    depth: IntegerType,
    collapsed: BooleanType,
    cells: DictType(StringType, MatrixCellType),
});

export type MatrixRowType = typeof MatrixRowType;

/**
 * East StructType for a Matrix column.
 *
 * @remarks
 * One x-axis column definition; cells are keyed against `key`, and `label`
 * paints the centred mono column header (defaulting to the key when omitted).
 *
 * @property key - Stable column key (cells are keyed against it)
 * @property label - Optional single header label (defaults to `key`)
 */
export const MatrixColumnType: StructType<{
    key: StringType,
    label: OptionType<LabelInputType>,
}> = StructType({
    key: StringType,
    label: OptionType(LabelInputType),
});

export type MatrixColumnType = typeof MatrixColumnType;

// ============================================================================
// Root
// ============================================================================

/**
 * Standalone East StructType mirror of the inline `Matrix` arm in `component.ts`.
 *
 * @remarks
 * The shape `Matrix.Root` produces and the renderer consumes: `rows` × `columns`
 * with a status-coloured segment bar per cell, an optional `rowHeader` over the
 * left identity column, a default `orientation`, an optional `legend`, and the
 * `onCell/Segment*` callbacks. Pair it with a `Slice.Rail` for filter / search
 * / breakdown / range.
 *
 * @property rows - The rows in pre-order, each with its depth (#955)
 * @property columns - Column definitions (the x-axis)
 * @property rowHeader - Optional header label for the row-header (left) column
 * @property orientation - Default cell orientation (per-cell overridable)
 * @property legend - Optional explicit legend entries (omitted ⇒ auto-derived)
 * @property minLabelSize - Optional min segment px below which in-bar labels hide
 * @property density - Optional density preset (header/row rhythm)
 * @property onCellClick - Optional cell-click callback
 * @property onSegmentClick - Optional segment-click callback
 * @property onSegmentChange - Optional segment drag-resize callback (presence ⇒ handles)
 */
// Field for field, in order, the `Matrix` arm of `component.ts` — the wire —
// held to it by `test/collections/matrix.spec.ts`.
export const MatrixRootType: StructType<{
    rows: ArrayType<MatrixRowType>,
    columns: ArrayType<MatrixColumnType>,
    rowHeader: OptionType<StringType>,
    orientation: MatrixOrientationType,
    legend: OptionType<ArrayType<MatrixLegendEntryType>>,
    minLabelSize: OptionType<FloatType>,
    density: OptionType<DensityType>,
    plotGutter: OptionType<PlotGutterType>,
    onCellClick: OptionType<FunctionType<[MatrixCellClickEventType], NullType>>,
    onSegmentClick: OptionType<FunctionType<[MatrixSegmentClickEventType], NullType>>,
    onSegmentChange: OptionType<FunctionType<[MatrixSegmentChangeEventType], NullType>>,
    height: OptionType<StringType>,
    maxHeight: OptionType<StringType>,
}> = StructType({
    rows: ArrayType(MatrixRowType),
    columns: ArrayType(MatrixColumnType),
    rowHeader: OptionType(StringType),
    orientation: MatrixOrientationType,
    legend: OptionType(ArrayType(MatrixLegendEntryType)),
    minLabelSize: OptionType(FloatType),
    density: OptionType(DensityType),
    plotGutter: OptionType(PlotGutterType),
    onCellClick: OptionType(FunctionType([MatrixCellClickEventType], NullType)),
    onSegmentClick: OptionType(FunctionType([MatrixSegmentClickEventType], NullType)),
    onSegmentChange: OptionType(FunctionType([MatrixSegmentChangeEventType], NullType)),
    /** Uniform sizing (#320): bound the matrix; it scrolls within. `"fill"` fills the parent box. */
    height: OptionType(StringType),
    /** Uniform sizing (#320): max-height cap; content-sized up to it. */
    maxHeight: OptionType(StringType),
});

export type MatrixRootType = typeof MatrixRootType;

// ============================================================================
// Label helpers (shared shape with Gantt/Planner)
// ============================================================================

function buildAlign(a: AlignLiteral | SubtypeExprOrValue<AlignType>): SubtypeExprOrValue<AlignType> {
    return typeof a === "string" ? East.value(variant(a, null), AlignType) : a;
}

function isLabelInputObject(input: SubtypeExprOrValue<StringType> | LabelInput): input is LabelInput {
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
            align: none, verticalAlign: none, color: none,
            fontWeight: none, fontStyle: none, fontSize: none,
        }, LabelInputType);
    }
    const li = input;
    const fontWeightValue = li.fontWeight !== undefined
        ? (typeof li.fontWeight === "string" ? East.value(variant(li.fontWeight as any, null), FontWeightType) : li.fontWeight)
        : undefined;
    const fontStyleValue = li.fontStyle !== undefined
        ? (typeof li.fontStyle === "string" ? East.value(variant(li.fontStyle as any, null), FontStyleType) : li.fontStyle)
        : undefined;
    const fontSizeValue = li.fontSize !== undefined
        ? (typeof li.fontSize === "string" ? East.value(variant(li.fontSize as any, null), SizeType) : li.fontSize)
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

// ============================================================================
// Cell input + builders (planner-marker shape — flat JS in, East value out)
// ============================================================================

/**
 * Flat input for {@link createCell} (`Matrix.cell`).
 *
 * @remarks
 * Flat JS in, enveloped East value out — every field is optional. Provide
 * `segments` for the bar (or `slot` to replace it), `markers` for the status
 * flags, `popover` for the click body, and `orientation` to override the
 * matrix default for this cell.
 *
 * @property segments - The bar's segments — `[Matrix.segment(...)]` (or an East array)
 * @property markers - Status flags — `[Matrix.marker(...)]`
 * @property orientation - Per-cell orientation override
 * @property slot - Free-slot UIComponent (replaces the bar)
 * @property popover - Click-triggered rich popover (UIComponent)
 */
export interface MatrixCellInput {
    /** The bar's segments — built with `Matrix.segment(...)`. */
    segments?: SubtypeExprOrValue<ArrayType<MatrixSegmentType>>;
    /** Status flags — built with `Matrix.marker(...)`. */
    markers?: SubtypeExprOrValue<ArrayType<MatrixMarkerType>>;
    /** Per-cell orientation override. String shorthand or East variant. */
    orientation?: SubtypeExprOrValue<MatrixOrientationType> | MatrixOrientationLiteral;
    /** Free-slot UIComponent — when set, renders instead of the segment bar. */
    slot?: SubtypeExprOrValue<UIComponentType>;
    /** Click-triggered rich popover content (UIComponent). */
    popover?: SubtypeExprOrValue<UIComponentType>;
}

/**
 * Builds a Matrix segment East value from flat input.
 *
 * @param input - Segment configuration ({@link MatrixSegmentInput})
 * @returns An East expression of {@link MatrixSegmentType}
 *
 * @remarks
 * Internal builder behind `Matrix.segment`; that namespace property carries the
 * documented, test-validated `East.function` example.
 */
function createSegment(input: MatrixSegmentInput): ExprType<MatrixSegmentType> {
    const fillValue = (input.fill === undefined || typeof input.fill === "string")
        ? variant((input.fill ?? "brand") as MatrixFillLiteral, null)
        : input.fill;
    return East.value({
        fill: fillValue,
        weight: input.weight,
        label: input.label !== undefined ? some(buildLabel(input.label)) : none,
        color: input.color !== undefined ? some(input.color) : none,
        min: input.min !== undefined ? some(input.min) : none,
        max: input.max !== undefined ? some(input.max) : none,
        step: input.step !== undefined ? some(input.step) : none,
    }, MatrixSegmentType);
}

/**
 * Builds a Matrix marker (cell status flag) East value from flat input — the
 * Matrix analogue of `Planner.marker`.
 *
 * @param input - Marker configuration ({@link MatrixMarkerInput})
 * @returns An East expression of {@link MatrixMarkerType}
 *
 * @remarks
 * Internal builder behind `Matrix.marker`; that namespace property carries the
 * documented, test-validated `East.function` example.
 */
function createMarker(input: MatrixMarkerInput): ExprType<MatrixMarkerType> {
    const atValue = (input.at === undefined || typeof input.at === "string")
        ? variant((input.at ?? "tr") as MatrixCornerLiteral, null)
        : input.at;
    const statusValue = (input.status === undefined || typeof input.status === "string")
        ? variant((input.status ?? "danger") as StatusValueLiteral, null)
        : input.status;
    return East.value({
        at: atValue,
        status: statusValue,
        message: input.message,
        label: input.label !== undefined ? some(input.label) : none,
    }, MatrixMarkerType);
}

/**
 * Builds a Matrix cell East value from flat input.
 *
 * @param input - Cell configuration ({@link MatrixCellInput})
 * @returns An East expression of {@link MatrixCellType}
 *
 * @remarks
 * Internal builder behind `Matrix.cell`; that namespace property carries the
 * documented, test-validated `East.function` example.
 */
function createCell(input: MatrixCellInput): ExprType<MatrixCellType> {
    const orientationValue = input.orientation !== undefined
        ? (typeof input.orientation === "string" ? East.value(variant(input.orientation, null), MatrixOrientationType) : input.orientation)
        : undefined;
    return East.value({
        segments: East.value(input.segments ?? [], ArrayType(MatrixSegmentType)),
        markers: East.value(input.markers ?? [], ArrayType(MatrixMarkerType)),
        orientation: orientationValue !== undefined ? some(orientationValue) : none,
        slot: input.slot !== undefined ? some(input.slot) : none,
        popover: input.popover !== undefined ? some(input.popover) : none,
    }, MatrixCellType);
}

// ============================================================================
// Column input + config + factory
// ============================================================================

/**
 * Column definition input.
 *
 * @remarks
 * One entry in the `columns` config array — declares an x-axis column by its
 * stable `key` (against which each row's cells are keyed) and an optional
 * header `label`.
 *
 * @property key - Stable column key (cells are keyed against it)
 * @property label - Optional header label (plain string or {@link LabelInput}); defaults to `key`
 */
export interface MatrixColumnInput {
    /** Stable column key (cells are keyed against it). */
    key: SubtypeExprOrValue<StringType>;
    /** Optional header label; defaults to `key`. */
    label?: SubtypeExprOrValue<StringType> | LabelInput;
}

/**
 * Builds a Matrix column (one x-axis pivot column) East value from flat input —
 * the constructor for the `columns` array.
 *
 * @param input - Column configuration ({@link MatrixColumnInput})
 * @returns An East expression of {@link MatrixColumnType}
 *
 * @remarks
 * Internal builder behind `Matrix.column`; that namespace property carries the
 * documented example. Because the result is an East value (not a TS object), a
 * `columns` array of these is a genuine `ArrayType<MatrixColumnType>` — so the
 * x-axis can be data-driven (built with `.map` from upstream data) just as
 * readily as written out literally.
 */
function createColumn(input: MatrixColumnInput): ExprType<MatrixColumnType> {
    return East.value({
        key: input.key,
        label: input.label !== undefined ? some(buildLabel(input.label)) : none,
    }, MatrixColumnType);
}

/**
 * What a Matrix's `data` may be: an array of struct rows, or of recursive rows
 * whose node is a struct — the rows `tree.children` nests (#955).
 */
export type MatrixData =
    | SubtypeExprOrValue<ArrayType<StructType>>
    | SubtypeExprOrValue<ArrayType<RecursiveType<StructType>>>;

/**
 * The row an accessor receives, inferred from the data argument — the struct,
 * or a recursive row's node (#955).
 *
 * @typeParam T - The data's type
 */
export type RowElement<T extends MatrixData> =
    TypeOf<T> extends ArrayType<infer S> ? (TreeNode<S> extends StructType ? TreeNode<S> : never) : never;

/**
 * How a Matrix's rows nest (#955) — the data's own tree, to any depth, as on
 * the Table (#954).
 *
 * @remarks
 * `children` returns a row's child rows: more of the SAME row type (an
 * `Array` of the data's element type) — a `RecursiveType` row's own field
 * (`r => r.members`), or a lookup over flat data, with the data holding only
 * the top-level rows. A parent is a full row: its header, indented with a fold
 * caret, and its own cells from the same `cell` builder. `collapsed` says which
 * parents start closed.
 *
 * @typeParam R - The row an accessor receives — a struct, or a recursive row's node
 */
export type MatrixTreeInput<R extends StructType = StructType> = TreeInput<R>;

/**
 * Matrix construction config (Planner-style — grouped, typed).
 *
 * @typeParam R - The struct each accessor receives — a data row, or a recursive row's node
 *
 * @property columns - The x-axis column definitions
 * @property cell - Per-(row, column) cell builder: `(row, columnKey) => Matrix.cell(...)`
 * @property rowKey - Stable row-key accessor
 * @property rowHeader - Optional header label for the row-header (left) column
 * @property rowValue - Optional row-header main-text accessor (defaults to `rowKey`)
 * @property rowSublabel - Optional row-header secondary-text accessor
 * @property tree - Optional nesting — `{ children, collapsed? }`, the data's own tree ({@link MatrixTreeInput})
 * @property orientation - Default cell orientation (`"horizontal"` | `"vertical"`)
 * @property legend - Optional explicit legend entries (omitted ⇒ auto-derived from fills)
 * @property minLabelSize - Optional min segment px below which in-bar labels hide
 * @property density - Optional density preset
 * @property onCellClick - Cell-click callback
 * @property onSegmentClick - Segment-click callback
 * @property onSegmentChange - Segment drag-resize callback (presence ⇒ handles)
 */
export interface MatrixConfig<R extends StructType> {
    /**
     * The x-axis column definitions — an array of `Matrix.column(...)` values,
     * or any East `ArrayType<MatrixColumnType>` expression (the x-axis can be
     * data-driven).
     */
    columns: SubtypeExprOrValue<ArrayType<MatrixColumnType>>;
    /** Per-(row, column) cell builder. Return `Matrix.cell(...)`. */
    cell: (row: ExprType<R>, column: ExprType<MatrixColumnType>) => SubtypeExprOrValue<MatrixCellType>;
    /** Stable row-key accessor. */
    rowKey: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
    /** Optional header label for the row-header (left) column. */
    rowHeader?: SubtypeExprOrValue<StringType>;
    /** Optional row-header main-text accessor; defaults to `rowKey`. */
    rowValue?: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
    /** Optional row-header secondary-text accessor. */
    rowSublabel?: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
    /**
     * Nested rows (#955) — the data's own tree, to any depth
     * ({@link MatrixTreeInput}): `tree={{ children: (r) => r.members }}`. A
     * parent is a full row — its header, indented with a fold caret, and its
     * own cells from `cell`; its caret folds its subtree. Row keys stay the
     * row's address in every event, so a nested matrix keys its rows uniquely
     * across the tree. Grouping flat rows is a data step: nest them first.
     */
    tree?: MatrixTreeInput<R>;
    /** Default cell orientation. Default `"horizontal"`. */
    orientation?: MatrixOrientationLiteral;
    /** Explicit legend entries. Omit to auto-derive from the fills used. */
    legend?: MatrixLegendEntryInput[];
    /** Min rendered segment px below which the in-bar label is hidden. */
    minLabelSize?: SubtypeExprOrValue<FloatType>;
    /** Density preset (header / row rhythm). */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Uniform sizing (#320): bound the component — a pixel number, `"fill"` (fill the parent box), or a CSS length; the whole component takes this height and scrolls within. */
    height?: SubtypeExprOrValue<StringType>;
    /** Uniform sizing (#320): max-height cap — a pixel number or CSS length; content-sized up to it. */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** Shared plot gutter (#147) — pins the value-grid columns to `[left, W−right]` (px) so the Matrix lines up under a stacked Chart; `left` is the row-header column. */
    plotGutter?: PlotGutter;
    /** Cell-click callback. */
    onCellClick?: SubtypeExprOrValue<FunctionType<[MatrixCellClickEventType], NullType>>;
    /** Segment-click callback. */
    onSegmentClick?: SubtypeExprOrValue<FunctionType<[MatrixSegmentClickEventType], NullType>>;
    /** Segment drag-resize callback. Presence shows the resize handles. */
    onSegmentChange?: SubtypeExprOrValue<FunctionType<[MatrixSegmentChangeEventType], NullType>>;
}

/**
 * Creates a Matrix — a row × column grid of status-coloured segment bars.
 *
 * @typeParam T - The data array type
 * @param data - The row data — structs, or recursive rows nested with `tree`
 * @param config - The Matrix configuration ({@link MatrixConfig})
 * @returns An East expression of `UIComponentType`
 *
 * @remarks
 * Data + accessors (Planner parity): `columns` declares the x-axis, `cell`
 * builds each `(row, column)` cell with `Matrix.cell(...)`, `tree` nests the
 * rows to any depth (#955). Pair the result with a `Slice.Rail` to get filter /
 * search / breakdown / range for free.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Matrix, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ =>
 *     Matrix.Root(
 *         [{ name: "Alice", booked: 0.7 }, { name: "Bob", booked: 0.4 }],
 *         {
 *             columns: [{ key: "mon", label: "Mon" }, { key: "tue", label: "Tue" }],
 *             rowKey: r => r.name,
 *             cell: (r, _col) => Matrix.cell({ segments: [
 *                 Matrix.segment({ fill: "brand", weight: r.booked }),
 *                 Matrix.segment({ fill: "free",  weight: r.booked.subtract(1.0).multiply(-1.0) }),
 *             ]}),
 *             legend: [{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }],
 *         },
 *     ));
 * ```
 */
function createMatrix<T extends MatrixData>(
    data: T,
    config: MatrixConfig<RowElement<T>>,
): ExprType<UIComponentType> {
    const data_expr = East.value(data as SubtypeExprOrValue<ArrayType<StructType>>) as unknown as ExprType<ArrayType<EastType>>;
    const cfg = config as unknown as MatrixConfig<StructType>;
    // A recursive row reaches every accessor as its NODE (#955).
    const element = treeElement("Matrix", (Expr.type(data_expr as unknown as Expr) as ArrayType<EastType>).value);

    const columns_expr = East.value(cfg.columns, ArrayType(MatrixColumnType));

    // The rows IN PRE-ORDER — a parent, then its subtree, each with its depth
    // and whether it starts collapsed (the Table's walk, `shared/tree.ts`).
    const flatten = preOrderRows("Matrix", element, MatrixRowType, ($, entry, depth, collapsed) => {
        const row = $.let(element.nodeOf(entry));
        const cells = $.let(columns_expr.toDict(
            ($, col) => col.key,
            ($, col) => East.value(cfg.cell(row, col), MatrixCellType),
        ));
        return East.value({
            key: cfg.rowKey(row),
            value: cfg.rowValue !== undefined ? cfg.rowValue(row) : cfg.rowKey(row),
            sublabel: cfg.rowSublabel !== undefined ? some(cfg.rowSublabel(row)) : none,
            depth,
            collapsed,
            cells,
        }, MatrixRowType);
    }, cfg.tree);
    const rows = flatten(data_expr);

    const legend = cfg.legend !== undefined
        ? some(East.value(cfg.legend.map(e => East.value({
            fill: typeof e.fill === "string" ? variant(e.fill, null) : e.fill,
            label: e.label,
        }, MatrixLegendEntryType)), ArrayType(MatrixLegendEntryType)))
        : none;

    const density = cfg.density !== undefined
        ? some(typeof cfg.density === "string" ? East.value(variant(cfg.density, null), DensityType) : cfg.density)
        : none;

    const plotGutter = cfg.plotGutter !== undefined
        ? some(East.value({
            left:  cfg.plotGutter.left  !== undefined ? some(cfg.plotGutter.left)  : none,
            right: cfg.plotGutter.right !== undefined ? some(cfg.plotGutter.right) : none,
        }, PlotGutterType))
        : none;

    return East.value(variant("Matrix", {
        rows,
        columns: columns_expr,
        rowHeader: cfg.rowHeader !== undefined ? some(cfg.rowHeader) : none,
        orientation: variant(cfg.orientation ?? "horizontal", null),
        legend,
        minLabelSize: cfg.minLabelSize !== undefined ? some(cfg.minLabelSize) : none,
        density,
        plotGutter,
        height: cfg.height !== undefined ? some(cfg.height) : none,
        maxHeight: cfg.maxHeight !== undefined ? some(cfg.maxHeight) : none,
        onCellClick: cfg.onCellClick !== undefined ? some(cfg.onCellClick) : none,
        onSegmentClick: cfg.onSegmentClick !== undefined ? some(cfg.onSegmentClick) : none,
        onSegmentChange: cfg.onSegmentChange !== undefined ? some(cfg.onSegmentChange) : none,
    }), UIComponentType);
}

// ============================================================================
// Namespace
// ============================================================================

interface MatrixTypesShape {
    Root: MatrixRootType;
    Row: MatrixRowType;
    Column: MatrixColumnType;
    Cell: MatrixCellType;
    Segment: MatrixSegmentType;
    Fill: MatrixFillType;
    Marker: MatrixMarkerType;
    Corner: MatrixCornerType;
    Orientation: MatrixOrientationType;
    LegendEntry: MatrixLegendEntryType;
    Status: StatusValueType;
    CellClickEvent: MatrixCellClickEventType;
    SegmentClickEvent: MatrixSegmentClickEventType;
    SegmentChangeEvent: MatrixSegmentChangeEventType;
}

const MatrixTypes: MatrixTypesShape = {
    /**
     * East StructType for the entire Matrix value — the root IR.
     *
     * @remarks
     * The standalone mirror of the inline `Matrix` arm in `component.ts`; the
     * shape `Matrix.Root` produces and the renderer consumes.
     *
     * @property rows - The rows in pre-order, each with its depth (#955)
     * @property columns - Column definitions (the x-axis)
     * @property rowHeader - Optional header label for the row-header (left) column
     * @property orientation - Default cell orientation (per-cell overridable)
     * @property legend - Optional explicit legend entries (omitted ⇒ auto-derived)
     * @property minLabelSize - Optional min segment px below which in-bar labels hide
     * @property density - Optional density preset (header/row rhythm)
     * @property onCellClick - Optional cell-click callback
     * @property onSegmentClick - Optional segment-click callback
     * @property onSegmentChange - Optional segment drag-resize callback (presence ⇒ handles)
     */
    Root: MatrixRootType,
    /**
     * East StructType for a Matrix row.
     *
     * @remarks
     * One row of the grid: `value` (main row-header text) + optional `sublabel`
     * (secondary line) — the Planner row-header model — plus a dict of cells
     * keyed by column key. The rows arrive in PRE-ORDER (#955): each parent,
     * then its subtree — the rows after it with a greater `depth`.
     *
     * @property key - Stable row key
     * @property value - Row-header main text (defaults to `key`)
     * @property sublabel - Optional row-header secondary text
     * @property depth - How deep the row sits — 0 for a top-level row
     * @property collapsed - Whether the row starts collapsed (a parent's; a leaf's is false)
     * @property cells - Dict of column key → cell
     */
    Row: MatrixRowType,
    /**
     * East StructType for a Matrix column.
     *
     * @remarks
     * One x-axis column definition; cells are keyed against `key`.
     *
     * @property key - Stable column key (cells are keyed against it)
     * @property label - Optional single header label (defaults to `key`)
     */
    Column: MatrixColumnType,
    /**
     * East StructType for a Matrix cell.
     *
     * @remarks
     * A cell's body is a weighted segment bar (status-coloured) unless `slot` is
     * set; `markers` are status flags that tint a corner ring and pin a status
     * icon/badge, and `popover` is the click-triggered rich body.
     *
     * @property segments - The weighted segment bar ({@link MatrixSegmentType})
     * @property markers - Status flags layered over the bar ({@link MatrixMarkerType})
     * @property orientation - Optional per-cell orientation override
     * @property slot - Optional free-slot UIComponent (replaces the segment bar)
     * @property popover - Optional click-triggered rich popover (UIComponent)
     */
    Cell: MatrixCellType,
    /**
     * East StructType for a single weighted slice of a cell's bar.
     *
     * @remarks
     * Segments are weighted — the renderer normalises so sibling weights sum to
     * the full cell axis. `fill` drives the colour from the theme; `min` / `max`
     * / `step` only apply when the Matrix carries an `onSegmentChange` callback.
     *
     * @property fill - Status-leveraged fill ({@link MatrixFillType})
     * @property weight - Proportional weight (normalised with sibling segments)
     * @property label - Optional rich in-bar label (text + alignment + typography)
     * @property color - Optional explicit colour override (bypasses `fill`)
     * @property min - Optional minimum weight for drag-resize
     * @property max - Optional maximum weight for drag-resize
     * @property step - Optional snap increment for drag-resize
     */
    Segment: MatrixSegmentType,
    /**
     * East VariantType for a segment fill — status-leveraged.
     *
     * @remarks
     * A superset of {@link StatusValueType} (the semantic statuses, shared with
     * Planner markers / Gantt task status) plus the three matrix-native fills
     * (`brand`, `slack`, `free`).
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
    Fill: MatrixFillType,
    /**
     * East StructType for a cell status marker — the Matrix analogue of
     * `Planner.marker`.
     *
     * @remarks
     * `status` drives the ring tint + paired corner icon from the shared status
     * palette (reused from Planner markers); `message` is the hover tooltip;
     * `label` (when set) replaces the status icon with custom badge text.
     *
     * @property at - Which corner the marker icon / badge sits in ({@link MatrixCornerType})
     * @property status - The semantic status — drives the ring tint + paired corner icon ({@link StatusValueType})
     * @property message - The marker text surfaced as a hover tooltip
     * @property label - Optional custom badge text that replaces the status icon
     */
    Marker: MatrixMarkerType,
    /**
     * East VariantType for the corner a cell marker icon / badge sits in.
     *
     * @remarks
     * Selects which of the four cell corners a marker anchors to.
     *
     * @property tl - Top-left
     * @property tr - Top-right
     * @property bl - Bottom-left
     * @property br - Bottom-right
     */
    Corner: MatrixCornerType,
    /**
     * East VariantType for how a cell's segment bar is laid out.
     *
     * @remarks
     * The matrix default (`Matrix.Root` `orientation`), overridable per cell.
     *
     * @property horizontal - Segments flow left-to-right, sized by width
     * @property vertical - Segments stack bottom-to-top, sized by height (capacity bar)
     */
    Orientation: MatrixOrientationType,
    /**
     * East StructType for one legend swatch — a fill paired with its label.
     *
     * @remarks
     * Supplied explicitly via the `legend` config, or auto-derived from the
     * fills the cells use.
     *
     * @property fill - The segment fill the swatch shows ({@link MatrixFillType})
     * @property label - The displayed legend label
     */
    LegendEntry: MatrixLegendEntryType,
    /**
     * East VariantType for a status colour — shared with Planner markers.
     *
     * @remarks
     * The semantic status palette reused across the Matrix (marker ring tint +
     * corner icon) and Planner / Status components.
     *
     * @property success - Success / up-to-date classification
     * @property warning - Warning classification
     * @property danger - Danger / error classification
     * @property info - Informational classification
     * @property neutral - Neutral / idle classification
     */
    Status: StatusValueType,
    /**
     * East StructType for the `onCellClick` payload.
     *
     * @remarks
     * Identifies which cell the user clicked by row and column key.
     *
     * @property row - Row key
     * @property column - Column key
     */
    CellClickEvent: MatrixCellClickEventType,
    /**
     * East StructType for the `onSegmentClick` payload.
     *
     * @remarks
     * Identifies the clicked segment by its cell coordinates, index, and fill.
     *
     * @property row - Row key
     * @property column - Column key
     * @property segmentIndex - Index of the clicked segment within the cell (0-based)
     * @property fill - Fill of the clicked segment
     */
    SegmentClickEvent: MatrixSegmentClickEventType,
    /**
     * East StructType for the `onSegmentChange` payload.
     *
     * @remarks
     * Fired when the user drags a segment boundary to a new weight; carries the
     * post-snap, post-clamp weight for the resized segment.
     *
     * @property row - Row key
     * @property column - Column key
     * @property segmentIndex - Index of the resized segment within the cell (0-based)
     * @property weight - New weight (post-snap, post-clamp)
     */
    SegmentChangeEvent: MatrixSegmentChangeEventType,
};

interface MatrixNamespace {
    Root: typeof createMatrix;
    column: typeof createColumn;
    segment: typeof createSegment;
    marker: typeof createMarker;
    cell: typeof createCell;
    Types: typeof MatrixTypes;
}

/**
 * Matrix namespace — a row × column grid of status-coloured segment bars.
 *
 * @remarks
 * Build with `Matrix.Root(data, config)`; assemble cells with `Matrix.cell`,
 * segments with `Matrix.segment`, status flags with `Matrix.marker`. Frame it
 * with a `Slice.Rail` for filter / search / breakdown / range.
 */
const MatrixImpl: MatrixNamespace = {
    /**
     * Creates a Matrix — a row × column grid of status-coloured segment bars.
     *
     * @typeParam T - The data array type
     * @param data - The row data
     * @param config - The Matrix configuration ({@link MatrixConfig})
     * @returns An East expression of `UIComponentType`
     *
     * @remarks
     * Data + accessors (Planner parity): `columns` declares the x-axis, `cell`
     * builds each `(row, column)` cell with `Matrix.cell(...)`, `tree` nests the
     * rows to any depth (#955). Pair the result with a `Slice.Rail` to get
     * filter / search / breakdown / range for free.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Matrix, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Matrix.Root(
     *         [{ name: "Alice", booked: 0.7 }, { name: "Bob", booked: 0.4 }],
     *         {
     *             columns: [Matrix.column({ key: "mon", label: "Mon" }), Matrix.column({ key: "tue", label: "Tue" })],
     *             rowKey: r => r.name,
     *             cell: (r, _col) => Matrix.cell({ segments: [
     *                 Matrix.segment({ fill: "brand", weight: r.booked }),
     *                 Matrix.segment({ fill: "free",  weight: r.booked.subtract(1.0).multiply(-1.0) }),
     *             ]}),
     *             legend: [{ fill: "brand", label: "Booked" }, { fill: "free", label: "Free" }],
     *         },
     *     ));
     * ```
     */
    Root: createMatrix,
    /**
     * Builds a Matrix column (one x-axis pivot column) East value from flat input.
     *
     * @param input - Column configuration ({@link MatrixColumnInput})
     * @returns An East expression of {@link MatrixColumnType}
     *
     * @remarks
     * The constructor for the `columns` array. Because it returns an East value,
     * the x-axis can be data-driven — `data.map(($, d) => Matrix.column({ key: d.id }))`
     * — as readily as written out literally.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Matrix, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Matrix.Root(
     *         [{ name: "Alice", booked: 0.7 }],
     *         {
     *             columns: [Matrix.column({ key: "mon", label: "Mon" })],
     *             rowKey: r => r.name,
     *             cell: (r, col) => Matrix.cell({ segments: [
     *                 Matrix.segment({ fill: "brand", weight: r.booked }),
     *             ]}),
     *         },
     *     ));
     * ```
     */
    column: createColumn,
    /**
     * Builds a Matrix segment East value from flat input.
     *
     * @param input - Segment configuration ({@link MatrixSegmentInput})
     * @returns An East expression of {@link MatrixSegmentType}
     *
     * @remarks
     * Segments are weighted slices of a cell's bar; the renderer normalises so
     * sibling weights sum to the full cell axis. Assemble them into a cell with
     * `Matrix.cell({ segments: [...] })`.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Matrix, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Matrix.Root(
     *         [{ name: "Alice", booked: 0.7 }],
     *         {
     *             columns: [{ key: "mon", label: "Mon" }],
     *             rowKey: r => r.name,
     *             cell: (r, _col) => Matrix.cell({ segments: [
     *                 Matrix.segment({ fill: "warning", weight: r.booked, label: "30%" }),
     *             ]}),
     *         },
     *     ));
     * ```
     */
    segment: createSegment,
    /**
     * Builds a Matrix marker (cell status flag) East value from flat input — the
     * Matrix analogue of `Planner.marker`.
     *
     * @param input - Marker configuration ({@link MatrixMarkerInput})
     * @returns An East expression of {@link MatrixMarkerType}
     *
     * @remarks
     * Markers are status flags layered over a cell: each tints a corner ring and
     * pins a status icon/badge, with `message` as the hover tooltip. Attach them
     * to a cell with `Matrix.cell({ markers: [...] })`.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Matrix, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Matrix.Root(
     *         [{ name: "Alice", booked: 0.7 }],
     *         {
     *             columns: [{ key: "mon", label: "Mon" }],
     *             rowKey: r => r.name,
     *             cell: (r, _col) => Matrix.cell({
     *                 segments: [Matrix.segment({ fill: "brand", weight: r.booked })],
     *                 markers: [Matrix.marker({ status: "danger", message: "Over capacity", at: "tr" })],
     *             }),
     *         },
     *     ));
     * ```
     */
    marker: createMarker,
    /**
     * Builds a Matrix cell East value from flat input.
     *
     * @param input - Cell configuration ({@link MatrixCellInput})
     * @returns An East expression of {@link MatrixCellType}
     *
     * @remarks
     * A cell's body is a weighted segment bar built from `Matrix.segment(...)`,
     * unless `slot` is set. Layer status flags with `markers` (each tints a
     * corner ring + pins a status icon), and attach a click-triggered rich body
     * with `popover`. Return cells from the `cell` accessor in `Matrix.Root`.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Matrix, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Matrix.Root(
     *         [{ name: "Alice", booked: 0.7 }],
     *         {
     *             columns: [{ key: "mon", label: "Mon" }],
     *             rowKey: r => r.name,
     *             cell: (r, _col) => Matrix.cell({
     *                 segments: [
     *                     Matrix.segment({ fill: "brand", weight: r.booked }),
     *                     Matrix.segment({ fill: "free",  weight: r.booked.subtract(1.0).multiply(-1.0) }),
     *                 ],
     *                 markers: [Matrix.marker({ status: "danger", message: "Over capacity" })],
     *             }),
     *         },
     *     ));
     * ```
     */
    cell: createCell,
    Types: MatrixTypes,
};

export const Matrix: typeof MatrixImpl = MatrixImpl;
