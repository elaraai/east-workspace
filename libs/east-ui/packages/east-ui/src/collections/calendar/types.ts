/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType,
    BooleanType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { DensityType } from "../../style.js";
import { PlotGutterType } from "../../shared/plot-gutter.js";

/**
 * A reduction applied across a calendar row (the weekly totals rail) or
 * column (the aggregate row). Mirrors the Table component's aggregate
 * vocabulary so the two collections stay consistent.
 *
 * @property sum - Numeric sum of the member cell values
 * @property mean - Numeric mean of the member cell values
 * @property min - Minimum member value
 * @property max - Maximum member value
 * @property count - Number of member cells present
 */
export const CalendarAggregateType = VariantType({
    /** Numeric sum of the member cell values */
    sum: NullType,
    /** Numeric mean of the member cell values */
    mean: NullType,
    /** Minimum member value */
    min: NullType,
    /** Maximum member value */
    max: NullType,
    /** Number of member cells present */
    count: NullType,
});

/** Type representing a calendar aggregate reduction. */
export type CalendarAggregateType = typeof CalendarAggregateType;

/** String-literal shorthand for {@link CalendarAggregateType}. */
export type CalendarAggregateLiteral = "sum" | "mean" | "min" | "max" | "count";

/**
 * The heatmap colour scale — how a cell value maps to a fill.
 *
 * @remarks
 * `ramp` is a low→high list of CSS colours; when absent the renderer uses
 * the built-in eight-step teal ramp (theme-aware — it flips to a bright-on-
 * dark ramp in dark mode). `steps` buckets the domain (default the ramp
 * length). The intensity domain lives on the root as `domain`.
 *
 * @property ramp - Optional low→high colour list (absent = the default ramp)
 * @property steps - Number of intensity buckets
 */
export const CalendarScaleType = StructType({
    /** Optional low→high colour list (absent = the default ramp) */
    ramp: OptionType(ArrayType(StringType)),
    /** Number of intensity buckets */
    steps: IntegerType,
});

/** Type representing a calendar heatmap scale. */
export type CalendarScaleType = typeof CalendarScaleType;

/**
 * The weekly totals rail — a trailing column that reduces each week row and
 * (optionally) shows a proportion bar against the largest total.
 *
 * @property aggregate - The reduction applied across each week's cells
 * @property label - The rail's column header (e.g. `"Σ wk"`)
 * @property bar - Whether to draw the proportion bar under each total
 */
export const CalendarTotalsType = StructType({
    /** The reduction applied across each week's cells */
    aggregate: CalendarAggregateType,
    /** The rail's column header (e.g. `"Σ wk"`) */
    label: StringType,
    /** Whether to draw the proportion bar under each total */
    bar: BooleanType,
});

/** Type representing the weekly totals rail. */
export type CalendarTotalsType = typeof CalendarTotalsType;

/**
 * The aggregate row — a trailing row that reduces each weekday column
 * (e.g. the per-weekday mean), pinned under the grid with a top rule.
 *
 * @property aggregate - The reduction applied across each weekday's cells
 * @property label - The row's label (e.g. `"mean"`)
 */
export const CalendarAggregateRowType = StructType({
    /** The reduction applied across each weekday's cells */
    aggregate: CalendarAggregateType,
    /** The row's label (e.g. `"mean"`) */
    label: StringType,
});

/** Type representing the per-weekday aggregate row. */
export type CalendarAggregateRowType = typeof CalendarAggregateRowType;

/**
 * The footer's low→high gradient legend that decodes the heatmap ramp.
 *
 * @property low - The low-end caption (e.g. `"low"`)
 * @property high - The high-end caption (e.g. `"high"`)
 */
export const CalendarLegendType = StructType({
    /** The low-end caption (e.g. `"low"`) */
    low: StringType,
    /** The high-end caption (e.g. `"high"`) */
    high: StringType,
});

/** Type representing the heatmap legend. */
export type CalendarLegendType = typeof CalendarLegendType;

/**
 * The selection footer — shown once a cell is selected. Reads the selected
 * cell's `value` (labelled `valueLabel`) and, when present, its `compare`
 * baseline (labelled `compareLabel`) plus the computed delta chip.
 *
 * @property valueLabel - Label for the cell value (e.g. `"predicted"`)
 * @property compareLabel - Label for the compare baseline (e.g. `"last yr"`)
 * @property legend - Optional low→high gradient legend, pinned footer-right
 */
export const CalendarFooterType = StructType({
    /** Label for the cell value (e.g. `"predicted"`) */
    valueLabel: StringType,
    /** Label for the compare baseline (e.g. `"last yr"`) */
    compareLabel: StringType,
    /** Optional low→high gradient legend, pinned footer-right */
    legend: OptionType(CalendarLegendType),
});

