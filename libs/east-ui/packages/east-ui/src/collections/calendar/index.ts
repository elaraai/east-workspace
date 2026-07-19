/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Calendar` — a day-of-week × week heatmap coloured by intensity (forecast,
 * demand, OT exposure). **Visualisation only**: clicking selects/drills into
 * a day, but the Calendar is not part of the Planner family — no events, no
 * committed/proposed state, no drag & drop. Takes one flat table with a
 * chart-style field encoding; the component owns the week (columns are always
 * Mon–Sun). Optional chrome — the weekly totals rail, the per-weekday
 * aggregate row, and the selection footer — is composed with the
 * `Calendar.*` sub-factories.
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    type TypeOf,
    East,
    Expr,
    variant,
    some,
    none,
    ArrayType,
    BooleanType,
    FloatType,
    type FunctionType,
    IntegerType,
    type NullType,
    StringType,
    StructType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { mapRows } from "../../shared/reify.js";
import { DensityType } from "../../style.js";
import type { DensityLiteral } from "../../style.js";
import { PlotGutterType } from "../../shared/plot-gutter.js";
import type { PlotGutter } from "../../shared/plot-gutter.js";
import {
    CalendarRootType,
    CalendarCellType,
    CalendarCellRefType,
    CalendarAggregateType,
    type CalendarAggregateLiteral,
    CalendarScaleType,
    CalendarTotalsType,
    CalendarAggregateRowType,
    CalendarLegendType,
    CalendarFooterType,
} from "./types.js";

// Re-export types
export {
    CalendarRootType,
    CalendarCellType,
    CalendarCellRefType,
    CalendarAggregateType,
    type CalendarAggregateLiteral,
    CalendarScaleType,
    CalendarTotalsType,
    CalendarAggregateRowType,
    CalendarLegendType,
    CalendarFooterType,
} from "./types.js";

/**
 * The struct element type of a `SubtypeExprOrValue<ArrayType<StructType>>`.
 */
export type RowElement<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    TypeOf<T> extends ArrayType<infer S> ? (S extends StructType ? S : never) : never;

// ============================================================================
// Sub-factory helpers
// ============================================================================

/** Normalise an aggregate literal / expression into a `CalendarAggregateType`. */
function aggregateValue(
    agg: SubtypeExprOrValue<CalendarAggregateType> | CalendarAggregateLiteral,
): SubtypeExprOrValue<CalendarAggregateType> {
    return typeof agg === "string"
        ? East.value(variant(agg, null), CalendarAggregateType)
        : agg;
}

/**
 * Options for {@link Calendar.scale}.
 *
 * @property ramp - Optional low→high CSS colour list (absent = the default teal ramp)
 * @property steps - Number of intensity buckets (default the ramp length, else 8)
 */
export interface CalendarScaleOptions {
    /** Optional low→high CSS colour list (absent = the default teal ramp). */
    ramp?: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Number of intensity buckets (default the ramp length, else 8). */
    steps?: SubtypeExprOrValue<IntegerType>;
}

/**
 * Builds a heatmap scale — the low→high colour ramp and bucket count that map
 * a cell value to its fill. Pass the result as `config.scale`.
 *
 * @param options - The scale options ({@link CalendarScaleOptions})
 * @returns An East `CalendarScaleType` value
 *
 * @example
 * ```ts
 * Calendar.scale({ steps: 6 })
 * ```
 */
function calendarScale(options: CalendarScaleOptions = {}): SubtypeExprOrValue<CalendarScaleType> {
    return East.value({
        ramp: options.ramp !== undefined
            ? some(East.value(options.ramp, ArrayType(StringType)))
            : none,
        steps: options.steps ?? 8n,
    }, CalendarScaleType);
}

/**
 * Options for {@link Calendar.totals}.
 *
 * @property aggregate - The reduction over each week's cells (default `"sum"`)
 * @property label - The rail's column header (default `"Σ wk"`)
 * @property bar - Whether to draw the proportion bar (default `true`)
 */
export interface CalendarTotalsOptions {
    /** The reduction over each week's cells (default `"sum"`). */
    aggregate?: SubtypeExprOrValue<CalendarAggregateType> | CalendarAggregateLiteral;
    /** The rail's column header (default `"Σ wk"`). */
    label?: SubtypeExprOrValue<StringType>;
    /** Whether to draw the proportion bar (default `true`). */
    bar?: SubtypeExprOrValue<BooleanType>;
}

/**
 * Builds the weekly totals rail — a trailing column reducing each week row,
 * with an optional proportion bar. Pass the result as `config.totals`.
 * The aggregate vocabulary (`sum` / `mean` / `min` / `max` / `count`) matches
 * the Table component.
 *
 * @param options - The totals options ({@link CalendarTotalsOptions})
 * @returns An East `CalendarTotalsType` value
 *
 * @example
 * ```ts
 * Calendar.totals({ aggregate: "sum", label: "Σ wk" })
 * ```
 */
function calendarTotals(options: CalendarTotalsOptions = {}): SubtypeExprOrValue<CalendarTotalsType> {
    return East.value({
        aggregate: aggregateValue(options.aggregate ?? "sum"),
        label: options.label ?? "Σ wk",
        bar: options.bar ?? true,
    }, CalendarTotalsType);
}

/**
 * Options for {@link Calendar.aggregateRow}.
 *
 * @property aggregate - The reduction over each weekday's cells (default `"mean"`)
 * @property label - The row's label (default `"mean"`)
 */
export interface CalendarAggregateRowOptions {
    /** The reduction over each weekday's cells (default `"mean"`). */
    aggregate?: SubtypeExprOrValue<CalendarAggregateType> | CalendarAggregateLiteral;
    /** The row's label (default `"mean"`). */
    label?: SubtypeExprOrValue<StringType>;
}

/**
 * Builds the per-weekday aggregate row — a trailing row reducing each weekday
 * column, pinned under the grid. Pass the result as `config.aggregateRow`.
 *
 * @param options - The aggregate-row options ({@link CalendarAggregateRowOptions})
 * @returns An East `CalendarAggregateRowType` value
 *
 * @example
 * ```ts
 * Calendar.aggregateRow({ aggregate: "mean", label: "mean" })
 * ```
 */
function calendarAggregateRow(options: CalendarAggregateRowOptions = {}): SubtypeExprOrValue<CalendarAggregateRowType> {
    return East.value({
        aggregate: aggregateValue(options.aggregate ?? "mean"),
        label: options.label ?? "mean",
    }, CalendarAggregateRowType);
}

/**
 * Options for {@link Calendar.footer}.
 *
 * @property valueLabel - Label for the cell value (default `"value"`)
 * @property compareLabel - Label for the compare baseline (default `"prev"`)
 * @property legend - Low→high gradient legend; `true` for the default captions
 */
export interface CalendarFooterOptions {
    /** Label for the cell value (default `"value"`). */
    valueLabel?: SubtypeExprOrValue<StringType>;
    /** Label for the compare baseline (default `"prev"`). */
    compareLabel?: SubtypeExprOrValue<StringType>;
    /** Low→high gradient legend; `true` for the default `low` / `high` captions. */
    legend?: { low?: SubtypeExprOrValue<StringType>; high?: SubtypeExprOrValue<StringType> } | boolean;
}

/**
 * Builds the selection footer — the strip shown once a cell is selected,
 * printing the cell value (labelled `valueLabel`), its `compare` baseline
 * (labelled `compareLabel`) and a computed delta chip, plus an optional
 * low→high gradient legend pinned right. Pass the result as `config.footer`.
 *
 * @param options - The footer options ({@link CalendarFooterOptions})
 * @returns An East `CalendarFooterType` value
 *
 * @example
 * ```ts
 * Calendar.footer({ valueLabel: "predicted", compareLabel: "last yr", legend: true })
 * ```
 */
function calendarFooter(options: CalendarFooterOptions = {}): SubtypeExprOrValue<CalendarFooterType> {
    const legend = options.legend;
    const legendValue = legend === undefined || legend === false
        ? none
        : some(East.value({
            low: (legend === true ? undefined : legend.low) ?? "low",
            high: (legend === true ? undefined : legend.high) ?? "high",
        }, CalendarLegendType));
    return East.value({
        valueLabel: options.valueLabel ?? "value",
        compareLabel: options.compareLabel ?? "prev",
        legend: legendValue,
    }, CalendarFooterType);
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Fields the `cell` mapper returns — one (week, day) cell, before defaults.
 *
 * @remarks
 * The mapper returns this plain object or a full
 * `ExprType<CalendarCellType>` when the row is already resolved.
 *
 * @property week - The row's week label (rows appear in first-appearance order)
 * @property day - The day column — `"Mon"` … `"Sun"`, exact match
 * @property value - The intensity (drives fill; printed via `text`)
 * @property text - Optional cell text (defaults to `East.print(value)`)
 * @property compare - Optional baseline for the footer delta (e.g. last year)
 * @property summary - Optional extra selection-footer text for this day
 */
export interface CalendarCellFields {
    /** The row's week label (rows appear in first-appearance order). */
    week: SubtypeExprOrValue<StringType>;
    /** The day column — `"Mon"` … `"Sun"`, exact match. */
    day: SubtypeExprOrValue<StringType>;
    /** The intensity (drives fill; printed via `text`). */
    value: SubtypeExprOrValue<FloatType>;
    /** Optional cell text (defaults to `East.print(value)`). */
    text?: SubtypeExprOrValue<StringType>;
    /** Optional baseline for the footer delta (e.g. last year). */
    compare?: SubtypeExprOrValue<FloatType>;
    /** Optional extra selection-footer text for this day. */
    summary?: SubtypeExprOrValue<StringType>;
}

/**
 * Configuration for {@link createCalendar}.
 *
 * @typeParam R - The day-row struct
 * @property cell - Cell row mapper (omit when rows are already resolved)
 * @property values - Print the value inside each cell (default `true`)
 * @property scale - Heatmap scale ({@link Calendar.scale})
 * @property domain - Optional explicit intensity domain (default: observed min/max)
 * @property totals - Weekly totals rail ({@link Calendar.totals})
 * @property aggregateRow - Per-weekday aggregate row ({@link Calendar.aggregateRow})
 * @property footer - Selection footer ({@link Calendar.footer})
 * @property actionLabel - Optional footer drill label
 * @property onAction - Optional drill callback (receives the selected cell)
 * @property onSelect - Optional cell-click callback
 */
export interface CalendarConfig<R extends StructType> {
    /** Cell row mapper; omit when `data` is already `ArrayType(Calendar.Types.Cell)`. */
    cell?: (day: ExprType<R>) => CalendarCellFields;
    /** Print the value inside each cell (default `true`). */
    values?: SubtypeExprOrValue<BooleanType>;
    /** Heatmap scale ({@link Calendar.scale}). */
    scale?: SubtypeExprOrValue<CalendarScaleType>;
    /** Optional explicit intensity domain (default: observed min/max). */
    domain?: { min: SubtypeExprOrValue<FloatType>; max: SubtypeExprOrValue<FloatType> };
    /** Weekly totals rail ({@link Calendar.totals}). */
    totals?: SubtypeExprOrValue<CalendarTotalsType>;
    /** Per-weekday aggregate row ({@link Calendar.aggregateRow}). */
    aggregateRow?: SubtypeExprOrValue<CalendarAggregateRowType>;
    /** Selection footer ({@link Calendar.footer}). */
    footer?: SubtypeExprOrValue<CalendarFooterType>;
    /** Optional footer drill label. */
    actionLabel?: SubtypeExprOrValue<StringType>;
    /** Optional drill callback (receives the selected cell). */
    onAction?: SubtypeExprOrValue<FunctionType<[CalendarCellRefType], NullType>>;
    /** Optional cell-click callback. */
    onSelect?: SubtypeExprOrValue<FunctionType<[CalendarCellRefType], NullType>>;
    /** Optional density preset (comfortable | compact | condensed). Default comfortable. */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Uniform sizing (#320): bound the component — a pixel number, `"fill"` (fill the parent box), or a CSS length; the whole component takes this height and scrolls within. */
    height?: SubtypeExprOrValue<StringType>;
    /** Uniform sizing (#320): max-height cap — a pixel number or CSS length; content-sized up to it. */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** Shared plot gutter (#147) — pins the day grid to `[left, W−right]` (px) so a Calendar stacked under a Chart lines up; `left` is the week-label column width. Usually supplied by an enclosing `<AlignedStack>`. */
    plotGutter?: PlotGutter;
}

function buildRoot(
    data: SubtypeExprOrValue<ArrayType<StructType>>,
    config: CalendarConfig<StructType>,
): ExprType<UIComponentType> {
    const cellMapper = config.cell;
    const cells = cellMapper === undefined
        ? East.value(data as SubtypeExprOrValue<ArrayType<CalendarCellType>>, ArrayType(CalendarCellType))
        : mapRows(East.value(data) as ExprType<ArrayType<StructType>>, CalendarCellType, (row) => {
            const r: CalendarCellFields | ExprType<CalendarCellType> = cellMapper(row);
            if (r instanceof Expr) return East.value(r, CalendarCellType);
            const value = East.value(r.value, FloatType);
            return East.value({
                week: r.week,
                day: r.day,
                value,
                text: r.text !== undefined ? r.text : East.print(value),
                compare: r.compare !== undefined ? some(East.value(r.compare, FloatType)) : none,
                summary: r.summary !== undefined ? some(r.summary) : none,
            }, CalendarCellType);
        });

    const densityValue = config.density !== undefined
        ? (typeof config.density === "string"
            ? East.value(variant(config.density, null), DensityType)
            : config.density)
        : undefined;

    return East.value(variant("Calendar", {
        cells,
        values: config.values ?? true,
        scale: config.scale !== undefined ? some(East.value(config.scale, CalendarScaleType)) : none,
        domain: config.domain !== undefined
            ? some(East.value({ min: config.domain.min, max: config.domain.max },
                StructType({ min: FloatType, max: FloatType })))
            : none,
        totals: config.totals !== undefined ? some(East.value(config.totals, CalendarTotalsType)) : none,
        aggregateRow: config.aggregateRow !== undefined ? some(East.value(config.aggregateRow, CalendarAggregateRowType)) : none,
        footer: config.footer !== undefined ? some(East.value(config.footer, CalendarFooterType)) : none,
        actionLabel: config.actionLabel !== undefined ? some(config.actionLabel) : none,
        onAction: config.onAction !== undefined ? some(config.onAction) : none,
        onSelect: config.onSelect !== undefined ? some(config.onSelect) : none,
        density: densityValue !== undefined ? some(densityValue) : none,
        height: config.height !== undefined ? some(config.height) : none,
        maxHeight: config.maxHeight !== undefined ? some(config.maxHeight) : none,
        plotGutter: config.plotGutter !== undefined
            ? some(East.value({
                left:  config.plotGutter.left  !== undefined ? some(config.plotGutter.left)  : none,
                right: config.plotGutter.right !== undefined ? some(config.plotGutter.right) : none,
            }, PlotGutterType))
            : none,
    }), UIComponentType);
}

/**
 * Creates a Calendar — a day-of-week × week intensity heatmap.
 *
 * @typeParam R - The day-table input
 * @param data - The day rows (one element per week × day cell; sparse is fine)
 * @param config - The Calendar configuration ({@link CalendarConfig})
 * @returns An East expression of `UIComponentType`
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Calendar, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ =>
 *     Calendar.Root(
 *         [{ week: "W37", day: "Mon", demand: 102.0 }],
 *         {
 *             cell: d => ({ week: d.week, day: d.day, value: d.demand }),
 *             totals: Calendar.totals(),
 *             footer: Calendar.footer({ legend: true }),
 *         },
 *     ),
 * );
 * ```
 */
