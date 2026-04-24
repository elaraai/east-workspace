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
    DateTimeType,
    FloatType,
    IntegerType,
    NullType,
    FunctionType,
} from "@elaraai/east";

import { TableCellClickEventType, TableRowClickEventType, TableSortEventType } from "../table/types.js";

import {
    ColorSchemeType,
    type ColorSchemeLiteral,
} from "../../style.js";

// Import shared types from table
import {
    TableVariantType,
    TableSizeType,
    type TableVariantLiteral,
    type TableSizeLiteral,
} from "../table/types.js";

// Re-export table types used by Gantt
export {
    TableVariantType,
    TableSizeType,
    type TableVariantLiteral,
    type TableSizeLiteral,
} from "../table/types.js";

// ============================================================================
// Time Step Type
// ============================================================================

/**
 * Time step variant type for drag/duration snapping.
 *
 * @remarks
 * Each variant contains a float value representing the step size in that unit.
 *
 * @property minutes - Step size in minutes (e.g., 15 for 15-minute intervals)
 * @property hours - Step size in hours (e.g., 1 for hourly)
 * @property days - Step size in days (e.g., 1 for daily, 0.5 for half-day)
 * @property weeks - Step size in weeks (e.g., 1 for weekly)
 * @property months - Step size in months (e.g., 1 for monthly)
 */
export const TimeStepType = VariantType({
    minutes: FloatType,
    hours: FloatType,
    days: FloatType,
    weeks: FloatType,
    months: FloatType,
});

export type TimeStepType = typeof TimeStepType;

// ============================================================================
// Gantt Event Types
// ============================================================================

/**
 * Task event data for Gantt charts.
 *
 * @remarks
 * Represents a task bar spanning from start to end date. Per-task
 * colour escape hatches (`background`, `stroke`, `labelColor`,
 * `progressFill`) let callers override the default
 * `colorPalette`-derived palette without needing a theme change.
 *
 * @property start - Start date/time of the task
 * @property end - End date/time of the task
 * @property label - Optional label to display on the task bar
 * @property progress - Optional progress percentage (0-100)
 * @property colorPalette - Optional color scheme for the task bar
 * @property background - Optional explicit fill colour for the task bar
 * @property stroke - Optional explicit stroke/border colour
 * @property labelColor - Optional explicit colour for the task label
 * @property progressFill - Optional explicit fill colour for the progress segment
 */
export const GanttTaskType = StructType({
    start: DateTimeType,
    end: DateTimeType,
    label: OptionType(StringType),
    progress: OptionType(FloatType),
    colorPalette: OptionType(ColorSchemeType),
    background: OptionType(StringType),
    stroke: OptionType(StringType),
    labelColor: OptionType(StringType),
    progressFill: OptionType(StringType),
});

/**
 * Type representing the Gantt task structure.
 */
export type GanttTaskType = typeof GanttTaskType;

/**
 * Milestone event data for Gantt charts.
 *
 * @remarks
 * Represents a single point in time milestone. Per-milestone colour
 * escape hatches (`fill`, `stroke`, `labelColor`) let callers override
 * the default `colorPalette`-derived palette.
 *
 * @property date - The date/time of the milestone
 * @property label - Optional label to display near the milestone
 * @property colorPalette - Optional color scheme for the milestone marker
 * @property fill - Optional explicit fill colour for the milestone marker
 * @property stroke - Optional explicit stroke colour for the milestone marker
 * @property labelColor - Optional explicit colour for the milestone label
 */
export const GanttMilestoneType = StructType({
    date: DateTimeType,
    label: OptionType(StringType),
    colorPalette: OptionType(ColorSchemeType),
    fill: OptionType(StringType),
    stroke: OptionType(StringType),
    labelColor: OptionType(StringType),
});

/**
 * Type representing the Gantt milestone structure.
 */
export type GanttMilestoneType = typeof GanttMilestoneType;

/**
 * Gantt event variant type.
 *
 * @remarks
 * Events can be either tasks (with duration) or milestones (single point).
 *
 * @property Task - A task spanning from start to end date
 * @property Milestone - A milestone at a specific date
 */
export const GanttEventType = VariantType({
    Task: GanttTaskType,
    Milestone: GanttMilestoneType,
});

/**
 * Type representing the Gantt event variant.
 */
export type GanttEventType = typeof GanttEventType;

// ============================================================================
// Gantt Callback Event Types
// ============================================================================

/**
 * Event data for task click events.
 *
 * @property rowIndex - Row index (0-based)
 * @property taskIndex - Task index within the row (0-based)
 * @property taskStart - Start date/time of the task
 * @property taskEnd - End date/time of the task
 */
export const GanttTaskClickEventType = StructType({
    rowIndex: IntegerType,
    taskIndex: IntegerType,
    taskStart: DateTimeType,
    taskEnd: DateTimeType,
});

