/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    variant,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SliceBindType } from "../../platform/slice/index.js";
import {
    ChartSpecType,
    ChartSeriesType,
    chartFrame,
    chartSeries,
    chartAxisBottom,
    chartAxisLeft,
    chartGridRows,
    chartGridColumns,
} from "../../charts/spec/index.js";
import { Stack } from "../../layout/stack/index.js";
import { SliceLegend } from "../legend/index.js";
import { SliceChartType, SliceChartRangeKindType } from "./types.js";

export { SliceChartType, SliceChartRangeKindType } from "./types.js";

/** Options for `Slice.Chart.{Line,Bar,Area}`. */
export interface SliceChartOptions {
    /** Field id positioning each point on the x-axis (e.g. `"month"`). */
    x: string;
    /** Numeric field id summed into each point's value (e.g. `"sessions"`). */
    value: string;
    /** Bundle a `Slice.Legend` beneath the chart (shared colours). Default `true`. */
    legend?: boolean;
    /** Plot height in px. Default `280`. */
    height?: number;
    /** Plot width in px; omit for responsive (fills the container). */
    width?: number;
    /**
     * X-axis scale kind. `band` (default) treats each `x` as a discrete category;
     * `time` parses the `x` field as a datetime and lays it out continuously;
     * `linear` parses it as a number. Use `time` when `x` is a `DateTime` field.
     */
    xScale?: "band" | "time" | "linear";
    /**
     * Enable drag-to-select on the plot, writing the slice's range (`setRange`)
     * so the whole slice re-narrows. Only applies to a `time` / `linear` `xScale`
     * whose `x` is the slice's `rangeFieldId`; a no-op on a `band` chart.
     */
    brush?: boolean;
}

/**
 * Build a slice-bound visx chart: `slice.series(x, value)` produces one coloured
 * series per active-breakdown value (colours assigned by the slice, matching the
 * legend), which the `ChartSpec` `series` arm draws as `mark`. The frame derives
 * its scales from the data; the renderer styles axes mono-uppercase + paper grid.
 */
function createSliceChart(
    mark: "line" | "bar" | "area" | "scatter",
    slice: SubtypeExprOrValue<SliceBindType>,
    options: SliceChartOptions,
): ExprType<UIComponentType> {
    const s = slice as ExprType<SliceBindType>;
    const series = s.series(options.x, options.value);
    const xScale = options.xScale ?? "band";
    const spec = chartFrame(
        // Gridlines dashed `2 4` (spec `index.html` multiline), under the marks.
        [
            chartGridRows({ dashArray: "2 4" }),
            chartGridColumns({ dashArray: "2 4" }),
            chartSeries(series, mark),
            chartAxisBottom(),
            chartAxisLeft(),
        ],
        {
            height: options.height ?? 240,
            xScale,
            ...(options.width !== undefined ? { width: options.width } : {}),
        },
    );
    // A brush only makes sense on a continuous x (it writes a datetime / float
    // `SliceRange`); a band chart has no continuous range, so it stays a plain
    // `VisxChart` even with `brush: true`.
    const brushable = options.brush === true && (xScale === "time" || xScale === "linear");
    const chart = brushable
        ? East.value(variant("SliceChart", { slice, spec, rangeKind: variant(xScale === "time" ? "datetime" : "float", null) }), UIComponentType)
        : East.value(variant("VisxChart", spec), UIComponentType);
    if (options.legend === false) return chart;
    return Stack.VStack([chart, SliceLegend.Root(slice)], { gap: "3", align: "stretch" });
}

/**
 * `Slice.Chart` — slice-bound charts. Each factory splits the narrowed data by
 * the active breakdown into coloured series (via `slice.series`) and renders the
 * chosen mark, bundling a colour-matched `Slice.Legend` by default. The only
 * authoring inputs are the chart kind + the `x` / `value` field ids.
 *
 * @example
 * ```ts
 * Slice.Frame.Root(slice, Slice.Chart.Line(slice, { x: "month", value: "sessions" }), {
 *     affordances: ["breakdown"],
 * });
 * ```
 */
export const SliceChart = {
    /** Multi-line chart, one line per breakdown series. */
    Line: (slice: SubtypeExprOrValue<SliceBindType>, options: SliceChartOptions): ExprType<UIComponentType> => createSliceChart("line", slice, options),
    /** Grouped bar chart, one bar per breakdown series at each x. */
    Bar: (slice: SubtypeExprOrValue<SliceBindType>, options: SliceChartOptions): ExprType<UIComponentType> => createSliceChart("bar", slice, options),
    /** Filled-area chart, one area per breakdown series. */
    Area: (slice: SubtypeExprOrValue<SliceBindType>, options: SliceChartOptions): ExprType<UIComponentType> => createSliceChart("area", slice, options),
    /** Scatter plot, one set of point markers per breakdown series. */
    Scatter: (slice: SubtypeExprOrValue<SliceBindType>, options: SliceChartOptions): ExprType<UIComponentType> => createSliceChart("scatter", slice, options),
    Types: {
        /** The recursive visx `ChartSpec` IR these factories assemble. */
        Spec: ChartSpecType,
        /** One coloured series consumed by the chart. */
        Series: ChartSeriesType,
        /** The brush-bearing slice chart (emitted when `brush` is set on a time/linear chart). */
        Chart: SliceChartType,
        /** Which `SliceRange` arm the brush writes. */
        RangeKind: SliceChartRangeKindType,
    },
} as const;
