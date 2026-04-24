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
    isTypeValueEqual,
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
import { Text } from "../../typography/index.js";
import { DensityType } from "../../style/interaction.js";
import { StatusTokenType } from "../../style/interaction.js";

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
 * @property render - Optional East render function
 */
export const TableColumnType = StructType({
    key: StringType,
    dataType: EastTypeType,
    valueType: EastTypeType,
    header: OptionType(StringType),
    width: OptionType(StringType),
    minWidth: OptionType(StringType),
    maxWidth: OptionType(StringType),
    render: OptionType(FunctionType([TableCellRenderContextType], UIComponentType)),
});

export type TableColumnType = typeof TableColumnType;

/**
 * East type for a table cell.
 *
 * @remarks
 * Defines the type for a table cell.
 *
 * @property value - The cell value as a LiteralValueType (for sorting/filtering)
 * @property content - UI component content for the cell (for rendering)
 */
export const TableCellType: StructType<{
    value: LiteralValueType,
    content: OptionType<UIComponentType>,
}> = StructType({
    value: LiteralValueType,
    content: OptionType(UIComponentType),
});


// ============================================================================
// Table Root Type
// ============================================================================

/**
 * Standalone East StructType mirror of the inline `Table` variant in
 * `component.ts`.
 *
 * @remarks
 * Per §0.10, main carries content (`rows` / `columns` / `frozen` /
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
type ColumnSpec<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    | PrimitiveFieldKeys<DataFields<NoInfer<T>>>[]
    | { [K in keyof DataFields<NoInfer<T>>]?: TableColumnConfig<DataFields<NoInfer<T>>[K], DataRowType<NoInfer<T>>> };

// Every key in the data struct is a valid column key. Deriving from T (rather
// than the columns object C) keeps inference reliable when C contains render
// functions or complex field types that would otherwise cause C to widen to
// the constraint union — which collapses `keyof C` to `never`.
type DataFieldKeys<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    Extract<keyof DataFields<NoInfer<T>>, string>;

export function createTable<
    T extends SubtypeExprOrValue<ArrayType<StructType>>,
    C extends ColumnSpec<T> = ColumnSpec<T>,
>(
    data: T,
    columns: C,
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

    const rows_mapped = data_expr.map(($, datum) => {
        const cells = $.let(new Map(), DictType(StringType, StructType({
            value: LiteralValueType,
            content: OptionType(UIComponentType),
        })));
        for (const [col_key, col_config] of Object.entries(columns_obj)) {
            const field_value = (datum as any)[col_key];
            const field_type = field_types[col_key];

            // Get cell value: use custom value function if provided, otherwise use field value directly
            // (for primitive types, this works; complex types require a value function)
            let cellValue;
            if ((col_config as any).value) {
                const customValue = East.value((col_config as any).value(field_value, datum as any));
                const customValueType = Expr.type(customValue) as EastType;
                cellValue = variant(customValueType.type as any, customValue);
            } else {
                cellValue = variant(field_type.type, field_value);
            }

            // get the value type tag from cellValue
            const valueTypeTag = cellValue.type as string;

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

            // get the valueType as EastTypeValue
            const valueType = variant(valueTypeTag, null) as EastTypeValue;

            // if valueType in columns_obj is already defined, check it matches
            if (col_config.valueType !== undefined) {
                if (!isTypeValueEqual(col_config.valueType, valueType)) {
                    throw new Error(`Column "${col_key}" has inconsistent value types across rows: expected "${col_config.valueType.type}" but got "${valueTypeTag}"`);
                }
            } else {
                // set the valueType for this column
                (col_config as any).valueType = valueType;
            }

            // When render is defined, cell content is none (renderer calls the render fn).
            // When render is not defined, cell content is some(Text.Root(...)) as default.
            const content = col_config.render
                ? none
                : some(East.value(
                    Text.Root(East.str`${field_value}`, {
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }),
                    UIComponentType
                ));

            $(cells.insert(col_key, {
                value: cellValue,
                content,
            }));
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
                ? some(East.value(config.render, FunctionType([TableCellRenderContextType], UIComponentType)))
                : none as any,
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
        (style as any).stickyFirstColumn !== undefined ||
        style.showColumnBorder !== undefined ||
        style.colorPalette !== undefined ||
        (style as any).headerBackground !== undefined ||
        (style as any).headerColor !== undefined ||
        (style as any).borderColor !== undefined ||
        (style as any).zebraBackground !== undefined ||
        (style as any).hoverBackground !== undefined ||
        (style as any).selectedBackground !== undefined ||
        (style as any).selectedBorderColor !== undefined ||
        (style as any).footerBackground !== undefined
    );

    const styleValue = hasVisualStyle ? East.value({
        height: style!.height ? some(style!.height) : none,
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        striped: style!.striped !== undefined ? some(style!.striped) : none,
        stickyHeader: style!.stickyHeader !== undefined ? some(style!.stickyHeader) : none,
        stickyFirstColumn: (style as any)?.stickyFirstColumn !== undefined ? some((style as any).stickyFirstColumn) : none,
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
        pagination: paginationValue ? some(paginationValue) : none,
        selection: selectionValue ? some(selectionValue) : none,
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
 * Table namespace following the chart pattern.
 *
 * @remarks
 * Pass data as an array of structs and configure columns with either
 * an array of field names or an object with optional header/render config.
 */
