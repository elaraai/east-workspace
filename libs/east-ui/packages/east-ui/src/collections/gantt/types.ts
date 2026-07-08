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

import { StatusTokenType, DensityType, type DensityLiteral } from "../../style/interaction.js";
import { PlotGutterType, type PlotGutter } from "../../shared/plot-gutter.js";
import { SliceBindType } from "../../platform/slice/index.js";
import { type SliceAffordanceLiteral } from "../../contracts/slice-affordances.js";

// Re-export shared content primitives for ergonomic discovery via Gantt.Types.*.
export { AlignType, LabelInputType, type AlignLiteral, type LabelInput } from "../../style.js";

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
// Milestone Kind
// ============================================================================

// NOTE (#262, breaking): the private `GanttTaskStatusType`
// (committed / proposed / atRisk) has been removed. A task's audit state is
// now the shared event lifecycle `PlannerStateType`
// (committed / proposed(added|model|removed) / rejected) on `GanttTaskType.state`,
// and risk moved to the status axis: per-task `status: Option<StatusValueType>`
// (e.g. the old `"atRisk"` becomes `status: "danger"`) alongside the existing
// per-row `rowStatus`.

/**
 * Kind of a milestone diamond — drives its fill colour.
 *
 * @property interim - Intermediate checkpoint (amber).
 * @property release - Shippable deliverable (brand teal).
 */
export const GanttMilestoneKindType = VariantType({
    interim: NullType,
    release: NullType,
});

export type GanttMilestoneKindType = typeof GanttMilestoneKindType;

/** String shorthand for {@link GanttMilestoneKindType}. */
export type GanttMilestoneKindLiteral = "interim" | "release";

// ============================================================================
// Time Axis (domain + tick format + header granularity)
// ============================================================================

/**
 * Header granularity for the Gantt time axis — the size of the labelled band
 * the axis header draws, and the boundary the dashed gridlines snap to.
 *
 * @remarks
 * `auto` lets the renderer pick a sensible interval (and tick count) from the
 * visible span and pixel width via the visx time scale; the rest force a fixed
 * calendar interval.
 *
 * @property auto - Interval + count chosen automatically from span / width
 * @property day - One band per day
 * @property week - One band per week
 * @property month - One band per calendar month
 * @property quarter - One band per calendar quarter
 * @property year - One band per calendar year
 */
export const GanttTierType = VariantType({
    auto: NullType,
    day: NullType,
    week: NullType,
    month: NullType,
    quarter: NullType,
    year: NullType,
});

export type GanttTierType = typeof GanttTierType;

/** String shorthand for {@link GanttTierType}. */
export type GanttTierLiteral = "auto" | "day" | "week" | "month" | "quarter" | "year";

/**
 * Explicit time-domain bounds for the Gantt axis.
 *
 * @property min - Earliest instant shown (left edge)
 * @property max - Latest instant shown (right edge)
 */
export const GanttAxisRangeType = StructType({
    min: DateTimeType,
    max: DateTimeType,
});

export type GanttAxisRangeType = typeof GanttAxisRangeType;

/**
 * Declarative time-axis configuration — the Gantt analogue of the Planner's
 * `axis`, specialised to the single time scale a Gantt always uses.
 *
 * @remarks
 * All three fields are optional: omit `range` to fit the domain to the data
 * (with padding), omit `format` to let the renderer pick a label pattern for
 * the tier, omit `tier` (or use `auto`) to let visx choose the tick interval +
 * count. When set, `range` pins the visible window, `format` is a date pattern
 * (`MMM` / `MMM YYYY` / `YYYY` — same tokens as Chart tick formats), and `tier`
 * forces the header band granularity.
 *
 * @property range - Explicit `{ min, max }` window; omitted ⇒ derived from data
 * @property format - Tick-label date pattern (e.g. `"MMM"`, `"MMM d"`, `"YYYY"`)
 * @property tier - Header band granularity (auto / day / week / month / quarter / year)
 */
export const GanttAxisType = StructType({
    range: OptionType(GanttAxisRangeType),
    format: OptionType(StringType),
    tier: OptionType(GanttTierType),
});

export type GanttAxisType = typeof GanttAxisType;

/**
 * TypeScript input for the ergonomic `axis` option on {@link GanttStyle}.
 *
 * @remarks
 * Flat JS in, fully-enveloped {@link GanttAxisType} out — the factory wraps the
 * optional fields in `some` / `none` and converts the `tier` string shorthand
 * to an East variant. Every field accepts a plain value or an East expression.
 *
 * @property range - Explicit `{ min, max }` time window (Dates or expressions)
 * @property format - Tick-label date pattern string
 * @property tier - Header band granularity; string shorthand or East variant
 */
export interface GanttAxisInput {
    /** Explicit `{ min, max }` time window. Omit to fit the domain to the data. */
    range?: { min: SubtypeExprOrValue<DateTimeType>; max: SubtypeExprOrValue<DateTimeType> };
    /** Tick-label date pattern (e.g. `"MMM"`, `"MMM YYYY"`, `"YYYY"`). Omit for a tier-derived default. */
    format?: SubtypeExprOrValue<StringType>;
    /** Header band granularity. String shorthand (`"month"`) or an East variant. Default `"auto"`. */
    tier?: SubtypeExprOrValue<GanttTierType> | GanttTierLiteral;
}

