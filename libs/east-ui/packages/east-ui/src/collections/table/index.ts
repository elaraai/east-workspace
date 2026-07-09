/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    Expr,
    StructType,
    ArrayType,
    DictType,
    StringType, OptionType,
    variant,
    type TypeOf,
    some,
    none,

    FunctionType,
    NullType,
    toEastTypeValue,
    type EastType,
    type EastTypeValue,
    LiteralValueType,
    BooleanType,
    IntegerType,
    FloatType,
    DateTimeType,
    BlobType,
    EastTypeType,
} from "@elaraai/east";

import {
    ColorSchemeType
} from "../../style.js";

import {
    TableVariantType,
    TableStyleType,
    TableSizeType,
    type TableStyle,
    type PrimitiveEastType,
    TableCellRenderContextType,
    TableCellClickEventType,
    TableRowClickEventType,
    TableRowSelectionEventType,
    TableSortEventType,
    TableSortDirectionType,
    TableColumnGroupType,
    TablePaginationType,
    TableSelectionType,
    TableSelectionModeType,
    type TableSelectionModeLiteral,
} from "./types.js";
import { UIComponentType } from "../../component.js";
import { SliceBindType, SliceChromeType } from "../../platform/slice/index.js";
import { StatusValueType } from "../../feedback/status/types.js";
import { ApprovalStateType, RowRefType, RowReviewType, buildReview } from "../../contracts/review.js";
import { SliceAffordanceType, type SliceAffordanceLiteral } from "../../contracts/slice-affordances.js";
import { Text } from "../../typography/index.js";
import { DensityType } from "../../style/interaction.js";
import { StatusTokenType } from "../../style/interaction.js";
import { PlotGutterType } from "../../shared/plot-gutter.js";
import { mapRowsBlock, reifyAccessor } from "../../shared/reify.js";

// ============================================================================
// Table Footer Cell
// ============================================================================

/**
 * East StructType for a footer cell.
 *
 * @remarks
 * Footer cells are display-only — they don't participate in sorting
 * or filtering, so they don't need the `value: LiteralValueType`
 * field that body cells carry. Callers render totals / labels via
 * `content` (a full UIComponent — `Text.Root("$560.00", {
 * fontWeight: "bold" })` for a typical totals row).
 *
 * Defined in `index.ts` (not `types.ts`) because it references
 * `UIComponentType`, which would create a circular import from
 * `types.ts`.
 *
 * @property content - Rich cell content (UIComponent)
 * @property colSpan - Optional column span (1-based) for merging cells
 * @property rowSpan - Optional row span (1-based)
 */
export const TableFooterCellType = StructType({
    content: UIComponentType,
    colSpan: OptionType(IntegerType),
    rowSpan: OptionType(IntegerType),
});

export type TableFooterCellType = typeof TableFooterCellType;

/**
 * TypeScript input interface for a footer cell.
 *
 * @property content - Rich cell content (UIComponent)
 * @property colSpan - Optional column span (1-based)
 * @property rowSpan - Optional row span (1-based)
 */
export interface TableFooterCellInput {
    /** Rich cell content (UIComponent). */
    content: SubtypeExprOrValue<UIComponentType>;
    /** Optional column span (1-based). */
    colSpan?: SubtypeExprOrValue<IntegerType>;
    /** Optional row span (1-based). */
    rowSpan?: SubtypeExprOrValue<IntegerType>;
}

/**
 * Extended Table options — TableStyle + the UIComp-coupled fields that
 * can only be typed here (because `types.ts` can't import
 * `UIComponentType` without a circular dependency).
 *
 * @property footer - Single footer row (dict of column key → footer cell input)
 * @property footerRows - Multiple footer rows
 * @property expandedContent - `(rowIndex) => UIComponent` — expandable-row detail content
 */
/**
 * Plain TS shape for a column-group header row entry — the factory
 * wraps these into `TableColumnGroupType` values internally.
 *
 * @typeParam ColumnKeys - String-literal union of this Table's column keys
 *
 * @property label - Heading text for the grouped cell
 * @property columnKeys - Columns the group spans (must match data fields)
 */
export interface TableColumnGroupInput<ColumnKeys extends string = string> {
    /** Heading text shown in the grouped cell. */
    label: SubtypeExprOrValue<StringType>;
    /** Column keys this group spans (type-checked against the row shape). */
    columnKeys: ColumnKeys[];
}

/**
 * Plain TS shape for embedded pagination — the factory wraps this
 * into `TablePaginationType` internally.
 *
 * @property pageSize - Items per page
 * @property page - Current 0-based page index
 * @property onPageChange - Callback fired with the new page index
 */
export interface TablePaginationInput {
    pageSize: SubtypeExprOrValue<IntegerType>;
    page: SubtypeExprOrValue<IntegerType>;
    onPageChange: SubtypeExprOrValue<FunctionType<[IntegerType], NullType>>;
}

/**
 * Plain TS shape for embedded row-selection — the factory wraps this
 * into `TableSelectionType` internally.
 *
 * @property mode - Selection mode (string literal `"single"` / `"multiple"` / `"range"` or East variant expr)
 * @property selected - Currently-selected row indices
 * @property onChange - Callback fired with the new selected row indices
 */
export interface TableSelectionInput {
    mode: SubtypeExprOrValue<TableSelectionModeType> | TableSelectionModeLiteral;
    selected: SubtypeExprOrValue<ArrayType<IntegerType>>;
    onChange: SubtypeExprOrValue<FunctionType<[ArrayType<IntegerType>], NullType>>;
}

