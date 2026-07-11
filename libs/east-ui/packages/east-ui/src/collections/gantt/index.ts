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
    IntegerType,
    NullType,
    type TypeOf,
    some,
    none,
    toEastTypeValue,
    type EastType,
    type EastTypeValue,
    FunctionType,
} from "@elaraai/east";
import {
    TableCellClickEventType,
    TableRowClickEventType,
    TableSortEventType,
} from "../table/types.js";
import { TimeStepType, GanttMilestoneKindType, GanttAxisType, GanttAxisRangeType, GanttTierType } from "./types.js";
import { PlannerStateType } from "../planner/types.js";
import { resolveEventState } from "../planner/index.js";
import { StatusValueType, type StatusValueLiteral } from "../../feedback/status/types.js";
import { ApprovalStateType, RowRefType, RowReviewType, buildReview } from "../../contracts/review.js";
import { CanDropFnType, DragEventType } from "../../contracts/drag.js";
import type { GanttMilestoneKindLiteral, GanttAxisInput, GanttTierLiteral } from "./types.js";

import {
    AlignType,
    LabelInputType,
    FontWeightType,
    FontStyleType,
    SizeType,
    type AlignLiteral,
    type LabelInput,
} from "../../style.js";
import { UIComponentType } from "../../component.js";
import { mapRowsBlock, reifyAccessor } from "../../shared/reify.js";
import { SliceChromeType } from "../../platform/slice/index.js";
import { SliceAffordanceType } from "../../contracts/slice-affordances.js";
import { DensityType } from "../../style/interaction.js";
import { PlotGutterType } from "../../shared/plot-gutter.js";
import {
    TableCellType,
    TableColumnType,
    type TableColumnConfig,
    TableCellRenderContextType,
} from "../table/index.js";
import { Text } from "../../typography/index.js";

import {
    GanttStyleType,
    TableVariantType,
    TableSizeType,
    type GanttStyle,
    GanttTaskClickEventType,
    GanttTaskProgressChangeEventType,
    GanttMilestoneClickEventType,
} from "./types.js";
import { StatusTokenType } from "../../style/interaction.js";

// Re-export types
export {
    GanttStyleType,
    TimeStepType,
    GanttMilestoneKindType,
    GanttAxisType,
    GanttAxisRangeType,
    GanttTierType,
    type GanttMilestoneKindLiteral,
    type GanttTierLiteral,
    type GanttAxisInput,
    type GanttStyle,
} from "./types.js";
// The shared event lifecycle a task's `state` carries (#262).
export { PlannerStateType } from "../planner/types.js";

// ============================================================================
// Gantt Task / Milestone (UIComp-coupled — defined here, not in types.ts)
// ============================================================================

/**
 * East StructType for a Gantt task bar.
 *
 * @remarks
 * Spans from `start` to `end`. `state` is the shared event lifecycle
 * (`PlannerStateType`: committed / proposed(added|model|removed) /
 * rejected — the same audit grammar as Planner / Roster / Board, #262);
 * it drives the bar's treatment (colour, dash, ghost, strike). `status`
 * is the orthogonal **risk/status axis** (the old `"atRisk"` becomes
 * `status: "danger"`): a semantic tint over the state treatment.
 * `popover` (click-triggered) accepts any UIComponent for rich detail.
 *
 * @property start - Start date/time of the task
 * @property end - End date/time of the task
 * @property label - Optional rich label (text + alignment + typography)
 * @property progress - Optional progress percentage (0-100)
 * @property state - The audit state (shared `PlannerStateType` lifecycle)
 * @property status - Optional risk/status tint (success / warning / danger / info / neutral)
 * @property popover - Optional rich popover (click-triggered, UIComponent)
 */
export const GanttTaskType: StructType<{
    start: DateTimeType,
    end: DateTimeType,
    label: OptionType<LabelInputType>,
    progress: OptionType<FloatType>,
    state: PlannerStateType,
    status: OptionType<StatusValueType>,
    popover: OptionType<UIComponentType>,
}> = StructType({
    start: DateTimeType,
    end: DateTimeType,
    label: OptionType(LabelInputType),
    progress: OptionType(FloatType),
    state: PlannerStateType,
    status: OptionType(StatusValueType),
    popover: OptionType(UIComponentType),
});

export type GanttTaskType = typeof GanttTaskType;

/**
 * East StructType for a Gantt milestone marker.
 *
 * @remarks
 * Single point in time (no duration). `kind` (interim / release)
 * drives the diamond's fill. Same `popover` rich-content surface as
 * tasks.
 *
 * @property date - The date/time of the milestone
 * @property label - Optional rich label
 * @property kind - Optional milestone kind driving the diamond fill (default release)
 * @property popover - Optional rich popover (click, UIComponent)
 */
