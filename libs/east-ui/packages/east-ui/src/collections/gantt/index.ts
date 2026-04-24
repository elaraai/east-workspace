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
    StringType,
    OptionType,
    DateTimeType,
    FloatType,
    variant,
    BooleanType,
    IntegerType,
    NullType,
    type TypeOf,
    some,
    none,
    toEastTypeValue,
    type EastType,
    type EastTypeValue,
    LiteralValueType,
    FunctionType,
    isTypeValueEqual,
} from "@elaraai/east";
import {
    TableCellClickEventType,
    TableRowClickEventType,
    TableSortEventType,
} from "../table/types.js";
import { TimeStepType } from "./types.js";

import { ColorSchemeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import {
    TableCellType,
    TableColumnType,
    type TableColumnConfig,
    TableCellRenderContextType,
} from "../table/index.js";
import { Text } from "../../typography/index.js";

import {
    GanttEventType,
    GanttTaskType,
    GanttMilestoneType,
    GanttStyleType,
    TableVariantType,
    TableSizeType,
    type GanttStyle,
    GanttTaskClickEventType,
    GanttTaskDragEventType,
    GanttTaskDurationChangeEventType,
    GanttTaskProgressChangeEventType,
    GanttMilestoneClickEventType,
    GanttMilestoneDragEventType,
} from "./types.js";
import { StatusTokenType } from "../../style/interaction.js";

// Re-export types
export {
    GanttEventType,
    GanttTaskType,
    GanttMilestoneType,
    GanttStyleType,
    TimeStepType,
    type GanttStyle,
} from "./types.js";

// ============================================================================
// Gantt Row Type
// ============================================================================

/**
 * East type for a Gantt row.
 *
 * @remarks
 * Each row has table cells (displayed on the left) and events (displayed on the right as a timeline).
 *
 * @property cells - Dict of column key to cell content (same as Table)
 * @property events - Array of events (Task or Milestone variants)
 */
export const GanttRowType = StructType({
    cells: DictType(StringType, TableCellType),
    events: ArrayType(GanttEventType),
});

/**
 * Type representing the Gantt row structure.
 */
export type GanttRowType = typeof GanttRowType;

// ============================================================================
// Gantt Root Type
// ============================================================================

/**
 * Standalone East StructType mirror of the inline `Gantt` variant in
 * `component.ts`.
 *
 * @remarks
 * Per §0.10, main carries content (`rows` / `columns` / `frozen`),
 * config (`interactive` / `dragStep` / `durationStep`), structured
 * state (`rowStatus`), and behaviour (callbacks); `style` carries
 * visual fields only.
 *
 * @property rows - Array of Gantt rows
 * @property columns - Array of column definitions (same as Table)
 * @property frozen - Column keys to freeze (pin left)
 * @property interactive - Row hover highlight toggle
 * @property dragStep - Drag-snap time step
 * @property durationStep - Duration-change snap step
 * @property rowStatus - Row-status callback: `(rowIndex) => StatusToken`
 * @property onCellClick - Cell click callback
 * @property onCellDoubleClick - Cell double-click callback
 * @property onRowClick - Row click callback
 * @property onRowDoubleClick - Row double-click callback
 * @property onSortChange - Sort change callback
 * @property onTaskClick - Task click callback
 * @property onTaskDoubleClick - Task double-click callback
 * @property onTaskDrag - Task drag callback
 * @property onTaskDurationChange - Task duration change callback
 * @property onTaskProgressChange - Task progress change callback
 * @property onMilestoneClick - Milestone click callback
 * @property onMilestoneDoubleClick - Milestone double-click callback
 * @property onMilestoneDrag - Milestone drag callback
 * @property style - Optional visual style sub-struct
 */
export const GanttRootType = StructType({
    rows: ArrayType(GanttRowType),
    columns: ArrayType(TableColumnType),
    frozen: ArrayType(StringType),
    interactive: OptionType(BooleanType),
    dragStep: OptionType(TimeStepType),
    durationStep: OptionType(TimeStepType),
    rowStatus: OptionType(FunctionType([IntegerType], StatusTokenType)),
    onCellClick: OptionType(FunctionType([TableCellClickEventType], NullType)),
    onCellDoubleClick: OptionType(FunctionType([TableCellClickEventType], NullType)),
    onRowClick: OptionType(FunctionType([TableRowClickEventType], NullType)),
    onRowDoubleClick: OptionType(FunctionType([TableRowClickEventType], NullType)),
    onSortChange: OptionType(FunctionType([TableSortEventType], NullType)),
    onTaskClick: OptionType(FunctionType([GanttTaskClickEventType], NullType)),
    onTaskDoubleClick: OptionType(FunctionType([GanttTaskClickEventType], NullType)),
    onTaskDrag: OptionType(FunctionType([GanttTaskDragEventType], NullType)),
    onTaskDurationChange: OptionType(FunctionType([GanttTaskDurationChangeEventType], NullType)),
    onTaskProgressChange: OptionType(FunctionType([GanttTaskProgressChangeEventType], NullType)),
    onMilestoneClick: OptionType(FunctionType([GanttMilestoneClickEventType], NullType)),
    onMilestoneDoubleClick: OptionType(FunctionType([GanttMilestoneClickEventType], NullType)),
    onMilestoneDrag: OptionType(FunctionType([GanttMilestoneDragEventType], NullType)),
    style: OptionType(GanttStyleType),
});

/**
 * Type representing the Gantt structure.
 */
export type GanttRootType = typeof GanttRootType;

// ============================================================================
// Task/Milestone Input Interfaces
// ============================================================================

/**
 * Input interface for creating a Task event.
 *
 * @property start - Start date/time of the task
 * @property end - End date/time of the task
 * @property label - Optional label to display on the task bar
 * @property progress - Optional progress percentage (0-100)
 * @property colorPalette - Optional color scheme for the task bar
 */
export interface TaskInput {
    start: SubtypeExprOrValue<DateTimeType>;
    end: SubtypeExprOrValue<DateTimeType>;
    label?: SubtypeExprOrValue<StringType>;
    progress?: SubtypeExprOrValue<FloatType>;
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | string;
    /** Explicit fill colour for the task bar. */
    background?: SubtypeExprOrValue<StringType>;
    /** Explicit stroke/border colour. */
    stroke?: SubtypeExprOrValue<StringType>;
    /** Explicit colour for the task label. */
    labelColor?: SubtypeExprOrValue<StringType>;
    /** Explicit fill colour for the progress segment. */
    progressFill?: SubtypeExprOrValue<StringType>;
}

/**
 * Input interface for creating a Milestone event.
 *
 * @property date - The date/time of the milestone
 * @property label - Optional label to display near the milestone
 * @property colorPalette - Optional color scheme for the milestone marker
 */
export interface MilestoneInput {
    date: SubtypeExprOrValue<DateTimeType>;
    label?: SubtypeExprOrValue<StringType>;
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | string;
    /** Explicit fill colour for the milestone marker. */
    fill?: SubtypeExprOrValue<StringType>;
    /** Explicit stroke colour for the milestone marker. */
    stroke?: SubtypeExprOrValue<StringType>;
    /** Explicit colour for the milestone label. */
    labelColor?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// Factory Functions for Events
// ============================================================================

/**
 * Creates a Task event for a Gantt row.
 *
 * @param input - Task configuration
 * @returns An East expression representing the Task event
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Gantt, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Gantt.Root(
 *         [{ name: "Task", start: new Date("2024-01-01"), end: new Date("2024-01-15") }],
 *         ["name"],
 *         row => [Gantt.Task({
 *             start: row.start,
 *             end: row.end,
 *             label: "Design Phase",
 *             progress: 75,
 *             colorPalette: "blue",
 *         })]
 *     );
 * });
 * ```
 */
function createTask(input: TaskInput): ExprType<GanttEventType> {
    const colorPaletteValue = input.colorPalette
        ? (typeof input.colorPalette === "string"
            ? East.value(variant(input.colorPalette as any, null), ColorSchemeType)
            : input.colorPalette)
        : undefined;

    return East.value(variant("Task", {
        start: input.start,
        end: input.end,
        label: input.label ? variant("some", input.label) : variant("none", null),
        progress: input.progress ? variant("some", input.progress) : variant("none", null),
        colorPalette: colorPaletteValue ? variant("some", colorPaletteValue) : variant("none", null),
        background: input.background !== undefined ? some(input.background) : none,
        stroke: input.stroke !== undefined ? some(input.stroke) : none,
        labelColor: input.labelColor !== undefined ? some(input.labelColor) : none,
        progressFill: input.progressFill !== undefined ? some(input.progressFill) : none,
    }), GanttEventType);
}

/**
 * Creates a Milestone event for a Gantt row.
 *
 * @param input - Milestone configuration
 * @returns An East expression representing the Milestone event
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Gantt, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Gantt.Root(
 *         [{ name: "Launch", date: new Date("2024-02-01") }],
 *         ["name"],
 *         row => [Gantt.Milestone({
 *             date: row.date,
 *             label: "Design Complete",
 *             colorPalette: "green",
 *         })]
 *     );
 * });
 * ```
 */
function createMilestone(input: MilestoneInput): ExprType<GanttEventType> {
    const colorPaletteValue = input.colorPalette
        ? (typeof input.colorPalette === "string"
            ? East.value(variant(input.colorPalette as any, null), ColorSchemeType)
            : input.colorPalette)
        : undefined;

    return East.value(variant("Milestone", {
        date: input.date,
        label: input.label ? variant("some", input.label) : variant("none", null),
        colorPalette: colorPaletteValue ? variant("some", colorPaletteValue) : variant("none", null),
        fill: input.fill !== undefined ? some(input.fill) : none,
        stroke: input.stroke !== undefined ? some(input.stroke) : none,
        labelColor: input.labelColor !== undefined ? some(input.labelColor) : none,
    }), GanttEventType);
}

// ============================================================================
// Gantt Column Configuration
// ============================================================================

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

// Column specification can be array of keys or object config
type ColumnSpec<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    | (keyof DataFields<NoInfer<T>>)[]
    | { [K in keyof DataFields<NoInfer<T>>]?: TableColumnConfig<DataFields<NoInfer<T>>[K], DataRowType<NoInfer<T>>> };

// Every key in the data struct is a valid column key. Deriving from T (rather
// than the columns object) keeps inference reliable when the column configs
// contain render functions or complex field types.
type DataFieldKeys<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    Extract<keyof DataFields<NoInfer<T>>, string>;

// ============================================================================
// Main Gantt Factory
// ============================================================================

/**
 * Creates a Gantt component following the Table pattern.
 *
 * @typeParam T - The struct type of each data row
 * @param data - Array of data structs
 * @param columns - Column specification for the left-side table columns
 * @param events - Function to extract events from each row
 * @param style - Optional Gantt styling
 * @returns An East expression representing the Gantt component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Gantt, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Gantt.Root(
 *         [
 *             { name: "Design", start: new Date("2024-01-01"), end: new Date("2024-01-15") },
 *             { name: "Development", start: new Date("2024-01-10"), end: new Date("2024-02-01") },
 *         ],
 *         ["name"],
 *         row => [Gantt.Task({ start: row.start, end: row.end })],
 *         { showToday: true }
 *     );
 * });
 * ```
 */
function createGantt<
    T extends SubtypeExprOrValue<ArrayType<StructType>>,
    C extends ColumnSpec<T> = ColumnSpec<T>,
>(
    data: T,
    columns: C,
    events: (row: ExprType<TypeOf<T> extends ArrayType<infer E> ? E : never>) => SubtypeExprOrValue<ArrayType<GanttEventType>>,
    style?: GanttStyle<DataFieldKeys<T>>
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
    })) as Record<string, TableColumnConfig & { dataType: EastTypeValue; valueType: EastTypeValue }>;

    // Map each data row to a GanttRow with cells and events
    const rows_mapped = data_expr.map(($, datum) => {
        // Build cells dict (same as Table)
        const cells = $.let(new Map(), DictType(StringType, StructType({
            value: LiteralValueType,
            content: OptionType(UIComponentType)
        })));

        for (const [col_key, col_config] of Object.entries(columns_obj)) {
            const field_value = (datum as any)[col_key];
            const field_type = field_types[col_key];

            // Get cell value: use custom value function if provided, otherwise use field value directly
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
            if (valueTypeTag !== "Null" && valueTypeTag !== "Boolean" && valueTypeTag !== "Integer" &&
                valueTypeTag !== "Float" && valueTypeTag !== "String" && valueTypeTag !== "DateTime" &&
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

        // Get events from the row using the events function
        const row_events = events(datum as any);

        return East.value({
            cells: cells,
            events: row_events,
        }, GanttRowType);
    });

    // Create columns array from the columns config
    const columns_mapped: SubtypeExprOrValue<ArrayType<typeof TableColumnType>> = [];
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

    // Build style value
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
            ? East.value(variant(style.colorPalette as any, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;

    const hasStyle = !!style && (
        style.height !== undefined ||
        style.variant !== undefined ||
        style.size !== undefined ||
        style.striped !== undefined ||
        style.stickyHeader !== undefined ||
        style.showColumnBorder !== undefined ||
        style.colorPalette !== undefined ||
        style.showToday !== undefined ||
        style.gridColor !== undefined ||
        style.todayMarkerColor !== undefined ||
        style.headerBackground !== undefined ||
        style.headerColor !== undefined
    );

    const styleValue = hasStyle ? East.value({
        height: style!.height ? some(style!.height) : none,
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        striped: style!.striped !== undefined ? some(style!.striped) : none,
        stickyHeader: style!.stickyHeader !== undefined ? some(style!.stickyHeader) : none,
        showColumnBorder: style!.showColumnBorder !== undefined ? some(style!.showColumnBorder) : none,
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        showToday: style!.showToday !== undefined ? some(style!.showToday) : none,
        gridColor: style!.gridColor !== undefined ? some(style!.gridColor) : none,
        todayMarkerColor: style!.todayMarkerColor !== undefined ? some(style!.todayMarkerColor) : none,
        headerBackground: style!.headerBackground !== undefined ? some(style!.headerBackground) : none,
        headerColor: style!.headerColor !== undefined ? some(style!.headerColor) : none,
    }, GanttStyleType) : undefined;

    return East.value(variant("Gantt", {
        rows: rows_mapped,
        columns: columns_expr,
        frozen: frozen_expr,
        interactive: style?.interactive !== undefined ? some(style.interactive) : none,
        dragStep: style?.dragStep ? some(style.dragStep) : none,
        durationStep: style?.durationStep ? some(style.durationStep) : none,
        rowStatus: style?.rowStatus !== undefined
            ? some(East.value(style.rowStatus, FunctionType([IntegerType], StatusTokenType)))
            : none,
        onCellClick: style?.onCellClick ? some(style.onCellClick) : none,
        onCellDoubleClick: style?.onCellDoubleClick ? some(style.onCellDoubleClick) : none,
        onRowClick: style?.onRowClick ? some(style.onRowClick) : none,
        onRowDoubleClick: style?.onRowDoubleClick ? some(style.onRowDoubleClick) : none,
        onSortChange: style?.onSortChange ? some(style.onSortChange) : none,
        onTaskClick: style?.onTaskClick ? some(style.onTaskClick) : none,
        onTaskDoubleClick: style?.onTaskDoubleClick ? some(style.onTaskDoubleClick) : none,
        onTaskDrag: style?.onTaskDrag ? some(style.onTaskDrag) : none,
        onTaskDurationChange: style?.onTaskDurationChange ? some(style.onTaskDurationChange) : none,
        onTaskProgressChange: style?.onTaskProgressChange ? some(style.onTaskProgressChange) : none,
        onMilestoneClick: style?.onMilestoneClick ? some(style.onMilestoneClick) : none,
        onMilestoneDoubleClick: style?.onMilestoneDoubleClick ? some(style.onMilestoneDoubleClick) : none,
        onMilestoneDrag: style?.onMilestoneDrag ? some(style.onMilestoneDrag) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

// ============================================================================
// Namespace Export
// ============================================================================

interface GanttTypesShape {
    Root: GanttRootType;
    Row: GanttRowType;
    Event: GanttEventType;
    Task: GanttTaskType;
    Milestone: GanttMilestoneType;
    Style: GanttStyleType;
    Column: TableColumnType;
    Cell: typeof TableCellType;
    TaskClickEvent: GanttTaskClickEventType;
    TaskDragEvent: GanttTaskDragEventType;
    TaskProgressChangeEvent: GanttTaskProgressChangeEventType;
    TaskDurationChangeEvent: GanttTaskDurationChangeEventType;
    MilestoneClickEvent: GanttMilestoneClickEventType;
    MilestoneDragEvent: GanttMilestoneDragEventType;
}

const GanttTypes: GanttTypesShape = {
    /**
     * Type for Gantt component data.
     *
     * @remarks
     * Gantt displays rows with time-based events (tasks and milestones).
     * The time range is derived from the events' domain.
     *
     * @property rows - Array of Gantt rows
     * @property columns - Array of column definitions (same as Table)
     * @property style - Optional styling configuration
     */
    Root: GanttRootType,
    /**
     * East type for a Gantt row.
     *
     * @remarks
     * Each row has table cells (displayed on the left) and events (displayed on the right as a timeline).
     *
     * @property cells - Dict of column key to cell content (same as Table)
     * @property events - Array of events (Task or Milestone variants)
     */
    Row: GanttRowType,
    /**
     * Gantt event variant type.
     *
     * @remarks
     * Events can be either tasks (with duration) or milestones (single point).
     *
     * @property Task - A task spanning from start to end date
     * @property Milestone - A milestone at a specific date
     */
    Event: GanttEventType,
    /**
     * Task event data for Gantt charts.
     *
     * @remarks
     * Represents a task bar spanning from start to end date.
     *
     * @property start - Start date/time of the task
     * @property end - End date/time of the task
     * @property label - Optional label to display on the task bar
     * @property progress - Optional progress percentage (0-100)
     * @property colorPalette - Optional color scheme for the task bar
     */
    Task: GanttTaskType,
    /**
     * Milestone event data for Gantt charts.
     *
     * @remarks
     * Represents a single point in time milestone.
     *
     * @property date - The date/time of the milestone
     * @property label - Optional label to display near the milestone
     * @property colorPalette - Optional color scheme for the milestone marker
     */
    Milestone: GanttMilestoneType,
    /**
     * Style type for the Gantt component.
     *
     * @remarks
     * All properties are optional and wrapped in {@link OptionType}.
     * Reuses table styling properties where applicable.
     *
     * @property variant - Table variant (line or outline)
     * @property size - Table size (sm, md, lg)
     * @property striped - Whether to show zebra stripes on rows
     * @property interactive - Whether to highlight rows on hover
     * @property stickyHeader - Whether the header sticks when scrolling
     * @property showColumnBorder - Whether to show borders between columns
     * @property colorPalette - Default color scheme for events
     * @property showToday - Whether to show a today marker line
     */
    Style: GanttStyleType,
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
     * @property value - The cell value as a literal
     * @property content - Optional UI component content for the cell
     */
    Cell: TableCellType,
    /**
     * Event data for task click events.
     *
     * @property rowIndex - Row index (0-based)
     * @property taskIndex - Task index within the row (0-based)
     * @property taskStart - Start date/time of the task
     * @property taskEnd - End date/time of the task
     */
    TaskClickEvent: GanttTaskClickEventType,
    /**
     * Event data for task drag/resize events.
     *
     * @property rowIndex - Row index (0-based)
     * @property taskIndex - Task index within the row (0-based)
     * @property previousStart - Previous start date/time
     * @property previousEnd - Previous end date/time
     * @property newStart - New start date/time
     * @property newEnd - New end date/time
     */
    TaskDragEvent: GanttTaskDragEventType,
    /**
     * Event data for task progress change events.
     *
     * @property rowIndex - Row index (0-based)
     * @property taskIndex - Task index within the row (0-based)
     * @property previousProgress - Previous progress value (0-100)
     * @property newProgress - New progress value (0-100)
     */
    TaskProgressChangeEvent: GanttTaskProgressChangeEventType,
    /**
     * Event data for task duration change events.
     *
     * @property rowIndex - Row index (0-based)
     * @property taskIndex - Task index within the row (0-based)
     * @property previousEnd - Previous end date/time
     * @property newEnd - New end date/time
     */
    TaskDurationChangeEvent: GanttTaskDurationChangeEventType,
    /**
     * Event data for milestone click events.
     *
     * @property rowIndex - Row index (0-based)
     * @property milestoneIndex - Milestone index within the row (0-based)
     * @property milestoneDate - Date/time of the milestone
     */
    MilestoneClickEvent: GanttMilestoneClickEventType,
    /**
     * Event data for milestone drag events.
     *
     * @property rowIndex - Row index (0-based)
     * @property milestoneIndex - Milestone index within the row (0-based)
     * @property previousDate - Previous date/time of the milestone
     * @property newDate - New date/time of the milestone
     */
    MilestoneDragEvent: GanttMilestoneDragEventType,
};

interface GanttNamespace {
    Root: typeof createGantt;
    Task: typeof createTask;
    Milestone: typeof createMilestone;
    Types: typeof GanttTypes;
}

/**
 * Gantt namespace for creating Gantt chart components.
 *
 * @remarks
 * Gantt charts display time-based events (tasks and milestones) in rows.
 * Each row has table columns on the left and a timeline with events on the right.
 * The API follows the Table pattern for column configuration.
 */
const GanttImpl: GanttNamespace = {
    /**
     * Creates a Gantt component following the Table pattern.
     *
     * @typeParam T - The struct type of each data row
     * @param data - Array of data structs
     * @param columns - Column specification for the left-side table columns
     * @param events - Function to extract events from each row
     * @param style - Optional Gantt styling
     * @returns An East expression representing the Gantt component
     *
     * @remarks
     * Gantt charts display time-based events (tasks and milestones) in rows.
     * Each row has table columns on the left and a timeline with events on the right.
     * The API follows the Table pattern for column configuration.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Gantt, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Gantt.Root(
     *         [
     *             { name: "Design", start: new Date("2024-01-01"), end: new Date("2024-01-15") },
     *             { name: "Development", start: new Date("2024-01-10"), end: new Date("2024-02-01") },
     *         ],
     *         ["name"],
     *         row => [Gantt.Task({ start: row.start, end: row.end })],
     *         { showToday: true }
     *     );
     * });
     * ```
     */
    Root: createGantt,
    /**
     * Creates a Task event for a Gantt row.
     *
     * @param input - Task configuration
     * @returns An East expression representing the Task event
     *
     * @remarks
     * Tasks represent work items that span a duration from start to end date.
     * Tasks can show progress and be styled with different colors.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Gantt, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Gantt.Root(
     *         [{ name: "Task", start: new Date("2024-01-01"), end: new Date("2024-01-15") }],
     *         ["name"],
     *         row => [Gantt.Task({
     *             start: row.start,
     *             end: row.end,
     *             label: "Design Phase",
     *             progress: 75,
     *             colorPalette: "blue",
     *         })]
     *     );
     * });
     * ```
     */
    Task: createTask,
    /**
     * Creates a Milestone event for a Gantt row.
     *
     * @param input - Milestone configuration
     * @returns An East expression representing the Milestone event
     *
     * @remarks
     * Milestones represent single points in time (e.g., deadlines, releases).
     * They appear as markers on the timeline rather than bars.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Gantt, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Gantt.Root(
     *         [{ name: "Launch", date: new Date("2024-02-01") }],
     *         ["name"],
     *         row => [Gantt.Milestone({
     *             date: row.date,
     *             label: "Launch",
     *             colorPalette: "green",
     *         })]
     *     );
     * });
     * ```
     */
    Milestone: createMilestone,
    Types: GanttTypes,
};

export const Gantt: typeof GanttImpl = GanttImpl;