export type GanttTaskClickEventType = typeof GanttTaskClickEventType;

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
export const GanttTaskDragEventType = StructType({
    rowIndex: IntegerType,
    taskIndex: IntegerType,
    previousStart: DateTimeType,
    previousEnd: DateTimeType,
    newStart: DateTimeType,
    newEnd: DateTimeType,
});

export type GanttTaskDragEventType = typeof GanttTaskDragEventType;

/**
 * Event data for task progress change events.
 *
 * @property rowIndex - Row index (0-based)
 * @property taskIndex - Task index within the row (0-based)
 * @property previousProgress - Previous progress value (0-100)
 * @property newProgress - New progress value (0-100)
 */
export const GanttTaskProgressChangeEventType = StructType({
    rowIndex: IntegerType,
    taskIndex: IntegerType,
    previousProgress: FloatType,
    newProgress: FloatType,
});

export type GanttTaskProgressChangeEventType = typeof GanttTaskProgressChangeEventType;

/**
 * Event data for task duration change events (dragging task end).
 *
 * @property rowIndex - Row index (0-based)
 * @property taskIndex - Task index within the row (0-based)
 * @property previousEnd - Previous end date/time
 * @property newEnd - New end date/time
 */
export const GanttTaskDurationChangeEventType = StructType({
    rowIndex: IntegerType,
    taskIndex: IntegerType,
    previousEnd: DateTimeType,
    newEnd: DateTimeType,
});

export type GanttTaskDurationChangeEventType = typeof GanttTaskDurationChangeEventType;

/**
 * Event data for milestone click events.
 *
 * @property rowIndex - Row index (0-based)
 * @property milestoneIndex - Milestone index within the row (0-based)
 * @property milestoneDate - Date/time of the milestone
 */
export const GanttMilestoneClickEventType = StructType({
    rowIndex: IntegerType,
    milestoneIndex: IntegerType,
    milestoneDate: DateTimeType,
});

export type GanttMilestoneClickEventType = typeof GanttMilestoneClickEventType;

/**
 * Event data for milestone drag events.
 *
 * @property rowIndex - Row index (0-based)
 * @property milestoneIndex - Milestone index within the row (0-based)
 * @property previousDate - Previous date/time of the milestone
 * @property newDate - New date/time of the milestone
 */
export const GanttMilestoneDragEventType = StructType({
    rowIndex: IntegerType,
    milestoneIndex: IntegerType,
    previousDate: DateTimeType,
    newDate: DateTimeType,
});

export type GanttMilestoneDragEventType = typeof GanttMilestoneDragEventType;

/**
 * Style type for the Gantt component — visual-only per §0.10.
 *
 * @remarks
 * Interactive / drag-config / callbacks live on the main `Gantt`
 * variant in `component.ts`. This struct only carries visual fields.
 *
 * @property height - CSS height for the Gantt container
 * @property variant - Table variant (line or outline)
 * @property size - Table size (sm, md, lg)
 * @property striped - Whether to show zebra stripes on rows
 * @property stickyHeader - Whether the header sticks when scrolling
 * @property showColumnBorder - Whether to show borders between columns
 * @property colorPalette - Default color scheme for events
 * @property showToday - Whether to show a today marker line
 * @property gridColor - Explicit colour for the timeline grid lines
 * @property todayMarkerColor - Explicit colour for the today-marker line
 * @property headerBackground - Explicit background for the header row
 * @property headerColor - Explicit text colour for the header row
 */
export const GanttStyleType = StructType({
    height: OptionType(StringType),
    variant: OptionType(TableVariantType),
    size: OptionType(TableSizeType),
    striped: OptionType(BooleanType),
    stickyHeader: OptionType(BooleanType),
    showColumnBorder: OptionType(BooleanType),
    colorPalette: OptionType(ColorSchemeType),
    showToday: OptionType(BooleanType),
    gridColor: OptionType(StringType),
    todayMarkerColor: OptionType(StringType),
    headerBackground: OptionType(StringType),
    headerColor: OptionType(StringType),
});

/**
 * Type representing the Gantt style structure.
 */
export type GanttStyleType = typeof GanttStyleType;

/**
 * TypeScript interface for Gantt construction options.
 *
 * @remarks
 * Flat options bag — the factory splits into main-struct (content /
 * config / wiring / callbacks) and `style` sub-struct (visual-only)
 * per §0.10.
 *
 * @property frozen - Column keys to freeze (pin left)
 * @property height - CSS height
 * @property variant - Table variant — visual
 * @property size - Table size — visual
 * @property striped - Zebra stripes — visual
 * @property interactive - Row hover highlight — main
 * @property stickyHeader - Sticky header — visual
 * @property showColumnBorder - Column borders — visual
 * @property colorPalette - Default event colour scheme — visual
 * @property showToday - Today marker visibility — visual
 * @property gridColor - Grid-line colour override — visual
 * @property todayMarkerColor - Today-marker colour override — visual
 * @property headerBackground - Header background override — visual
 * @property headerColor - Header text-colour override — visual
 * @property dragStep - Drag-snap time step — main
 * @property durationStep - Duration-change snap step — main
 * @property onCellClick - Cell click callback — main
 * @property onCellDoubleClick - Cell double-click callback — main
 * @property onRowClick - Row click callback — main
 * @property onRowDoubleClick - Row double-click callback — main
 * @property onSortChange - Sort change callback — main
 * @property onTaskClick - Task click callback — main
 * @property onTaskDoubleClick - Task double-click callback — main
 * @property onTaskDrag - Task drag callback — main
 * @property onTaskDurationChange - Task duration change callback — main
 * @property onTaskProgressChange - Task progress change callback — main
 * @property onMilestoneClick - Milestone click callback — main
 * @property onMilestoneDoubleClick - Milestone double-click callback — main
 * @property onMilestoneDrag - Milestone drag callback — main
 */