interface TableNamespace {
    Root: typeof createTable;
    Types: {
        Root: typeof TableRootType;
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
         * Type for Table component data.
         *
         * @remarks
         * Table displays data in rows and columns with optional styling.
         *
         * @property rows - Array of row data (Dict mapping column keys to UI components)
         * @property columns - Array of column definitions
         * @property style - Optional styling configuration
         */
        Root: TableRootType,
        /**
         * Style type for the table root component.
         *
         * @remarks
         * All properties are optional and wrapped in {@link OptionType}.
         *
         * @property variant - Table variant (line or outline)
         * @property size - Table size (sm, md, lg)
         * @property striped - Whether to show zebra stripes on rows
         * @property interactive - Whether to highlight rows on hover
         * @property stickyHeader - Whether the header sticks when scrolling
         * @property showColumnBorder - Whether to show borders between columns
         * @property colorPalette - Color scheme for interactive hover
         */
        Style: TableStyleType,
        /**
         * East type for a table column definition.
         *
         * @remarks
         * Defines the header text and key for a column.
         *
         * @property key - The column key (field name)
         * @property type - The column value type
         * @property header - Optional header text for the column
         */
        Column: TableColumnType,
        /**
         * East type for a table cell.
         *
         * @remarks
         * Defines the type for a table cell.
         *
         * @property value - The cell value as a LiteralValueType
         * @property content - UI component content for the cell
         */
        Cell: TableCellType,
        /**
         * Type for cell values (LiteralValueType - supports any primitive East value).
         */
        Value: LiteralValueType,
        /**
         * Table variant type for Chakra UI v3 table styling.
         *
         * @remarks
         * Create instances using the {@link TableVariant} function.
         *
         * @property line - Table with horizontal lines between rows
         * @property outline - Table with full border outline
         */
        Variant: TableVariantType,
        /**
         * Size options for Table component.
         *
         * @remarks
         * Chakra UI Table only supports sm, md, lg sizes (not xs).
         *
         * @property sm - Small table
         * @property md - Medium table (default)
         * @property lg - Large table
         */
        Size: TableSizeType,
        /**
         * Event type for row click callbacks.
         *
         * @property rowIndex - The index of the clicked row
         */
        RowClickEvent: TableRowClickEventType,
        /**
         * Event type for cell click callbacks.
         *
         * @property rowIndex - The row index
         * @property columnKey - The column key
         * @property cellValue - The cell value
         */
        CellClickEvent: TableCellClickEventType,
        /**
         * Event type for row selection change callbacks.
         *
         * @property rowIndex - The row index
         * @property selected - Whether the row is selected
         * @property selectedRowsIndices - Array of all selected row indices
         */
        RowSelectionEvent: TableRowSelectionEventType,
        /**
         * Event type for sort change callbacks.
         *
         * @property columnKey - The column key being sorted
         * @property sortIndex - The sort index (for multi-column sorting)
         * @property sortDirection - The sort direction
         */
        SortEvent: TableSortEventType,
        /**
         * Sort direction type (asc or desc).
         */
        SortDirection: TableSortDirectionType,
        /**
         * Context type passed to column render functions.
         *
         * @property rowIndex - The row index (0-based)
         * @property columnKey - The column key
         * @property cellValue - The cell value as a LiteralValueType
         */
        CellRenderContext: TableCellRenderContextType,
        /**
         * Selection mode variant — `single` / `multiple` / `range`.
         *
         * @property single - Only one row selected at a time
         * @property multiple - Multiple rows (checkbox model)
         * @property range - Click-drag range selection
         */
        SelectionMode: TableSelectionModeType,
        /**
         * Row-selection state struct.
         *
         * @property mode - Selection mode
         * @property selected - Currently selected row indices
         * @property onChange - Callback fired with the new selected indices
         */
        Selection: TableSelectionType,
        /**
         * Embedded pagination state for a Table.
         *
         * @property pageSize - Items per page
         * @property page - Current 0-based page index
         * @property onPageChange - Callback fired with the new page index
         */
        Pagination: TablePaginationType,
        /**
         * Column-group heading definition.
         *
         * @property label - Group heading text
         * @property columnKeys - Array of column keys covered by the group
         */
        ColumnGroup: TableColumnGroupType,
        /**
         * Footer-cell value.
         *
         * @property value - Literal cell value
         * @property content - Optional rich content
         * @property colSpan - Optional column-span
         * @property rowSpan - Optional row-span
         */
        FooterCell: TableFooterCellType,
    },
};