export interface TableOptions<ColumnKeys extends string = string> extends TableStyle<ColumnKeys> {
    /** Column-group heading row (type-checked `columnKeys`). */
    columnGroups?: TableColumnGroupInput<ColumnKeys>[];
    /** Single footer row — keys narrowed to the Table's columns. */
    footer?: { [K in ColumnKeys]?: TableFooterCellInput };
    /** Multiple footer rows. */
    footerRows?: Array<{ [K in ColumnKeys]?: TableFooterCellInput }>;
    /** Expandable-row detail callback. */
    expandedContent?: SubtypeExprOrValue<FunctionType<[IntegerType], UIComponentType>>;
    /** Embedded pagination state. */
    pagination?: TablePaginationInput;
    /** Embedded row-selection state. */
    selection?: TableSelectionInput;
    /**
     * Slice chrome — pass the bound handle and the table renders the frame
     * chassis itself: a header rail mounting the `affordances` (default
     * `["filter", "search"]`) and a derived-count footer. Chrome only: feed
     * the narrowed data explicitly via `data={Slice.rows([RowType], slice)}`.
     * `brush` is rejected — a table has no continuous axis.
     */
    slice?: SubtypeExprOrValue<SliceBindType>;
    /** Rail affordances when `slice` is set. Default `["filter", "search"]`. */
    affordances?: SliceAffordanceLiteral[];
}

// Re-export style types
export {
    TableVariantType,
    TableStyleType,
    TableSizeType,
    TableCellRenderContextType,
    type TableSizeLiteral,
    type TableStyle,
} from "./types.js";

/**
 * East type for a table column definition.
 *
 * @property key - The column key (field name)
 * @property dataType - The original field type
 * @property valueType - The type after value function
 * @property header - Optional header text
 * @property width - Optional fixed width (CSS value)
 * @property minWidth - Optional minimum width (CSS value)
 * @property maxWidth - Optional maximum width (CSS value)
 * @property render - East render function (required — the factory synthesizes a text default when the author omits it)
 */
export const TableColumnType = StructType({
    key: StringType,
    dataType: EastTypeType,
    valueType: EastTypeType,
    header: OptionType(StringType),
    width: OptionType(StringType),
    minWidth: OptionType(StringType),
    maxWidth: OptionType(StringType),
    render: FunctionType([TableCellRenderContextType], UIComponentType),
});

export type TableColumnType = typeof TableColumnType;

/**
 * East type for a table body cell — the sortable / filterable primitive
 * value itself.
 *
 * @remarks
 * A cell is a bare {@link LiteralValueType} variant (`Null` / `Boolean` /
 * `Integer` / `Float` / `String` / `DateTime` / `Blob`). Rendering always
 * goes through the column's `render` function (`TableColumnType.render`,
 * required — the factory synthesizes a capture-free text default when the
 * author omits it), so the IR carries no per-cell UI content (#206).
 */
export const TableCellType = LiteralValueType;
export type TableCellType = typeof TableCellType;


// ============================================================================
// Table Root Type
// ============================================================================

/**
 * Standalone East StructType mirror of the inline `Table` variant in
 * `component.ts`.
 *
 * @remarks
 * main carries content (`rows` / `columns` / `frozen` /
 * `columnGroups` / `footer` / `footerRows` / `expandedContent`),
 * config (`interactive` / `columnResize` / `virtualization` /
 * `density`), structured state (`rowStatus` / `pagination` /
 * `selection`), and behaviour (callbacks); `style` carries visual
 * fields only.
 *
 * @property rows - Row dict array
 * @property columns - Column definitions
 * @property frozen - Column keys to pin left
 * @property columnGroups - Optional column-group heading row
 * @property footer - Optional single footer row
 * @property footerRows - Optional multiple footer rows
 * @property expandedContent - Optional `(rowIndex) => UIComponent` expander
 * @property interactive - Row hover highlight
 * @property columnResize - Enable column resize
 * @property virtualization - Enable row virtualization
 * @property density - Density preset
 * @property rowStatus - `(rowIndex) => StatusToken` row-tint callback
 * @property pagination - Embedded pagination state
 * @property selection - Embedded row-selection state
 * @property onCellClick - Cell click callback
 * @property onCellDoubleClick - Cell double-click callback
 * @property onRowClick - Row click callback
 * @property onRowDoubleClick - Row double-click callback
 * @property onRowSelectionChange - Row selection change callback
 * @property onSortChange - Sort change callback
 * @property style - Optional visual style sub-struct
 */