export const GanttMilestoneType: StructType<{
    date: DateTimeType,
    label: OptionType<LabelInputType>,
    kind: OptionType<GanttMilestoneKindType>,
    popover: OptionType<UIComponentType>,
}> = StructType({
    date: DateTimeType,
    label: OptionType(LabelInputType),
    kind: OptionType(GanttMilestoneKindType),
    popover: OptionType(UIComponentType),
});

export type GanttMilestoneType = typeof GanttMilestoneType;

// ============================================================================
// Gantt Row Type
// ============================================================================

/**
 * East type for a Gantt row.
 *
 * @remarks
 * Each row has table cells (displayed on the left) and two timeline-
 * track arrays on the right: `tasks` (duration bars) and `milestones`
 * (single-point markers). The previous variant `events` array has
 * been retired — splitting by subtype removes variant ceremony at the
 * call site and gives per-subtype TS narrowing for free.
 *
 * @property cells - Dict of column key to cell value (a bare `LiteralValueType`, same as Table)
 * @property tasks - Array of task bars (start + end DateTime)
 * @property milestones - Array of milestone markers (single DateTime)
 */
export const GanttRowType: StructType<{
    cells: DictType<StringType, typeof TableCellType>,
    tasks: ArrayType<GanttTaskType>,
    milestones: ArrayType<GanttMilestoneType>,
    status: OptionType<StatusValueType>,
    approval: OptionType<ApprovalStateType>,
}> = StructType({
    cells: DictType(StringType, TableCellType),
    tasks: ArrayType(GanttTaskType),
    milestones: ArrayType(GanttMilestoneType),
    // Review chrome (only meaningful when the root carries `review`, #263):
    status: OptionType(StatusValueType),       // the quiet row dot (absent ⇒ clean)
    approval: OptionType(ApprovalStateType),   // the row's review decision (absent ⇒ no decision)
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
 * main carries content (`rows` / `columns` / `frozen`),
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
 * @property id - DnD target identity (#268)
 * @property sources - Library ids accepted for `add` drags
 * @property onDrag - Shared drag-grammar funnel (add / move / resize)
 * @property canDrop - Optional IR-level drop veto
 * @property onTaskProgressChange - Task progress change callback
 * @property onMilestoneClick - Milestone click callback
 * @property onMilestoneDoubleClick - Milestone double-click callback
 * @property review - Optional review chrome (shared contract, #263)
 * @property style - Optional visual style sub-struct
 */
export const GanttRootType: StructType<{
    rows: ArrayType<GanttRowType>,
    columns: ArrayType<typeof TableColumnType>,
    frozen: ArrayType<StringType>,
    axis: OptionType<GanttAxisType>,
    dragStep: OptionType<TimeStepType>,
    durationStep: OptionType<TimeStepType>,
    rowStatus: OptionType<FunctionType<[IntegerType], StatusTokenType>>,
    onCellClick: OptionType<FunctionType<[TableCellClickEventType], NullType>>,
    onCellDoubleClick: OptionType<FunctionType<[TableCellClickEventType], NullType>>,
    onRowClick: OptionType<FunctionType<[TableRowClickEventType], NullType>>,
    onRowDoubleClick: OptionType<FunctionType<[TableRowClickEventType], NullType>>,
    onSortChange: OptionType<FunctionType<[TableSortEventType], NullType>>,
    onTaskClick: OptionType<FunctionType<[GanttTaskClickEventType], NullType>>,
    onTaskDoubleClick: OptionType<FunctionType<[GanttTaskClickEventType], NullType>>,
    id: StringType,
    sources: ArrayType<StringType>,
    onDrag: OptionType<FunctionType<[DragEventType], NullType>>,
    canDrop: OptionType<CanDropFnType>,
    onTaskProgressChange: OptionType<FunctionType<[GanttTaskProgressChangeEventType], NullType>>,
    onMilestoneClick: OptionType<FunctionType<[GanttMilestoneClickEventType], NullType>>,
    onMilestoneDoubleClick: OptionType<FunctionType<[GanttMilestoneClickEventType], NullType>>,
    review: OptionType<RowReviewType>,
    slice: OptionType<typeof SliceChromeType>,
    style: OptionType<GanttStyleType>,
}> = StructType({
    rows: ArrayType(GanttRowType),
    columns: ArrayType(TableColumnType),
    frozen: ArrayType(StringType),
    axis: OptionType(GanttAxisType),
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
    // DnD target role (#268) — `id` + `sources` connect the Gantt to sibling
    // Libraries; ALL completed drags (Library `add` landing as proposed(added)
    // bars, task-body `move`, edge `resize`) arrive through the ONE shared
    // `onDrag` grammar callback. The renderer registers the target iff
    // `onDrag` is present. Cell encoding (contracts/drag.ts): `row` = the row
    // index key, `slot` = the snapped ISO instant, `event` = `t<taskIndex>` /
    // `m<milestoneIndex>`.
    id: StringType,
    sources: ArrayType(StringType),
    onDrag: OptionType(FunctionType([DragEventType], NullType)),
    canDrop: OptionType(CanDropFnType),
    onTaskProgressChange: OptionType(FunctionType([GanttTaskProgressChangeEventType], NullType)),
    onMilestoneClick: OptionType(FunctionType([GanttMilestoneClickEventType], NullType)),
    onMilestoneDoubleClick: OptionType(FunctionType([GanttMilestoneClickEventType], NullType)),
    // Optional review chrome (#263) — the shared contract's row-granularity
    // config: per-row Approve/Reject decision column + the commitBar foot.
    // Absent ⇒ a plain Gantt (row `status`/`approval` are inert).
    review: OptionType(RowReviewType),
    slice: OptionType(SliceChromeType),
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
 * TypeScript interface for the ergonomic input passed to {@link createTask}
 * (`Gantt.Task`).
 *
 * @remarks
 * The factory normalises this flat input into a fully-shaped East
 * `GanttTaskType` value — wrapping each optional field in its
 * `OptionType` envelope and converting variant string literals
 * (`"blue"`, `"start"`, `"bold"`) to East variant values. Every field
 * accepts either a plain JS value or an East expression via
 * {@link SubtypeExprOrValue}.
 *
 * @property start - Start date/time of the task
 * @property end - End date/time of the task
 * @property label - Plain string shorthand expands to `{ value: <string> }`; or a full {@link LabelInput} for alignment / typography overrides
 * @property progress - Progress percentage (0-100)
 * @property state - The audit state — a `PlannerStateType` value or a string shorthand. Default `"committed"`.
 * @property status - Optional risk/status tint (a `StatusValueType` value or status string)
 * @property popover - Click-triggered rich popover content (UIComponent), coexists with `onTaskClick`
 */
export interface TaskInput {
    /** Start date/time of the task */
    start: SubtypeExprOrValue<DateTimeType>;
    /** End date/time of the task */
    end: SubtypeExprOrValue<DateTimeType>;
    /** Task label. Plain string shorthand expands to `{ value: <string> }`; pass a full {@link LabelInput} for alignment / typography overrides. */
    label?: SubtypeExprOrValue<StringType> | LabelInput;
    /** Progress percentage (0-100) */
    progress?: SubtypeExprOrValue<FloatType>;
    /** The audit state — the shared event lifecycle (`PlannerStateType`), or one
     *  of the string shorthands `"committed"` / `"rejected"` / `"added"` /
     *  `"model"` / `"removed"`. Default `"committed"`.
     *
     *  Migration (#262): the old 3-arm `status` is gone — `status: "committed"`
     *  ⇒ `state: "committed"` (the default), `status: "proposed"` ⇒
     *  `state: "added"` (operator) or `"model"` (machine suggestion), and
     *  `status: "atRisk"` ⇒ keep the lifecycle state and set the risk tint
     *  `status: "danger"`. */
    state?: SubtypeExprOrValue<PlannerStateType> | "committed" | "rejected" | "added" | "model" | "removed";
    /** Optional risk/status tint — a `StatusValueType` value or a status string
     *  (`"success"` / `"warning"` / `"danger"` / `"info"` / `"neutral"`).
     *  Tints the bar colour over the state treatment (the status axis the old
     *  `"atRisk"` moved to). */
    status?: SubtypeExprOrValue<StatusValueType> | StatusValueLiteral;
    /** Rich popover content (click-triggered UIComponent). Coexists with `onTaskClick`. */
    popover?: SubtypeExprOrValue<UIComponentType>;
}

/**
 * TypeScript interface for the ergonomic input passed to {@link createMilestone}
 * (`Gantt.Milestone`).
 *
 * @remarks
 * Same option/variant normalisation as `Gantt.Task` — flat TS input
 * in, fully-shaped East `GanttMilestoneType` value out.
 *
 * @property date - The date/time of the milestone
 * @property label - Plain string shorthand expands to `{ value: <string> }`; or a full {@link LabelInput} for alignment / typography overrides
 * @property kind - Milestone kind driving the diamond fill (interim / release). Default release.
 * @property popover - Click-triggered rich popover content (UIComponent), coexists with `onMilestoneClick`
 */
export interface MilestoneInput {
    /** The date/time of the milestone */
    date: SubtypeExprOrValue<DateTimeType>;
    /** Milestone label. Plain string shorthand expands to `{ value: <string> }`; pass a full {@link LabelInput} for alignment / typography overrides. */
    label?: SubtypeExprOrValue<StringType> | LabelInput;
    /** Milestone kind — drives the diamond fill (interim = amber, release = brand teal). Default `"release"`. */
    kind?: SubtypeExprOrValue<GanttMilestoneKindType> | GanttMilestoneKindLiteral;
    /** Rich popover content (click-triggered UIComponent). Coexists with `onMilestoneClick`. */
    popover?: SubtypeExprOrValue<UIComponentType>;
}

// ============================================================================
// Factory Functions for Events
// ============================================================================

function buildAlignValue(a: AlignLiteral | SubtypeExprOrValue<AlignType> | undefined): SubtypeExprOrValue<AlignType> | undefined {
    if (a === undefined) return undefined;
    if (typeof a === "string") {
        return East.value(variant(a as AlignLiteral, null), AlignType);
    }
    return a;
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
        align: li.align !== undefined ? some(buildAlignValue(li.align)!) : none,
        verticalAlign: li.verticalAlign !== undefined ? some(buildAlignValue(li.verticalAlign)!) : none,
        color: li.color !== undefined ? some(li.color) : none,
        fontWeight: fontWeightValue ? some(fontWeightValue) : none,
        fontStyle: fontStyleValue ? some(fontStyleValue) : none,
        fontSize: fontSizeValue ? some(fontSizeValue) : none,
    }, LabelInputType);
}

/**
 * Builds a single Gantt task East value from an ergonomic TS input.
 *
 * @param input - Task configuration ({@link TaskInput})
 * @returns An East expression of {@link GanttTaskType}
 *
 * @remarks
 * Internal implementation of `Gantt.Task` — see the namespace JSDoc
 * for the externally-visible contract. Normalises optional fields
 * into their `OptionType` envelopes and converts variant string
 * literals to East variant values.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Gantt, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ => {
 *     return Gantt.Root(
 *         [{ name: "Task", start: new Date("2024-01-01"), end: new Date("2024-01-15") }],
 *         ["name"],
 *         row => ({ tasks: [Gantt.Task({
 *             start: row.start,
 *             end: row.end,
 *             label: "Design Phase",
 *             progress: 75,
 *             state: "committed",
 *         })] }),
 *     );
 * });
 * ```
 */
function createTask(input: TaskInput): ExprType<GanttTaskType> {
    const statusValue = input.status
        ? (typeof input.status === "string"
            ? East.value(variant(input.status, null), StatusValueType)
            : input.status)
        : undefined;

    return East.value({
        start: input.start,
        end: input.end,
        label: input.label !== undefined ? some(buildLabel(input.label)) : none,
        progress: input.progress !== undefined ? some(input.progress) : none,
        state: resolveEventState(input.state ?? "committed"),
        status: statusValue ? some(statusValue) : none,
        popover: input.popover !== undefined ? some(input.popover) : none,
    }, GanttTaskType);
}

/**
 * Builds a single Gantt milestone East value from an ergonomic TS input.
 *
 * @param input - Milestone configuration ({@link MilestoneInput})
 * @returns An East expression of {@link GanttMilestoneType}
 *
 * @remarks
 * Internal implementation of `Gantt.Milestone` — see the namespace
 * JSDoc for the externally-visible contract.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Gantt, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ => {
 *     return Gantt.Root(
 *         [{ name: "Launch", date: new Date("2024-02-01") }],
 *         ["name"],
 *         row => ({ milestones: [Gantt.Milestone({
 *             date: row.date,
 *             label: "Design Complete",
 *             kind: "release",
 *         })] }),
 *     );
 * });
 * ```
 */
function createMilestone(input: MilestoneInput): ExprType<GanttMilestoneType> {
    const kindValue = input.kind
        ? (typeof input.kind === "string"
            ? East.value(variant(input.kind, null), GanttMilestoneKindType)
            : input.kind)
        : undefined;

    return East.value({
        date: input.date,
        label: input.label !== undefined ? some(buildLabel(input.label)) : none,
        kind: kindValue ? some(kindValue) : none,
        popover: input.popover !== undefined ? some(input.popover) : none,
    }, GanttMilestoneType);
}

/**
 * Builds the Gantt time-axis East value from the ergonomic {@link GanttAxisInput}.
 *
 * @remarks
 * Wraps the optional `range` / `format` / `tier` into their `some` / `none`
 * envelopes and converts the `tier` string shorthand to an East variant — flat
 * TS input in, fully-shaped {@link GanttAxisType} value out.
 */
function buildGanttAxis(input: GanttAxisInput): ExprType<GanttAxisType> {
    const tierValue = input.tier
        ? (typeof input.tier === "string"
            ? East.value(variant(input.tier as GanttTierLiteral, null), GanttTierType)
            : input.tier)
        : undefined;
    return East.value({
        range: input.range !== undefined
            ? some(East.value({ min: input.range.min, max: input.range.max }, GanttAxisRangeType))
            : none,
        format: input.format !== undefined ? some(input.format) : none,
        tier: tierValue ? some(tierValue) : none,
    }, GanttAxisType);
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
export type ColumnSpec<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    | (keyof DataFields<NoInfer<T>>)[]
    | { [K in keyof DataFields<NoInfer<T>>]?: TableColumnConfig<DataFields<NoInfer<T>>[K], DataRowType<NoInfer<T>>> };

// Every key in the data struct is a valid column key. Deriving from T (rather
// than the columns object) keeps inference reliable when the column configs
// contain render functions or complex field types.
export type DataFieldKeys<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
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
function createGantt<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    columns: ColumnSpec<T>,
    rowSpec: (row: ExprType<TypeOf<T> extends ArrayType<infer E> ? E : never>) => {
        tasks?: SubtypeExprOrValue<ArrayType<GanttTaskType>>;
        milestones?: SubtypeExprOrValue<ArrayType<GanttMilestoneType>>;
        /** Optional per-row status — the quiet dot beside the row (some ⇒
         *  flagged, none ⇒ clean). Only rendered when `review` is set (#263). */
        status?: SubtypeExprOrValue<OptionType<StatusValueType>>;
        /** Optional per-row review decision (`some(approved)` rests
         *  pre-approved, `some(pending)` awaits a call, `some(rejected)` is
         *  declined; none ⇒ no decision). Compute in East — see
         *  `deriveApproval`. Only rendered when `review` is set (#263). */
        approval?: SubtypeExprOrValue<OptionType<ApprovalStateType>>;
    },
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
        if (valueTypeTag !== "Null" && valueTypeTag !== "Boolean" && valueTypeTag !== "Integer" &&
            valueTypeTag !== "Float" && valueTypeTag !== "String" && valueTypeTag !== "DateTime" &&
            valueTypeTag !== "Blob") {
            throw new Error(`Column "${col_key}" has value type "${valueTypeTag}" which is not a valid column type. Complex types require a value function that returns a primitive type.`);
        }
        (col_config as any).valueType = variant(valueTypeTag, null) as EastTypeValue;
    }

    // Map each data row to a GanttRow with cells and events
    const rows_mapped = mapRowsBlock(data_expr, GanttRowType, ($, datum) => {
        // Build cells dict (same as Table) — cells carry ONLY the sortable
        // primitive; rendering goes through the column's render function
        // (synthesized default below when the author omits it).
        const cells = $.let(new Map(), DictType(StringType, TableCellType));

        for (const [col_key, col_config] of Object.entries(columns_obj)) {
            const field_value = (datum as any)[col_key];
            const valueFn = (col_config as any).valueFn;

            // Cell value: call the column's reified value function, or use the
            // field value directly (primitive columns).
            const cellValue = valueFn !== undefined
                ? variant(col_config.valueType.type as any, valueFn(field_value, datum))
                : variant(col_config.valueType.type as any, field_value);

            $(cells.insert(col_key, cellValue));
        }

        // Get tasks + milestones from the row. The callback returns
        // `SubtypeExprOrValue<ArrayType<...>>` for each — accepting either
        // an East-side ArrayExpr (e.g. mapping over an East array field)
        // or a plain JS array of values built by `Gantt.Task(...)` /
        // `Gantt.Milestone(...)`. Default to an empty East array when a
        // key is omitted.
        const spec = rowSpec(datum as any);

        return East.value({
            cells: cells,
            tasks: East.value(spec.tasks ?? [], ArrayType(GanttTaskType)),
            milestones: East.value(spec.milestones ?? [], ArrayType(GanttMilestoneType)),
            // Review chrome (#263) — pass-through accessors (clean ⇒ approved,
            // flagged ⇒ pending; see the shared `deriveApproval` helper).
            status: spec.status !== undefined
                ? East.value(spec.status, OptionType(StatusValueType))
                : none,
            approval: spec.approval !== undefined
                ? East.value(spec.approval, OptionType(ApprovalStateType))
                : none,
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
                ? East.value(config.render, FunctionType([TableCellRenderContextType], UIComponentType))
                // Synthesized capture-free default: stringify the cell value via
                // the column's statically-known tag (same as Table).
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

    const densityValue = style?.density
        ? (typeof style.density === "string"
            ? East.value(variant(style.density, null), DensityType)
            : style.density)
        : undefined;

    const hasStyle = !!style && (
        style.height !== undefined ||
        (style as { maxHeight?: unknown }).maxHeight !== undefined ||
        style.variant !== undefined ||
        style.size !== undefined ||
        style.density !== undefined ||
        style.striped !== undefined ||
        style.stickyHeader !== undefined ||
        style.showColumnBorder !== undefined ||
        style.showToday !== undefined ||
        style.rowHeight !== undefined ||
        (style as GanttStyle).plotGutter !== undefined
    );

    const gutterCfg = (style as GanttStyle | undefined)?.plotGutter;
    const styleValue = hasStyle ? East.value({
        height: style!.height !== undefined ? some(style!.height) : none,
        maxHeight: style!.maxHeight !== undefined ? some(style!.maxHeight) : none,
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        density: densityValue ? some(densityValue) : none,
        striped: style!.striped !== undefined ? some(style!.striped) : none,
        stickyHeader: style!.stickyHeader !== undefined ? some(style!.stickyHeader) : none,
        showColumnBorder: style!.showColumnBorder !== undefined ? some(style!.showColumnBorder) : none,
        showToday: style!.showToday !== undefined ? some(style!.showToday) : none,
        rowHeight: style!.rowHeight !== undefined ? some(style!.rowHeight) : none,
        plotGutter: gutterCfg !== undefined
            ? some(East.value({
                left:  gutterCfg.left  !== undefined ? some(gutterCfg.left)  : none,
                right: gutterCfg.right !== undefined ? some(gutterCfg.right) : none,
            }, PlotGutterType))
            : none,
    }, GanttStyleType) : undefined;

    const sliceChromeValue = style?.slice !== undefined
        ? East.value({
            slice: style.slice,
            affordances: East.value(
                (style.affordances ?? ["filter", "search", "range"]).map(a => variant(a, null)),
                ArrayType(SliceAffordanceType),
            ),
        }, SliceChromeType)
        : undefined;

    return East.value(variant("Gantt", {
        rows: rows_mapped,
        columns: columns_expr,
        frozen: frozen_expr,
        axis: style?.axis ? some(buildGanttAxis(style.axis)) : none,
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
        id: style?.id ?? "",
        sources: East.value(style?.sources ?? [], ArrayType(StringType)),
        onDrag: style?.onDrag ? some(style.onDrag) : none,
        canDrop: style?.canDrop ? some(style.canDrop) : none,
        onTaskProgressChange: style?.onTaskProgressChange ? some(style.onTaskProgressChange) : none,
        onMilestoneClick: style?.onMilestoneClick ? some(style.onMilestoneClick) : none,
        onMilestoneDoubleClick: style?.onMilestoneDoubleClick ? some(style.onMilestoneDoubleClick) : none,
        review: style?.review !== undefined ? some(buildReview(style.review, RowReviewType)) : none,
        slice: sliceChromeValue ? some(sliceChromeValue) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

// ============================================================================
// Namespace Export
// ============================================================================

interface GanttTypesShape {
    Root: GanttRootType;
    Row: GanttRowType;
    Task: GanttTaskType;
    Milestone: GanttMilestoneType;
    State: PlannerStateType;
    Status: StatusValueType;
    Approval: ApprovalStateType;
    Review: RowReviewType;
    ApproveEvent: RowRefType;
    MilestoneKind: GanttMilestoneKindType;
    Axis: GanttAxisType;
    Tier: GanttTierType;
    Style: GanttStyleType;
    Column: TableColumnType;
    Cell: typeof TableCellType;
    TaskClickEvent: GanttTaskClickEventType;
    TaskProgressChangeEvent: GanttTaskProgressChangeEventType;
    MilestoneClickEvent: GanttMilestoneClickEventType;
}

const GanttTypes: GanttTypesShape = {
    /**
     * East StructType for the entire Gantt value — the root IR.
     *
     * @remarks
     * The main struct carries content (`rows` / `columns` /
     * `frozen`), drag-step configuration, structured state
     * (`rowStatus`), and behaviour callbacks; visual-only fields live
     * inside the optional `style` sub-struct ({@link GanttStyleType}).
     *
     * @property rows - Array of Gantt rows ({@link GanttRowType})
     * @property columns - Array of column definitions (shared with Table)
     * @property frozen - Column keys to freeze (pin left)
     * @property dragStep - Optional snap step for task drag
     * @property durationStep - Optional snap step for task duration change
     * @property rowStatus - Row-status callback `(rowIndex) => StatusToken`
     * @property onCellClick - Cell click callback
     * @property onCellDoubleClick - Cell double-click callback
     * @property onRowClick - Row click callback
     * @property onRowDoubleClick - Row double-click callback
     * @property onSortChange - Sort change callback
     * @property onTaskClick - Task click callback
     * @property onTaskDoubleClick - Task double-click callback
     * @property onTaskDrag - Task drag callback (presence enables drag)
     * @property onTaskDurationChange - Task duration-change callback (presence enables resize)
     * @property onTaskProgressChange - Task progress-change callback
     * @property onMilestoneClick - Milestone click callback
     * @property onMilestoneDoubleClick - Milestone double-click callback
         * @property style - Optional visual style sub-struct
     */
    Root: GanttRootType,
    /**
     * East StructType for a single Gantt row.
     *
     * @remarks
     * Each row pairs `cells` (the dict of column-keyed table cells,
     * shared with the Table primitive) with two timeline tracks:
     * `tasks` (duration bars) and `milestones` (single-point markers).
     *
     * @property cells - Dict of column key to cell content (shared with Table)
     * @property tasks - Array of task bars ({@link GanttTaskType})
     * @property milestones - Array of milestone markers ({@link GanttMilestoneType})
     */
    Row: GanttRowType,
    /**
     * East StructType for a single Gantt task bar.
     *
     * @remarks
     * Every optional field is wrapped in `OptionType`. Use the
     * {@link createTask | `Gantt.Task`} factory to construct values
     * from a flat TS interface; the factory handles the `some` /
     * `none` / `variant(...)` envelopes for you.
     *
     * @property start - Start date/time of the task
     * @property end - End date/time of the task
     * @property label - Optional rich label (text + alignment + typography)
     * @property progress - Progress percentage (0-100)
     * @property status - Schedule status driving the bar colour (committed / proposed / atRisk)
     * @property popover - Click-triggered rich popover (UIComponent)
     */
    Task: GanttTaskType,
    /**
     * East StructType for a single Gantt milestone marker.
     *
     * @remarks
     * Every optional field is wrapped in `OptionType`. Use the
     * {@link createMilestone | `Gantt.Milestone`} factory to construct
     * values from a flat TS interface.
     *
     * @property date - The date/time of the milestone
     * @property label - Optional rich label (text + alignment + typography)
     * @property kind - Milestone kind driving the diamond fill (interim / release)
     * @property popover - Click-triggered rich popover (UIComponent)
     */
    Milestone: GanttMilestoneType,
    /**
     * East VariantType for a task's audit state — the shared event
     * lifecycle (`PlannerStateType`, #262). Drives the bar treatment:
     * committed solid, proposed(added) dashed, proposed(model) dashed
     * ghost, proposed(removed) struck ghost, rejected greyed strike.
     *
     * @property committed - Audit-locked, immutable
     * @property proposed - Drafted; the flavour (added / model / removed) is nested
     * @property rejected - Reviewed and declined; kept for diff
     */
    State: PlannerStateType,
    /**
     * East VariantType for a task's optional risk/status tint — the
     * status axis the old `atRisk` moved to (#262); tints the bar
     * colour over the state treatment.
     *
     * @property success - On-track (green tint)
     * @property warning - Caution (amber tint)
     * @property danger - Slipping / blocked (red tint — the old `atRisk`)
     * @property info - Informational (teal tint)
     * @property neutral - Muted
     */
    Status: StatusValueType,
    /**
     * A row's review decision — the shared `ApprovalStateType`
     * (approved / pending / rejected) from `contracts/review.ts` (#263).
     */
    Approval: ApprovalStateType,
    /**
     * The review configuration — the shared row-granularity
     * `RowReviewType` (decision column + commitBar foot) from
     * `contracts/review.ts` (#263).
     */
    Review: RowReviewType,
    /**
     * The per-row approve / reject callback payload — the shared
     * `RowRefType` (`{ rowIndex }`).
     */
    ApproveEvent: RowRefType,
    /**
     * East VariantType for a milestone's kind — drives the diamond fill.
     *
     * @property interim - Intermediate checkpoint (amber)
     * @property release - Shippable deliverable (brand teal)
     */
    MilestoneKind: GanttMilestoneKindType,
    /**
     * East StructType for the Gantt time-axis configuration.
     *
     * @remarks
     * The Gantt analogue of the Planner `axis`, specialised to the single
     * time scale. Construct via the `axis` option on `Gantt.Root`.
     *
     * @property range - Optional explicit `{ min, max }` window (omitted ⇒ derived from data)
     * @property format - Optional tick-label date pattern (e.g. `"MMM"`)
     * @property tier - Optional header band granularity ({@link GanttTierType})
     */
    Axis: GanttAxisType,
    /**
     * East VariantType for the axis header granularity.
     *
     * @property auto - Interval + count chosen automatically
     * @property day - One band per day
     * @property week - One band per week
     * @property month - One band per calendar month
     * @property quarter - One band per calendar quarter
     * @property year - One band per calendar year
     */
    Tier: GanttTierType,
    /**
     * East StructType holding every visual field for a Gantt.
     *
     * @remarks
     * Visual-only. Mirror of {@link GanttStyleType} —
     * exposed on the namespace so consumers can reference the IR
     * style type via `Gantt.Types.Style`.
     *
     * @property height - CSS height for the Gantt container
     * @property variant - Table variant (line / outline)
     * @property size - Table size (sm / md / lg)
     * @property density - Density preset driving row + header height (compact / condensed / comfortable)
     * @property striped - Whether to show zebra stripes on rows
     * @property stickyHeader - Whether the header sticks when scrolling
     * @property showColumnBorder - Whether to show borders between columns
     * @property showToday - Whether to show the now-line
     */
    Style: GanttStyleType,
    /**
     * East StructType for a table column definition — re-export of
     * the shared {@link TableColumnType} so consumers can reference
     * column shape via `Gantt.Types.Column`.
     *
     * @property key - The column key (field name)
     * @property dataType - Original data field type
     * @property valueType - Sortable / display value type after value-fn
     * @property header - Optional header text
     * @property width - Optional CSS width
     * @property minWidth - Optional CSS min-width
     * @property maxWidth - Optional CSS max-width
     * @property render - Optional render function for cell content
     */
    Column: TableColumnType,
    /**
     * East StructType for a table cell — re-export of the shared
     * {@link TableCellType} so consumers can reference the cell
     * shape via `Gantt.Types.Cell`.
     *
     * @property value - The literal cell value (used for sorting)
     * @property content - Optional pre-rendered UIComponent body
     */
    Cell: TableCellType,
    /**
     * East StructType for the event payload of `onTaskClick` /
     * `onTaskDoubleClick` callbacks.
     *
     * @property rowIndex - Row index (0-based)
     * @property taskIndex - Task index within the row (0-based)
     * @property taskStart - Start date/time of the task
     * @property taskEnd - End date/time of the task
     */
    TaskClickEvent: GanttTaskClickEventType,
    /**
     * East StructType for the event payload of `onTaskProgressChange`.
     *
     * @property rowIndex - Row index (0-based)
     * @property taskIndex - Task index within the row (0-based)
     * @property previousProgress - Previous progress value (0-100)
     * @property newProgress - New progress value (0-100)
     */
    TaskProgressChangeEvent: GanttTaskProgressChangeEventType,
    /**
     * East StructType for the event payload of `onMilestoneClick` /
     * `onMilestoneDoubleClick` callbacks.
     *
     * @property rowIndex - Row index (0-based)
     * @property milestoneIndex - Milestone index within the row (0-based)
     * @property milestoneDate - Date/time of the milestone
     */
    MilestoneClickEvent: GanttMilestoneClickEventType,
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
     *         row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
     *         { showToday: true }
     *     );
     * });
     * ```
     */
    Root: createGantt,
    /**
     * Builds a single Gantt task East value from an ergonomic TS input.
     *
     * @param input - Task configuration ({@link TaskInput})
     * @returns An East expression of {@link GanttTaskType}
     *
     * @remarks
     * Use inside the `rowSpec` callback of `Gantt.Root`. The callback's
     * `tasks` field is `SubtypeExprOrValue<ArrayType<GanttTaskType>>`,
     * so callers pass either an East-side ArrayExpr or a JS array of
     * values built by this factory. The factory normalises optional
     * fields (`label` / `progress` / `status` / `popover`) into their
     * `OptionType` envelopes and converts variant string literals
     * (`"committed"`, `"start"`) to East variant values — flat TS input
     * in, fully-shaped East value out.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Gantt, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ => {
     *     return Gantt.Root(
     *         [{ name: "Design", start: new Date("2024-01-01"), end: new Date("2024-01-15") }],
     *         ["name"],
     *         row => ({ tasks: [Gantt.Task({
     *             start: row.start,
     *             end: row.end,
     *             label: "Design Phase",
     *             progress: 75,
     *             status: "committed",
     *         })] }),
     *     );
     * });
     * ```
     */
    Task: createTask,
    /**
     * Builds a single Gantt milestone East value from an ergonomic TS input.
     *
     * @param input - Milestone configuration ({@link MilestoneInput})
     * @returns An East expression of {@link GanttMilestoneType}
     *
     * @remarks
     * Use inside the `rowSpec` callback of `Gantt.Root`. The callback's
     * `milestones` field is `SubtypeExprOrValue<ArrayType<GanttMilestoneType>>`,
     * so callers pass either an East-side ArrayExpr or a JS array of
     * values built by this factory. Same option/variant normalisation
     * as `Gantt.Task`.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Gantt, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ => {
     *     return Gantt.Root(
     *         [{ name: "Launch", date: new Date("2024-02-01") }],
     *         ["name"],
     *         row => ({ milestones: [Gantt.Milestone({
     *             date: row.date,
     *             label: "Design Complete",
     *             kind: "release",
     *         })] }),
     *     );
     * });
     * ```
     */
    Milestone: createMilestone,
    Types: GanttTypes,
};

export const Gantt: typeof GanttImpl = GanttImpl;