/** Type representing the selection footer. */
export type CalendarFooterType = typeof CalendarFooterType;

/**
 * A cell reference on the calendar grid — what `onSelect` receives.
 *
 * @property week - The row's week label
 * @property day - The day column ("Mon" … "Sun")
 */
export const CalendarCellRefType = StructType({
    /** The row's week label */
    week: StringType,
    /** The day column ("Mon" … "Sun") */
    day: StringType,
});

/**
 * Type representing calendar cell references.
 */
export type CalendarCellRefType = typeof CalendarCellRefType;

/**
 * A resolved calendar cell.
 *
 * @remarks
 * One element per (week, day) the data covered; days with no cell render
 * the neutral hatched fill. `compare` is the footer's baseline (last year /
 * forecast) — when present the footer prints it and a computed delta chip;
 * `summary` is optional extra footer text.
 *
 * @property week - The row's week label (rows appear in first-appearance order)
 * @property day - The day column ("Mon" … "Sun", exact match)
 * @property value - The intensity / printed value
 * @property text - The cell text (formatted value)
 * @property compare - Optional baseline for the footer delta (e.g. last year)
 * @property summary - Optional extra selection-footer text for this day
 */
export const CalendarCellType = StructType({
    /** The row's week label (rows appear in first-appearance order) */
    week: StringType,
    /** The day column ("Mon" … "Sun", exact match) */
    day: StringType,
    /** The intensity / printed value */
    value: FloatType,
    /** The cell text (formatted value) */
    text: StringType,
    /** Optional baseline for the footer delta (e.g. last year) */
    compare: OptionType(FloatType),
    /** Optional extra selection-footer text for this day */
    summary: OptionType(StringType),
});

/**
 * Type representing resolved calendar cells.
 */
export type CalendarCellType = typeof CalendarCellType;

/**
 * East StructType for the Calendar component.
 *
 * @remarks
 * Day-of-week × week heatmap coloured by intensity — visualisation only:
 * clicking selects/drills a day (`onSelect` / the footer `action`), but
 * there are no events, no committed/proposed state, and no drag & drop.
 * Optional chrome: the weekly `totals` rail, the per-weekday `aggregateRow`,
 * and the selection `footer` (with its gradient legend).
 *
 * @property cells - The resolved cells
 * @property values - Whether the numeric value is printed inside each cell
 * @property scale - Optional heatmap scale override (ramp / steps)
 * @property domain - Optional explicit intensity domain (default: observed min/max)
 * @property totals - Optional weekly totals rail (per-row aggregation)
 * @property aggregateRow - Optional per-weekday aggregate row (per-column aggregation)
 * @property footer - Optional selection footer (value / compare / delta + legend)
 * @property actionLabel - Optional footer drill label
 * @property onAction - Optional footer drill callback (receives the selected cell)
 * @property onSelect - Optional cell-click callback
 * @property density - Optional density preset (comfortable | compact | condensed)
 */
export const CalendarRootType = StructType({
    /** The resolved cells */
    cells: ArrayType(CalendarCellType),
    /** Whether the numeric value is printed inside each cell */
    values: BooleanType,
    /** Optional heatmap scale override (ramp / steps) */
    scale: OptionType(CalendarScaleType),
    /** Optional explicit intensity domain (default: observed min/max) */
    domain: OptionType(StructType({
        /** Domain minimum */
        min: FloatType,
        /** Domain maximum */
        max: FloatType,
    })),
    /** Optional weekly totals rail (per-row aggregation) */
    totals: OptionType(CalendarTotalsType),
    /** Optional per-weekday aggregate row (per-column aggregation) */
    aggregateRow: OptionType(CalendarAggregateRowType),
    /** Optional selection footer (value / compare / delta + legend) */
    footer: OptionType(CalendarFooterType),
    /** Optional footer drill label */
    actionLabel: OptionType(StringType),
    /** Optional footer drill callback (receives the selected cell) */
    onAction: OptionType(FunctionType([CalendarCellRefType], NullType)),
    /** Optional cell-click callback */
    onSelect: OptionType(FunctionType([CalendarCellRefType], NullType)),
    /** Optional density preset (comfortable | compact | condensed); default comfortable */
    density: OptionType(DensityType),
    /** Shared plot gutter (#147) — pins the day grid to `[left, W−right]` so a Calendar stacked under a Chart lines up; `left` is the week-label column width */
    plotGutter: OptionType(PlotGutterType),
    /** Uniform sizing (#320): bound the calendar; it scrolls within. `"fill"` fills the parent box. */
    height: OptionType(StringType),
    /** Uniform sizing (#320): max-height cap; content-sized up to it. */
    maxHeight: OptionType(StringType),
});

/**
 * Type representing the Calendar component.
 */
export type CalendarRootType = typeof CalendarRootType;