export const TableRootType: StructType<{
    rows: ArrayType<DictType<StringType, typeof TableCellType>>,
    columns: ArrayType<typeof TableColumnType>,
    frozen: ArrayType<StringType>,
    columnGroups: OptionType<ArrayType<TableColumnGroupType>>,
    footer: OptionType<DictType<StringType, TableFooterCellType>>,
    footerRows: OptionType<ArrayType<DictType<StringType, TableFooterCellType>>>,
    expandedContent: OptionType<FunctionType<[IntegerType], UIComponentType>>,
    interactive: OptionType<BooleanType>,
    columnResize: OptionType<BooleanType>,
    virtualization: OptionType<BooleanType>,
    density: OptionType<typeof DensityType>,
    rowStatus: OptionType<FunctionType<[IntegerType], typeof StatusTokenType>>,
    pagination: OptionType<TablePaginationType>,
    selection: OptionType<TableSelectionType>,
    onCellClick: OptionType<FunctionType<[TableCellClickEventType], NullType>>,
    onCellDoubleClick: OptionType<FunctionType<[TableCellClickEventType], NullType>>,
    onRowClick: OptionType<FunctionType<[TableRowClickEventType], NullType>>,
    onRowDoubleClick: OptionType<FunctionType<[TableRowClickEventType], NullType>>,
    onRowSelectionChange: OptionType<FunctionType<[TableRowSelectionEventType], NullType>>,
    onSortChange: OptionType<FunctionType<[TableSortEventType], NullType>>,
    review: OptionType<RowReviewType>,
    reviewStatus: OptionType<FunctionType<[IntegerType], OptionType<StatusValueType>>>,
    reviewApproval: OptionType<FunctionType<[IntegerType], OptionType<ApprovalStateType>>>,
    slice: OptionType<typeof SliceChromeType>,
    style: OptionType<TableStyleType>,
}> = StructType({
    rows: ArrayType(DictType(StringType, TableCellType)),
    columns: ArrayType(TableColumnType),
    frozen: ArrayType(StringType),
    columnGroups: OptionType(ArrayType(TableColumnGroupType)),
    footer: OptionType(DictType(StringType, TableFooterCellType)),
    footerRows: OptionType(ArrayType(DictType(StringType, TableFooterCellType))),
    expandedContent: OptionType(FunctionType([IntegerType], UIComponentType)),
    interactive: OptionType(BooleanType),
    columnResize: OptionType(BooleanType),
    virtualization: OptionType(BooleanType),
    density: OptionType(DensityType),
    rowStatus: OptionType(FunctionType([IntegerType], StatusTokenType)),
    pagination: OptionType(TablePaginationType),
    selection: OptionType(TableSelectionType),
    onCellClick: OptionType(FunctionType([TableCellClickEventType], NullType)),
    onCellDoubleClick: OptionType(FunctionType([TableCellClickEventType], NullType)),
    onRowClick: OptionType(FunctionType([TableRowClickEventType], NullType)),
    onRowDoubleClick: OptionType(FunctionType([TableRowClickEventType], NullType)),
    onRowSelectionChange: OptionType(FunctionType([TableRowSelectionEventType], NullType)),
    onSortChange: OptionType(FunctionType([TableSortEventType], NullType)),
    // Optional review chrome (#264) — the shared contract's row-granularity
    // config (pinned-right Decision column + commitBar foot). `reviewStatus` /
    // `reviewApproval` are `(rowIndex) => Option<…>` accessors over the
    // UNSLICED row index (the Table's rowStatus idiom), inert without `review`.
    review: OptionType(RowReviewType),
    reviewStatus: OptionType(FunctionType([IntegerType], OptionType(StatusValueType))),
    reviewApproval: OptionType(FunctionType([IntegerType], OptionType(ApprovalStateType))),
    slice: OptionType(SliceChromeType),
    style: OptionType(TableStyleType),
});



/**
 * Type representing the Table structure.
 */
export type TableRootType = typeof TableRootType;

// ============================================================================
// Table (API following chart pattern)
// ============================================================================

/**
 * Base column configuration properties shared by all column types.
 */
interface TableColumnConfigBase {
    /** Column header text (defaults to column key if not provided) */
    header?: SubtypeExprOrValue<StringType>;
    /** Optional East render function called at render time with cell context */
    render?: SubtypeExprOrValue<FunctionType<[TableCellRenderContextType], UIComponentType>>;
    /** Optional cell click handler */
    onCellClick?: SubtypeExprOrValue<FunctionType<[TableCellClickEventType], NullType>>,
    /** Optional cell double-click handler */
    onCellDoubleClick?: SubtypeExprOrValue<FunctionType<[TableCellClickEventType], NullType>>,
    /** Optional sort change handler */
    onSortChange?: SubtypeExprOrValue<FunctionType<[TableSortEventType], NullType>>,
    /** Fixed column width (CSS value, e.g., "200px", "20%") */
    width?: SubtypeExprOrValue<StringType>;
    /** Minimum column width (CSS value) */
    minWidth?: SubtypeExprOrValue<StringType>;
    /** Maximum column width (CSS value) */
    maxWidth?: SubtypeExprOrValue<StringType>;
}


type CellType = NullType | BooleanType | IntegerType | FloatType | StringType | DateTimeType | BlobType;
/**
 * Column configuration for primitive fields (value function is optional).
 */
interface TableColumnConfigPrimitive<FieldType extends PrimitiveEastType = PrimitiveEastType, RowType extends StructType = StructType>
    extends TableColumnConfigBase {
    /** Optional function to extract a sortable/filterable value from the field */
    value?: (value: ExprType<FieldType>, row: ExprType<RowType>) => SubtypeExprOrValue<CellType>;
}

/**
 * Column configuration for complex fields (value function is required).
 */
interface TableColumnConfigComplex<FieldType extends EastType = EastType, RowType extends StructType = StructType>
    extends TableColumnConfigBase {
    /** Required function to extract a sortable/filterable value from complex fields */
    value: (value: ExprType<FieldType>, row: ExprType<RowType>) => SubtypeExprOrValue<CellType>;
}

/**
 * Column configuration for the Table API.
 *
 * @typeParam FieldType - The East type of the field being rendered
 * @typeParam RowType - The East struct type of the entire row
 *
 * @remarks
 * For primitive fields (Boolean, Integer, Float, String, DateTime), the `value` function is optional.
 * For complex fields (Struct, Dict, Array, etc.), the `value` function is required to extract
 * a sortable/filterable value.
 */
export type TableColumnConfig<FieldType extends EastType = EastType, RowType extends StructType = StructType> =
    FieldType extends PrimitiveEastType
    ? TableColumnConfigPrimitive<FieldType, RowType>
    : TableColumnConfigComplex<FieldType, RowType>;

/**
 * Creates a Table component following the chart pattern.
 *
 * @typeParam T - The struct type of each data row
 * @param data - Array of data structs
 * @param columns - Column specification: array of field names, or object with optional config
 * @param style - Optional table styling
 * @returns An East expression representing the table component
 *
 * @remarks
 * Columns can be specified as a simple array of field names, or an object
 * with optional header and render configuration.
 *
 * When render is not provided, fields render as Text automatically:
 * - String fields: `Text.Root(value)`
 * - Other types: `Text.Root(East.str\`\${value}\`)` (auto string conversion)
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Table, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Table.Root(
 *         [
 *             { name: "Alice", age: 30n, role: "Admin" },
 *             { name: "Bob", age: 25n, role: "User" },
 *         ],
 *         ["name", "age", "role"],
 *         { variant: "line", striped: true }
 *     );
 * });
 * ```
 */

// Helper types to extract struct fields from array data type
type ExtractStructFields<T> = T extends ArrayType<infer S>
    ? S extends StructType
    ? S["fields"]
    : never
    : never;