export interface GanttStyle<ColumnKeys extends string = string> {
    /** Column keys to freeze (pin left). Frozen columns appear first and stay visible during horizontal scroll. */
    frozen?: ColumnKeys[];
    /** CSS height for the Gantt container (e.g., "500px", "100%") */
    height?: SubtypeExprOrValue<StringType>;
    /** Table variant (line or outline). */
    variant?: SubtypeExprOrValue<TableVariantType> | TableVariantLiteral;
    /** Table size (sm, md, lg). */
    size?: SubtypeExprOrValue<TableSizeType> | TableSizeLiteral;
    /** Whether to show zebra stripes on rows. */
    striped?: SubtypeExprOrValue<BooleanType>;
    /** Whether to highlight rows on hover. */
    interactive?: SubtypeExprOrValue<BooleanType>;
    /** Whether the header sticks when scrolling. */
    stickyHeader?: SubtypeExprOrValue<BooleanType>;
    /** Whether to show borders between columns. */
    showColumnBorder?: SubtypeExprOrValue<BooleanType>;
    /** Default color scheme for events. */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Whether to show a today marker line. */
    showToday?: SubtypeExprOrValue<BooleanType>;
    /** Explicit colour for the timeline grid lines. */
    gridColor?: SubtypeExprOrValue<StringType>;
    /** Explicit colour for the today-marker line. */
    todayMarkerColor?: SubtypeExprOrValue<StringType>;
    /** Explicit background for the header row. */
    headerBackground?: SubtypeExprOrValue<StringType>;
    /** Explicit text colour for the header row. */
    headerColor?: SubtypeExprOrValue<StringType>;
    /** Optional time step for drag snapping (e.g., variant("days", 1) for daily). */
    dragStep?: SubtypeExprOrValue<TimeStepType>;
    /** Optional time step for duration change snapping. */
    durationStep?: SubtypeExprOrValue<TimeStepType>;
    /** Row-status callback: `(rowIndex) => StatusToken`; renderer tints the row. */
    rowStatus?: unknown;
    /** Callback triggered when a cell is clicked. */
    onCellClick?: SubtypeExprOrValue<FunctionType<[TableCellClickEventType], NullType>>;
    /** Callback triggered when a cell is double-clicked. */
    onCellDoubleClick?: SubtypeExprOrValue<FunctionType<[TableCellClickEventType], NullType>>;
    /** Callback triggered when a row is clicked. */
    onRowClick?: SubtypeExprOrValue<FunctionType<[TableRowClickEventType], NullType>>;
    /** Callback triggered when a row is double-clicked. */
    onRowDoubleClick?: SubtypeExprOrValue<FunctionType<[TableRowClickEventType], NullType>>;
    /** Callback triggered when sorting changes. */
    onSortChange?: SubtypeExprOrValue<FunctionType<[TableSortEventType], NullType>>;
    /** Callback triggered when a task is clicked. */
    onTaskClick?: SubtypeExprOrValue<FunctionType<[GanttTaskClickEventType], NullType>>;
    /** Callback triggered when a task is double-clicked. */
    onTaskDoubleClick?: SubtypeExprOrValue<FunctionType<[GanttTaskClickEventType], NullType>>;
    /** Callback triggered when a task is dragged/resized. */
    onTaskDrag?: SubtypeExprOrValue<FunctionType<[GanttTaskDragEventType], NullType>>;
    /** Callback triggered when task duration changes (dragging task end). */
    onTaskDurationChange?: SubtypeExprOrValue<FunctionType<[GanttTaskDurationChangeEventType], NullType>>;
    /** Callback triggered when task progress changes. */
    onTaskProgressChange?: SubtypeExprOrValue<FunctionType<[GanttTaskProgressChangeEventType], NullType>>;
    /** Callback triggered when a milestone is clicked. */
    onMilestoneClick?: SubtypeExprOrValue<FunctionType<[GanttMilestoneClickEventType], NullType>>;
    /** Callback triggered when a milestone is double-clicked. */
    onMilestoneDoubleClick?: SubtypeExprOrValue<FunctionType<[GanttMilestoneClickEventType], NullType>>;
    /** Callback triggered when a milestone is dragged. */
    onMilestoneDrag?: SubtypeExprOrValue<FunctionType<[GanttMilestoneDragEventType], NullType>>;
}
