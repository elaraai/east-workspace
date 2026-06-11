/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Chart>` tag and its layer / reference / format builders.
 */

import { Chart as ChartFactory } from "../../charts/chart/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** Layer / reference / format builders surfaced on the `<Chart>` tag (mirrors the `Chart` factory namespace). */
type ChartBuilders = {
    Line: typeof ChartFactory.Line;
    Bar: typeof ChartFactory.Bar;
    Area: typeof ChartFactory.Area;
    Scatter: typeof ChartFactory.Scatter;
    Band: typeof ChartFactory.Band;
    Series: typeof ChartFactory.Series;
    refLine: typeof ChartFactory.refLine;
    refBand: typeof ChartFactory.refBand;
    refDot: typeof ChartFactory.refDot;
    format: typeof ChartFactory.format;
    Spec: typeof ChartFactory.Spec;
};

/**
 * Composed Cartesian chart — assembles one or more marks (line / bar / area /
 * scatter / area-range band) over a shared coordinate system into a single
 * plot. Build each mark with the layer builders attached to the tag and pass
 * them as `layers`; configure the axes, legend, grid, tooltip, and stacking
 * via the remaining props. Mixed-mark and dual-axis figures (bars + trend
 * line, stacked areas + confidence band) all come from listing several
 * builder calls in `layers`. Reach for this whenever you need a real,
 * axis-bearing chart rather than the inline {@link Sparkline}.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, ArrayType, StructType, StringType, IntegerType } from "@elaraai/east";
 * import { Box, Chart, UIComponentType } from "@elaraai/east-ui";
 *
 * const revenueVsProfit = East.function([], UIComponentType, $ => {
 *     const rows = $.const([
 *         { month: "Jan", revenue: 186n, profit: 80n },
 *         { month: "Feb", revenue: 305n, profit: 120n },
 *         { month: "Mar", revenue: 237n, profit: 95n },
 *     ], ArrayType(StructType({ month: StringType, revenue: IntegerType, profit: IntegerType })));
 *     return (
 *         <Box height="260px" width="100%">
 *             <Chart layers={[
 *                 Chart.Bar(rows, { x: r => r.month, y: r => r.revenue }, { key: "Revenue", color: "teal.solid" }),
 *                 Chart.Line(rows, { x: r => r.month, y: r => r.profit }, { key: "Profit", color: "purple.solid" }),
 *             ]} legend tooltip grid />
 *         </Box>
 *     );
 * });
 * ```
 *
 * @remarks
 * Carries the layer and annotation builders that produce the entries for
 * `layers` (these build chart layers, not nested child tags): mark builders
 * `Chart.Line` / `Chart.Bar` / `Chart.Area` / `Chart.Scatter` / `Chart.Band`
 * (each takes `(rows, encoding, style?)` with typed-accessor encodings, e.g.
 * `x: r => r.month`); reference annotations `Chart.refLine` / `Chart.refBand`
 * / `Chart.refDot`; the axis tick formatters under `Chart.format` (`date` /
 * `currency` / `percent` / `compact`); and the low-level `Chart.Spec` escape
 * hatch. Desugars to `Chart.Root(layers, options)`.
 */
export const Chart: JsxTag<ValueProps<typeof ChartFactory.Root, "layers">> & ChartBuilders =
    Object.assign(leaf(ChartFactory.Root, "layers"), {
        Line: ChartFactory.Line,
        Bar: ChartFactory.Bar,
        Area: ChartFactory.Area,
        Scatter: ChartFactory.Scatter,
        Band: ChartFactory.Band,
        Series: ChartFactory.Series,
        refLine: ChartFactory.refLine,
        refBand: ChartFactory.refBand,
        refDot: ChartFactory.refDot,
        format: ChartFactory.format,
        Spec: ChartFactory.Spec,
    });