// Helper type to extract the row element type from an array type (always StructType due to constraint)
type ExtractRowType<T> = T extends ArrayType<infer S>
    ? S extends StructType
    ? S
    : StructType
    : StructType;

type DataFields<T extends SubtypeExprOrValue<ArrayType<StructType>>> = ExtractStructFields<TypeOf<T>>;
type DataRowType<T extends SubtypeExprOrValue<ArrayType<StructType>>> = ExtractRowType<TypeOf<T>>;

// Helper type to extract only primitive field keys from a struct's fields
type PrimitiveFieldKeys<Fields> = {
    [K in keyof Fields]: Fields[K] extends PrimitiveEastType ? K : never
}[keyof Fields];

/**
 * Column specification for the Table API.
 *
 * @remarks
 * - **Array form**: Only primitive field keys allowed (e.g., `["name", "age"]`)
 * - **Object form**: All fields allowed, but complex fields require a `value` function
 */
export type ColumnSpec<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    | PrimitiveFieldKeys<DataFields<NoInfer<T>>>[]
    | { [K in keyof DataFields<NoInfer<T>>]?: TableColumnConfig<DataFields<NoInfer<T>>[K], DataRowType<NoInfer<T>>> };

// Every key in the data struct is a valid column key. Deriving from T (rather
// than the columns object C) keeps inference reliable when C contains render
// functions or complex field types that would otherwise cause C to widen to
// the constraint union — which collapses `keyof C` to `never`.
export type DataFieldKeys<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    Extract<keyof DataFields<NoInfer<T>>, string>;