// NOTE: `GanttTaskType` and `GanttMilestoneType` are UIComp-coupled
// (they carry `tooltip` / `popover` UIComponent slots) and live in
// `./index.ts` alongside the factory. types.ts stays
// UIComp-free so it can be imported by `component.ts` without a
// circular dependency. The previous `GanttEventType` variant has been
// dropped — Gantt rows now expose `tasks` and `milestones` as separate
// arrays, which removes the variant ceremony at the call site and
// gives per-subtype TS narrowing for free.

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
 * Style type for the Gantt component — visual-only.
 *
 * @remarks
 * Interactive / drag-config / callbacks live on the main `Gantt`
 * variant in `component.ts`. This struct only carries visual fields.
 *
 * @property height - CSS height for the Gantt container
 * @property variant - Table variant (line or outline)
 * @property size - Table size (sm, md, lg)
 * @property density - Density preset driving row + header height (compact / condensed / comfortable)
 * @property striped - Whether to show zebra stripes on rows
 * @property stickyHeader - Whether the header sticks when scrolling
 * @property showColumnBorder - Whether to show borders between columns
 * @property showToday - Whether to show the now-line
 */
export const GanttStyleType = StructType({
    height: OptionType(StringType),
    variant: OptionType(TableVariantType),
    size: OptionType(TableSizeType),
    density: OptionType(DensityType),
    striped: OptionType(BooleanType),
    stickyHeader: OptionType(BooleanType),
    showColumnBorder: OptionType(BooleanType),
    showToday: OptionType(BooleanType),
    rowHeight: OptionType(IntegerType),
    plotGutter: OptionType(PlotGutterType),
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
 * config / wiring / callbacks) and `style` sub-struct (visual-only).
 *
 * @property frozen - Column keys to freeze (pin left)
 * @property height - CSS height
 * @property variant - Table variant — visual
 * @property size - Table size — visual
 * @property density - Density preset (row + header height) — visual
 * @property striped - Zebra stripes — visual
 * @property interactive - Row hover highlight — main
 * @property stickyHeader - Sticky header — visual
 * @property showColumnBorder - Column borders — visual
 * @property showToday - Now-line visibility — visual
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
    /**
     * Slice chrome — pass the bound handle and the Gantt renders its own
     * header rail mounting the `affordances` (default
     * `["filter", "search", "range"]`). With `"brush"` listed, dragging a
     * window on the timeline writes the slice's range. Chrome only: feed the
     * narrowed rows explicitly via `Slice.rows([RowType], slice)`.
     */
    slice?: SubtypeExprOrValue<SliceBindType>;
    /** Rail affordances when `slice` is set. Default `["filter", "search", "range"]`. */
    affordances?: SliceAffordanceLiteral[];
    /** Time-axis configuration — explicit `{ min, max }` window, tick-label `format`, and header `tier`. Omit to fit the domain to the data with an auto-chosen tick interval. */
    axis?: GanttAxisInput;
    /** CSS height for the Gantt container (e.g., "500px", "100%") */
    height?: SubtypeExprOrValue<StringType>;
    /** Table variant (line or outline). */
    variant?: SubtypeExprOrValue<TableVariantType> | TableVariantLiteral;
    /** Table size (sm, md, lg). */
    size?: SubtypeExprOrValue<TableSizeType> | TableSizeLiteral;
    /** Density preset driving row + header height (compact / condensed / comfortable). Overrides `size` when set. */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Explicit pixel row height. Overrides `density` when set, and flows through to the virtualizer (both panes + bars). */
    rowHeight?: SubtypeExprOrValue<IntegerType>;
    /** Shared plot gutter (#147) — pins the timeline to `[left, W−right]` (px) so the Gantt lines up under a stacked Chart on a shared time axis; the frozen table columns fill `left`. Usually supplied by an enclosing `<AlignedStack>`. */
    plotGutter?: PlotGutter;
    /** Whether to show zebra stripes on rows. */
    striped?: SubtypeExprOrValue<BooleanType>;
    /** Whether the header sticks when scrolling. */
    stickyHeader?: SubtypeExprOrValue<BooleanType>;
    /** Whether to show borders between columns. */
    showColumnBorder?: SubtypeExprOrValue<BooleanType>;
    /** Whether to show the now-line. */
    showToday?: SubtypeExprOrValue<BooleanType>;
    /** Optional time step for drag snapping (e.g., variant("days", 1) for daily). */
    dragStep?: SubtypeExprOrValue<TimeStepType>;
    /** Optional time step for duration change snapping. */
    durationStep?: SubtypeExprOrValue<TimeStepType>;
    /** Row-status callback: `(rowIndex) => StatusToken`; renderer tints the row. */
    rowStatus?: SubtypeExprOrValue<FunctionType<[IntegerType], StatusTokenType>>;
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