function createCalendar<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    config: CalendarConfig<RowElement<T>>,
): ExprType<UIComponentType> {
    return buildRoot(data, config as unknown as CalendarConfig<StructType>);
}

// ============================================================================
// Namespace export
// ============================================================================

/**
 * Calendar component namespace.
 *
 * @remarks
 * `Calendar.Root(data, config)` builds the heatmap from one flat day table.
 * Compose the optional chrome with the sub-factories: `Calendar.scale` (the
 * colour ramp), `Calendar.totals` (the weekly rail), `Calendar.aggregateRow`
 * (the per-weekday row), and `Calendar.footer` (the selection footer + legend).
 * Visualisation only — pair it with a `Slice.Range` in the surrounding chrome
 * if the time window needs to narrow.
 */
export const Calendar = {
    /**
     * Creates a Calendar — a day-of-week × week intensity heatmap.
     *
     * @typeParam R - The day-table input
     * @param data - The day rows (one element per week × day cell; sparse is fine)
     * @param config - The Calendar configuration ({@link CalendarConfig})
     * @returns An East expression of `UIComponentType`
     *
     * @remarks
     * Cells fill with the heatmap ramp normalised over the visible values (or
     * the explicit `domain`); missing (week, day) combinations render the
     * neutral hatched fill. Selecting a cell shows its details in the footer.
     */
    Root: createCalendar,
    /**
     * Builds a heatmap scale — the low→high colour ramp and bucket count.
     * Pass the result as `config.scale`.
     *
     * @param options - The scale options ({@link CalendarScaleOptions})
     * @returns An East `CalendarScaleType` value
     */
    scale: calendarScale,
    /**
     * Builds the weekly totals rail (per-row aggregation) — a trailing column
     * with an optional proportion bar. Pass the result as `config.totals`.
     *
     * @param options - The totals options ({@link CalendarTotalsOptions})
     * @returns An East `CalendarTotalsType` value
     */
    totals: calendarTotals,
    /**
     * Builds the per-weekday aggregate row (per-column aggregation). Pass the
     * result as `config.aggregateRow`.
     *
     * @param options - The aggregate-row options ({@link CalendarAggregateRowOptions})
     * @returns An East `CalendarAggregateRowType` value
     */
    aggregateRow: calendarAggregateRow,
    /**
     * Builds the selection footer (value / compare / delta + legend). Pass the
     * result as `config.footer`.
     *
     * @param options - The footer options ({@link CalendarFooterOptions})
     * @returns An East `CalendarFooterType` value
     */
    footer: calendarFooter,
    Types: {
        /**
         * East StructType for the Calendar component.
         *
         * @remarks
         * The resolved grid; see {@link CalendarRootType} for per-field docs.
         */
        Calendar: CalendarRootType,
        /**
         * A resolved calendar cell.
         */
        Cell: CalendarCellType,
        /**
         * A cell reference — what `onSelect` / `onAction` receive.
         */
        CellRef: CalendarCellRefType,
        /** The aggregate reduction vocabulary (sum / mean / min / max / count). */
        Aggregate: CalendarAggregateType,
        /** The heatmap scale (ramp / steps). */
        Scale: CalendarScaleType,
        /** The weekly totals rail. */
        Totals: CalendarTotalsType,
        /** The per-weekday aggregate row. */
        AggregateRow: CalendarAggregateRowType,
        /** The selection footer. */
        Footer: CalendarFooterType,
        /** The heatmap legend. */
        Legend: CalendarLegendType,
    },
} as const;