export function createTable<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    columns: ColumnSpec<T>,
    style?: TableOptions<DataFieldKeys<T>>
): ExprType<UIComponentType> {
    const data_expr = East.value(data) as ExprType<ArrayType<StructType>>;
    const field_types = Expr.type(data_expr).value.fields;

    // Normalize columns to object format
    // dataType: the original field type from the data struct
    // valueType: the type after applying value function (computed during row mapping)
    const columnEntries = Array.isArray(columns)
        ? (columns as string[]).map(key => [key, undefined] as const)
        : Object.entries(columns);

    const columns_obj = Object.fromEntries(columnEntries.map(([key, config]) => {
        const fieldType = field_types[key as keyof typeof field_types] as EastType;
        return [key, {
            ...config,
            dataType: toEastTypeValue(fieldType),
        }];
    })) as Record<string, TableColumnConfig & { dataType: EastTypeValue, valueType: EastTypeValue, }>;

    const rowType = Expr.type(data_expr).value as StructType;

    // Reify each column's value extractor ONCE into a real East function and
    // derive the column's valueType from the function's output type — checked
    // a single time here rather than during map expansion (#205).
    for (const [col_key, col_config] of Object.entries(columns_obj)) {
        const fieldType = field_types[col_key as keyof typeof field_types] as EastType;
        const valueFn = (col_config as any).value !== undefined
            ? reifyAccessor([fieldType, rowType], (col_config as any).value)
            : undefined;
        (col_config as any).valueFn = valueFn;
        const valueOutType = valueFn !== undefined
            ? (Expr.type(valueFn) as FunctionType).output as EastType
            : fieldType;
        const valueTypeTag = valueOutType.type as string;

        // check that the type is a valid LiteralValueType (primitive) tag
        if (
            valueTypeTag !== "Null" &&
            valueTypeTag !== "Boolean" &&
            valueTypeTag !== "Integer" &&
            valueTypeTag !== "Float" &&
            valueTypeTag !== "String" &&
            valueTypeTag !== "DateTime" &&
            valueTypeTag !== "Blob") {
            throw new Error(`Column "${col_key}" has value type "${valueTypeTag}" which is not a valid column type. Complex types require a value function that returns a primitive type.`);
        }
        (col_config as any).valueType = variant(valueTypeTag, null) as EastTypeValue;
    }

    const rows_mapped = mapRowsBlock(data_expr, DictType(StringType, TableCellType), ($, datum) => {
        const cells = $.let(new Map(), DictType(StringType, TableCellType));
        for (const [col_key, col_config] of Object.entries(columns_obj)) {
            const field_value = (datum as any)[col_key];
            const valueFn = (col_config as any).valueFn;

            // Cell value: call the column's reified value function, or use the
            // field value directly (primitive columns). Cells carry ONLY the
            // sortable primitive — rendering goes through the column's render
            // function (synthesized default below when the author omits it).
            const cellValue = valueFn !== undefined
                ? variant(col_config.valueType.type as any, valueFn(field_value, datum))
                : variant(col_config.valueType.type as any, field_value);

            $(cells.insert(col_key, cellValue));
        }
        return cells
    });

    // Create columns array from the columns config
    const columns_mapped: SubtypeExprOrValue<ArrayType<typeof TableColumnType>> = []

    for (const [key, config] of Object.entries(columns_obj)) {
        columns_mapped.push({
            key: key,
            dataType: config.dataType,
            valueType: config.valueType,
            header: config?.header !== undefined ? some(config.header) : some(key) as any,
            width: config?.width !== undefined ? some(config.width) : none as any,
            minWidth: config?.minWidth !== undefined ? some(config.minWidth) : none as any,
            maxWidth: config?.maxWidth !== undefined ? some(config.maxWidth) : none as any,
            render: config?.render
                ? East.value(config.render, FunctionType([TableCellRenderContextType], UIComponentType))
                // Synthesized capture-free default: stringify the cell value via
                // the column's statically-known tag (Slice.config accessor precedent).
                : East.function([TableCellRenderContextType], UIComponentType, (_$, ctx) =>
                    Text.Root(East.str`${ctx.cellValue.unwrap((config as any).valueType.type)}`, {
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    })),
        });
    }

    // Reorder columns: frozen first, then the rest
    const frozenKeys = (style?.frozen ?? []) as string[];
    const frozenSet = new Set(frozenKeys);
    const columnsByKey = new Map(columns_mapped.map(c => [(c as any).key as string, c]));
    const orderedColumns: typeof columns_mapped = [
        ...frozenKeys.filter(key => columnsByKey.has(key)).map(key => columnsByKey.get(key)!),
        ...columns_mapped.filter(c => !frozenSet.has((c as any).key as string)),
    ];

    const columns_expr = East.value(orderedColumns, ArrayType(TableColumnType));
    const frozen_expr = East.value(frozenKeys, ArrayType(StringType));

    // Build the style object
    const variantValue = style?.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), TableVariantType)
            : style.variant)
        : undefined;

    const sizeValue = style?.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), TableSizeType)
            : style.size)
        : undefined;

    const colorPaletteValue = style?.colorPalette
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;

    const hasVisualStyle = !!style && (
        style.height !== undefined ||
        style.variant !== undefined ||
        style.size !== undefined ||
        style.striped !== undefined ||
        style.stickyHeader !== undefined ||
        style.showColumnBorder !== undefined ||
        style.colorPalette !== undefined ||
        (style as any).headerBackground !== undefined ||
        (style as any).headerColor !== undefined ||
        (style as any).borderColor !== undefined ||
        (style as any).zebraBackground !== undefined ||
        (style as any).hoverBackground !== undefined ||
        (style as any).selectedBackground !== undefined ||
        (style as any).selectedBorderColor !== undefined ||
        (style as any).footerBackground !== undefined ||
        (style as any).rowHeight !== undefined ||
        (style as any).plotGutter !== undefined
    );

    const styleValue = hasVisualStyle ? East.value({
        height: style!.height ? some(style!.height) : none,
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        striped: style!.striped !== undefined ? some(style!.striped) : none,
        stickyHeader: style!.stickyHeader !== undefined ? some(style!.stickyHeader) : none,
        showColumnBorder: style!.showColumnBorder !== undefined ? some(style!.showColumnBorder) : none,
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        headerBackground: (style as any)?.headerBackground !== undefined ? some((style as any).headerBackground) : none,
        headerColor: (style as any)?.headerColor !== undefined ? some((style as any).headerColor) : none,
        borderColor: (style as any)?.borderColor !== undefined ? some((style as any).borderColor) : none,
        zebraBackground: (style as any)?.zebraBackground !== undefined ? some((style as any).zebraBackground) : none,
        hoverBackground: (style as any)?.hoverBackground !== undefined ? some((style as any).hoverBackground) : none,
        selectedBackground: (style as any)?.selectedBackground !== undefined ? some((style as any).selectedBackground) : none,
        selectedBorderColor: (style as any)?.selectedBorderColor !== undefined ? some((style as any).selectedBorderColor) : none,
        footerBackground: (style as any)?.footerBackground !== undefined ? some((style as any).footerBackground) : none,
        rowHeight: (style as any)?.rowHeight !== undefined ? some((style as any).rowHeight) : none,
        plotGutter: (style as any)?.plotGutter !== undefined
            ? some(East.value({
                left:  (style as any).plotGutter.left  !== undefined ? some((style as any).plotGutter.left)  : none,
                right: (style as any).plotGutter.right !== undefined ? some((style as any).plotGutter.right) : none,
            }, PlotGutterType))
            : none,
    }, TableStyleType) : undefined;

    const densityValue = style?.density
        ? (typeof style.density === "string"
            ? East.value(variant(style.density, null), DensityType)
            : style.density)
        : undefined;

    const footerValue = style?.footer
        ? buildFooterDict(style.footer as Record<string, TableFooterCellInput>)
        : undefined;

    const footerRowsValue = style?.footerRows
        ? style.footerRows.map(r => buildFooterDict(r as Record<string, TableFooterCellInput>))
        : undefined;

    const expandedContentValue = style?.expandedContent !== undefined
        ? East.value(style.expandedContent, FunctionType([IntegerType], UIComponentType))
        : undefined;

    const rowStatusValue = style?.rowStatus !== undefined
        ? East.value(style.rowStatus, FunctionType([IntegerType], StatusTokenType))
        : undefined;

    const columnGroupsValue = style?.columnGroups !== undefined
        ? East.value(
            style.columnGroups.map(g => East.value({
                label: g.label,
                columnKeys: g.columnKeys as string[],
            }, TableColumnGroupType)),
            ArrayType(TableColumnGroupType),
        )
        : undefined;

    const paginationValue = style?.pagination !== undefined
        ? East.value({
            pageSize: style.pagination.pageSize,
            page: style.pagination.page,
            onPageChange: style.pagination.onPageChange,
        }, TablePaginationType)
        : undefined;

    const selectionValue = style?.selection !== undefined
        ? East.value({
            mode: typeof style.selection.mode === "string"
                ? East.value(variant(style.selection.mode as TableSelectionModeLiteral, null), TableSelectionModeType)
                : style.selection.mode,
            selected: style.selection.selected,
            onChange: style.selection.onChange,
        }, TableSelectionType)
        : undefined;

    if (style?.affordances?.includes("brush")) {
        throw new Error("Table does not support the 'brush' affordance — it has no continuous axis. Use it on a Chart or Gantt.");
    }
    const sliceChromeValue = style?.slice !== undefined
        ? East.value({
            slice: style.slice,
            affordances: East.value(
                (style.affordances ?? ["filter", "search"]).map(a => variant(a, null)),
                ArrayType(SliceAffordanceType),
            ),
        }, SliceChromeType)
        : undefined;

    return East.value(variant("Table", {
        rows: rows_mapped,
        columns: columns_expr,
        frozen: frozen_expr,
        columnGroups: columnGroupsValue ? some(columnGroupsValue) : none,
        footer: footerValue ? some(footerValue) : none,
        footerRows: footerRowsValue ? some(footerRowsValue) : none,
        expandedContent: expandedContentValue ? some(expandedContentValue) : none,
        interactive: style?.interactive !== undefined ? some(style.interactive) : none,
        columnResize: style?.columnResize !== undefined ? some(style.columnResize) : none,
        virtualization: style?.virtualization !== undefined ? some(style.virtualization) : none,
        density: densityValue ? some(densityValue) : none,
        rowStatus: rowStatusValue ? some(rowStatusValue) : none,
        review: style?.review !== undefined ? some(buildReview(style.review, RowReviewType)) : none,
        reviewStatus: style?.reviewStatus !== undefined
            ? some(East.value(style.reviewStatus, FunctionType([IntegerType], OptionType(StatusValueType))))
            : none,
        reviewApproval: style?.reviewApproval !== undefined
            ? some(East.value(style.reviewApproval, FunctionType([IntegerType], OptionType(ApprovalStateType))))
            : none,
        pagination: paginationValue ? some(paginationValue) : none,
        selection: selectionValue ? some(selectionValue) : none,
        slice: sliceChromeValue ? some(sliceChromeValue) : none,
        onCellClick: style?.onCellClick ? some(style.onCellClick) : none,
        onCellDoubleClick: style?.onCellDoubleClick ? some(style.onCellDoubleClick) : none,
        onRowClick: style?.onRowClick ? some(style.onRowClick) : none,
        onRowDoubleClick: style?.onRowDoubleClick ? some(style.onRowDoubleClick) : none,
        onRowSelectionChange: style?.onRowSelectionChange ? some(style.onRowSelectionChange) : none,
        onSortChange: style?.onSortChange ? some(style.onSortChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildFooterDict(row: Record<string, TableFooterCellInput>): ExprType<DictType<StringType, TableFooterCellType>> {
    const entries = new Map<string, ExprType<TableFooterCellType>>();
    for (const [key, cell] of Object.entries(row)) {
        entries.set(key, East.value({
            content: cell.content,
            colSpan: cell.colSpan !== undefined ? some(cell.colSpan) : none,
            rowSpan: cell.rowSpan !== undefined ? some(cell.rowSpan) : none,
        }, TableFooterCellType));
    }
    return East.value(entries, DictType(StringType, TableFooterCellType));
}

/**
 * TypeScript shape of the {@link Table} namespace export.
 *
 * @remarks
 * Internal aid for the typed namespace literal — Table itself is
 * documented on the `export const Table` declaration below.
 */
interface TableNamespace {
    Root: typeof createTable;
    Types: {
        Root: typeof TableRootType;
        Approval: ApprovalStateType;
        Review: RowReviewType;
        ApproveEvent: RowRefType;
        Style: typeof TableStyleType;
        Column: typeof TableColumnType;
        Cell: typeof TableCellType;
        Value: typeof LiteralValueType;
        Variant: typeof TableVariantType;
        Size: typeof TableSizeType;
        SelectionMode: typeof TableSelectionModeType;
        Selection: typeof TableSelectionType;
        Pagination: typeof TablePaginationType;
        ColumnGroup: typeof TableColumnGroupType;
        FooterCell: typeof TableFooterCellType;
        RowClickEvent: typeof TableRowClickEventType;
        CellClickEvent: typeof TableCellClickEventType;
        RowSelectionEvent: typeof TableRowSelectionEventType;
        SortEvent: typeof TableSortEventType;
        SortDirection: typeof TableSortDirectionType;
        CellRenderContext: typeof TableCellRenderContextType;
    };
}

/**
 * Table component for tabular data display.
 *
 * @remarks
 * Pass row data as an array of structs and declare columns with either
 * an array of primitive field names or an object keyed by field name
 * with per-column configuration (header text, width bounds, render
 * function, value extractor for non-primitive fields). The factory
 * builds the IR rows + columns from the struct shape, freezes columns
 * listed in `style.frozen`, threads visual + structural style through
 * the optional sub-struct, and forwards every callback (`onCellClick`,
 * `onRowClick`, `onSortChange`, etc.) onto the main `Table` variant.
 *
 * Use {@link Table.Root} to construct the component, and access
 * {@link Table.Types} for IR-level types — `Table.Types.Root`,
 * `Table.Types.Style`, `Table.Types.Column`, `Table.Types.Cell`,
 * `Table.Types.FooterCell`, `Table.Types.ColumnGroup`,
 * `Table.Types.Pagination`, `Table.Types.Selection`, etc.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Table, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Table.Root(
 *         [
 *             { name: "Alice", age: 30n },
 *             { name: "Bob", age: 25n },
 *         ],
 *         ["name", "age"],
 *         { variant: "line", striped: true, stickyHeader: true },
 *     );
 * });
 * ```
 */
export const Table: TableNamespace = {
    /**
     * Creates a Table component following the chart pattern.
     *
     * @typeParam T - The struct type of each data row
     * @param data - Array of data structs
     * @param columns - Column specification: array of field names, or object with optional config
     * @param style - Optional table styling
     * @returns An East expression representing the table component
     *
     * @remarks
     * Columns can be specified as a simple array of field names, or an object
     * with optional header and render configuration.
     *
     * When render is not provided, fields render as Text automatically:
     * - String fields: `Text.Root(value)`
     * - Other types: `Text.Root(East.str\`\${value}\`)` (auto string conversion)
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Table, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Table.Root(
     *         [
     *             { name: "Alice", age: 30n, role: "Admin" },
     *             { name: "Bob", age: 25n, role: "User" },
     *         ],
     *         ["name", "age", "role"],
     *         { variant: "line", striped: true }
     *     );
     * });
     * ```
     */
    Root: createTable,
    Types: {
        /**
         * East StructType for the full Table IR — content + state +
         * callbacks on the main struct, visual fields on the optional
         * `style` sub-struct.
         *
         * @remarks
         * main carries content (`rows`, `columns`, `frozen`,
         * `columnGroups`, `footer`, `footerRows`, `expandedContent`),
         * config (`interactive`, `columnResize`, `virtualization`,
         * `density`), structured state (`rowStatus`, `pagination`,
         * `selection`), and behaviour callbacks; `style` carries
         * visual-only fields (variant, colour overrides, sticky flags).
         * Mirror of the inline `Table` variant in `component.ts`.
         *
         * @property rows - Row dict array — each entry maps column key to {@link TableCellType}
         * @property columns - Column definitions ({@link TableColumnType}, including `dataType` and `valueType`)
         * @property frozen - Column keys to pin left (frozen columns appear first and stay visible during horizontal scroll)
         * @property columnGroups - Optional column-group heading row above the column header (renders a second `<thead>` row)
         * @property footer - Optional single footer row (dict of column-key to {@link TableFooterCellType})
         * @property footerRows - Optional multi-row footer (array of footer-row dicts)
         * @property expandedContent - Optional `(rowIndex) => UIComponent` — when defined, rows show an expand toggle and reveal a detail panel below the row
         * @property interactive - Row hover highlight (defaults to whatever the renderer picks when none)
         * @property columnResize - Enable column resize via header drag handle (defaults to true when none)
         * @property virtualization - Enable row virtualization (lazy TanStack Virtual; defaults to true when none)
         * @property density - Density preset — `compact` / `comfortable` / `cozy` ({@link DensityType})
         * @property rowStatus - `(rowIndex) => StatusToken` — per-row tint via the shared status palette
         * @property pagination - Embedded pagination state ({@link TablePaginationType}) — when defined, rows are sliced to the current page and a pager is rendered beneath the table
         * @property selection - Embedded row-selection state ({@link TableSelectionType}) — controlled-mode row selection in `single` / `multiple` / `range` modes
         * @property onCellClick - Cell click callback fired with {@link TableCellClickEventType}
         * @property onCellDoubleClick - Cell double-click callback
         * @property onRowClick - Row click callback fired with {@link TableRowClickEventType}
         * @property onRowDoubleClick - Row double-click callback
         * @property onRowSelectionChange - Row selection change callback fired with {@link TableRowSelectionEventType}
         * @property onSortChange - Sort change callback fired with {@link TableSortEventType}
         * @property style - Optional visual-only style sub-struct ({@link TableStyleType})
         */
        Root: TableRootType,
        /** A row's review decision — the shared `ApprovalStateType` (#264). */
        Approval: ApprovalStateType,
        /** The review configuration — the shared row-granularity `RowReviewType` (#264). */
        Review: RowReviewType,
        /** The per-row approve / reject payload — the shared `RowRefType` (`{ rowIndex }`, unsliced). */
        ApproveEvent: RowRefType,
        /**
         * East StructType holding every visual field for a Table —
         * visual-only.
         *
         * @remarks
         * All properties are optional and wrapped in {@link OptionType}.
         * Interactive wiring (`interactive`, `columnResize`,
         * `virtualization`, `density`, `rowStatus`) and all callbacks
         * live on the main `Table` variant — not here.
         *
         * @property height - CSS height for the table container (e.g. "500px", "100%")
         * @property variant - Table variant (`line` for horizontal-only borders, `outline` for full border outline)
         * @property size - Table size (`sm` / `md` / `lg`)
         * @property striped - Zebra-stripe rows
         * @property stickyHeader - Pin the header row while scrolling vertically
         * @property showColumnBorder - Borders between columns
         * @property colorPalette - Color scheme for hover / selection ({@link ColorSchemeType})
         * @property headerBackground - Explicit header background override
         * @property headerColor - Explicit header text colour override
         * @property borderColor - Explicit border colour override
         * @property zebraBackground - Explicit background for zebra-striped rows
         * @property hoverBackground - Explicit hover background
         * @property selectedBackground - Explicit background for selected rows
         * @property selectedBorderColor - Explicit border colour for selected rows
         * @property footerBackground - Explicit background for the footer row
         */
        Style: TableStyleType,
        /**
         * East StructType for a column definition.
         *
         * @remarks
         * `dataType` records the original East field type from the row
         * struct; `valueType` records the type after applying the
         * (optional) `value` extractor — both are stored as
         * {@link EastTypeValue} so the renderer can produce a
         * sortable / filterable comparator without round-tripping the
         * column config.
         *
         * @property key - Column key (the row-struct field name)
         * @property dataType - Original East type of the row field (as {@link EastTypeValue})
         * @property valueType - Cell value type after applying `value` extractor (as {@link EastTypeValue})
         * @property header - Optional header text (defaults to `key` when absent)
         * @property width - Optional fixed CSS width (e.g. "200px", "20%")
         * @property minWidth - Optional CSS minimum width
         * @property maxWidth - Optional CSS maximum width
         * @property render - `(context: TableCellRenderContextType) => UIComponent` — the cell renderer, required; the factory synthesizes a capture-free `Text.Root` stringify default when the author omits `render`
         */
        Column: TableColumnType,
        /**
         * East type for a table body cell — a bare {@link LiteralValueType}
         * variant.
         *
         * @remarks
         * The cell IS the sortable / filterable primitive value. Rendering
         * always goes through the column's `render` function
         * ({@link TableColumnType}.render, required — the factory synthesizes
         * a capture-free text default when the author omits it), so the IR
         * carries no per-cell UI content.
         */
        Cell: TableCellType,
        /**
         * Cell-value union — any primitive East value.
         *
         * @remarks
         * Alias for {@link LiteralValueType}. Tagged variant covering
         * `Null` / `Boolean` / `Integer` / `Float` / `String` /
         * `DateTime` / `Blob`. Sorting and filtering are defined on
         * this union.
         *
         * @property Null - The null cell
         * @property Boolean - Boolean cell
         * @property Integer - Integer cell
         * @property Float - Float cell
         * @property String - String cell
         * @property DateTime - DateTime cell
         * @property Blob - Blob cell
         */
        Value: LiteralValueType,
        /**
         * Table variant type for Chakra UI v3 table styling.
         *
         * @remarks
         * Pass the literal `"line"` or `"outline"` directly to
         * `Table.Root({ variant })` — the factory wraps the literal
         * into the East variant value.
         *
         * @property line - Table with horizontal lines between rows
         * @property outline - Table with full border outline
         */
        Variant: TableVariantType,
        /**
         * Size options for Table component.
         *
         * @remarks
         * Chakra UI Table only supports `sm` / `md` / `lg` (not `xs`).
         * Density preset (compact / comfortable / cozy) is a separate
         * field on the main struct ({@link Table.Types.Root}.density).
         *
         * @property sm - Small table — denser padding, smaller font
         * @property md - Medium table (default)
         * @property lg - Large table — looser padding, larger font
         */
        Size: TableSizeType,
        /**
         * Event payload fired when a row is clicked or double-clicked.
         *
         * @remarks
         * Used by both `onRowClick` and `onRowDoubleClick` callbacks
         * on the main {@link TableRootType}.
         *
         * @property rowIndex - The 0-based row index of the clicked row
         */
        RowClickEvent: TableRowClickEventType,
        /**
         * Event payload fired when a cell is clicked or double-clicked.
         *
         * @remarks
         * Used by both `onCellClick` and `onCellDoubleClick` callbacks
         * on the main {@link TableRootType}.
         *
         * @property rowIndex - The 0-based row index
         * @property columnKey - The column key (matches a row-struct field)
         * @property cellValue - The cell value as a {@link LiteralValueType}
         */
        CellClickEvent: TableCellClickEventType,
        /**
         * Event payload fired when row selection changes via the
         * uncontrolled checkbox model.
         *
         * @remarks
         * Used by `onRowSelectionChange` on the main
         * {@link TableRootType}. For controlled selection use
         * {@link Table.Types.Selection}.
         *
         * @property rowIndex - The 0-based row index that triggered the change
         * @property selected - Whether the row is now selected (true) or deselected (false)
         * @property selectedRowsIndices - Full array of currently selected row indices
         */
        RowSelectionEvent: TableRowSelectionEventType,
        /**
         * Event payload fired when sort column / direction changes.
         *
         * @remarks
         * Used by `onSortChange` on the main {@link TableRootType}.
         *
         * @property columnKey - The column key being sorted
         * @property sortIndex - The 0-based sort index (for multi-column sorting; 0 is the primary sort column)
         * @property sortDirection - The new sort direction ({@link TableSortDirectionType})
         */
        SortEvent: TableSortEventType,
        /**
         * Sort direction variant for table columns.
         *
         * @remarks
         * Returned in `SortEvent.sortDirection`. Pass the literal
         * `"asc"` or `"desc"` when constructing `SortEvent` IR
         * directly.
         *
         * @property asc - Ascending sort (smallest first)
         * @property desc - Descending sort (largest first)
         */
        SortDirection: TableSortDirectionType,
        /**
         * Context struct passed to column render functions at render
         * time.
         *
         * @remarks
         * `Column.render` is `(context: CellRenderContext) =>
         * UIComponent`. The renderer constructs a fresh context per
         * cell visit so render functions can build dynamic content
         * from the row index, column key, or cell value.
         *
         * @property rowIndex - The 0-based row index
         * @property columnKey - The column key
         * @property cellValue - The cell value as a {@link LiteralValueType}
         */
        CellRenderContext: TableCellRenderContextType,
        /**
         * Selection mode variant — `single` / `multiple` / `range`.
         *
         * @remarks
         * Drives how the renderer responds to row clicks when
         * controlled selection is active (see {@link TableSelectionType}).
         *
         * @property single - At most one row selected at a time; clicking another row replaces selection
         * @property multiple - Independent toggle per row (checkbox model)
         * @property range - Click + shift-click extends from last anchor; plain click resets to a single row
         */
        SelectionMode: TableSelectionModeType,
        /**
         * Row-selection state struct (controlled mode).
         *
         * @remarks
         * Lives on the main `Table` variant under `selection`. When
         * present, the renderer treats selection as controlled: the
         * `selected` array is the source of truth and the renderer
         * fires `onChange` with the new array on every selection
         * mutation.
         *
         * @property mode - Selection mode ({@link TableSelectionModeType})
         * @property selected - Currently-selected row indices
         * @property onChange - Callback fired with the new selected row indices
         */
        Selection: TableSelectionType,
        /**
         * Embedded pagination state for a Table.
         *
         * @remarks
         * Lives on the main `Table` variant under `pagination`. When
         * defined, the renderer slices `rows` to the current page,
         * disables virtualization (the page is small enough that
         * virtualization is redundant), and renders pager controls
         * beneath the table. Distinct from the standalone
         * `Pagination` primitive — use that primitive for paging UI
         * outside a Table.
         *
         * @property pageSize - Items per page
         * @property page - Current 0-based page index
         * @property onPageChange - Callback fired with the new 0-based page index
         */
        Pagination: TablePaginationType,
        /**
         * Column-group heading definition — renders a grouping row
         * above the column header.
         *
         * @remarks
         * Each group claims a contiguous span of `columnKeys`; the
         * renderer emits a second `<thead>` row with one `<th>` per
         * group spanning the matching column count. Columns not
         * referenced by any group render an empty cell in the group
         * row.
         *
         * @property label - Group heading text
         * @property columnKeys - Column keys covered by the group (must reference existing column keys; order is preserved)
         */
        ColumnGroup: TableColumnGroupType,
        /**
         * East StructType for a footer cell.
         *
         * @remarks
         * Footer cells are display-only — they don't participate in
         * sorting or filtering, so they don't carry a `value`
         * primitive. Callers render totals / labels via `content`
         * (e.g. `Text.Root("$560.00", { fontWeight: "bold" })`).
         * `colSpan` and `rowSpan` honour HTML table-cell merging.
         *
         * @property content - Rich cell content ({@link UIComponentType})
         * @property colSpan - Optional column span (1-based; defaults to 1 when absent)
         * @property rowSpan - Optional row span (1-based; defaults to 1 when absent)
         */
        FooterCell: TableFooterCellType,
    },
};
