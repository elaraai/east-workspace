/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, FloatType, DateTimeType, StringType, StructType, ArrayType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Chart, Reactive } from "@elaraai/east-ui/jsx";

// ============================================================================
// Line — marks, encodings, curves, scales
// ============================================================================

export const lineBasic = example({
    keywords: ["Chart", "Line", "single-series", "band", "grid"],
    description: "Single line over a categorical (band) x-axis",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { month: "Jan", sales: 100n }, { month: "Feb", sales: 150n },
            { month: "Mar", sales: 120n }, { month: "Apr", sales: 180n },
        ], ArrayType(StructType({ month: StringType, sales: IntegerType })));
        return (
            <Box height="220px" width="100%">
                <Chart layers={Chart.Line(rows, { x: r => r.month, y: r => r.sales }, { color: "teal.solid" })} grid tooltip />
            </Box>
        );
    }),
    inputs: [],
});

export const lineMultiColumns = example({
    keywords: ["Chart", "Line", "multi-series", "columns", "wide", "legend"],
    description: "Multiple lines from wide value columns",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { month: "Jan", mac: 10n, linux: 120n }, { month: "Feb", mac: 95n, linux: 110n },
            { month: "Mar", mac: 87n, linux: 125n }, { month: "Apr", mac: 110n, linux: 100n },
        ], ArrayType(StructType({ month: StringType, mac: IntegerType, linux: IntegerType })));
        return (
            <Box height="240px" width="100%">
                <Chart layers={Chart.Line(rows, { x: r => r.month, columns: { Mac: r => r.mac, Linux: r => r.linux } })} legend grid tooltip />
            </Box>
        );
    }),
    inputs: [],
});

export const lineBreakdown = example({
    keywords: ["Chart", "Line", "multi-series", "breakdown", "by", "split"],
    description: "One line per breakdown value (long-format split)",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { month: "Jan", os: "Mac", n: 10n }, { month: "Jan", os: "Linux", n: 120n },
            { month: "Feb", os: "Mac", n: 95n }, { month: "Feb", os: "Linux", n: 110n },
            { month: "Mar", os: "Mac", n: 87n }, { month: "Mar", os: "Linux", n: 125n },
        ], ArrayType(StructType({ month: StringType, os: StringType, n: IntegerType })));
        return (
            <Box height="240px" width="100%">
                <Chart layers={Chart.Line(rows, { x: r => r.month, y: r => r.n, by: r => r.os })} legend grid />
            </Box>
        );
    }),
    inputs: [],
});

export const lineCurveNatural = example({
    keywords: ["Chart", "Line", "curve", "natural", "smooth"],
    description: "Smooth natural-curve interpolation",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { month: "Jan", sales: 100n }, { month: "Feb", sales: 150n },
            { month: "Mar", sales: 120n }, { month: "Apr", sales: 180n },
        ], ArrayType(StructType({ month: StringType, sales: IntegerType })));
        return (
            <Box height="220px" width="100%">
                <Chart layers={Chart.Line(rows, { x: r => r.month, y: r => r.sales }, { curve: "natural", color: "green.solid" })} grid />
            </Box>
        );
    }),
    inputs: [],
});

export const lineStepNoDots = example({
    keywords: ["Chart", "Line", "curve", "step", "dots", "strokeWidth"],
    description: "Stepped line, thick stroke, no point markers",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { month: "Jan", price: 100n }, { month: "Feb", price: 120n },
            { month: "Mar", price: 115n }, { month: "Apr", price: 140n },
        ], ArrayType(StructType({ month: StringType, price: IntegerType })));
        return (
            <Box height="220px" width="100%">
                <Chart layers={Chart.Line(rows, { x: r => r.month, y: r => r.price }, { curve: "step", width: 2, dots: false, color: "orange.solid" })} grid />
            </Box>
        );
    }),
    inputs: [],
});

export const lineDashedTargetOverlay = example({
    keywords: ["Chart", "Line", "dash", "layers", "per-series-style"],
    description: "Actual vs dashed target as two styled line layers",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { month: "Jan", actual: 100n, target: 110n }, { month: "Feb", actual: 150n, target: 130n },
            { month: "Mar", actual: 120n, target: 140n }, { month: "Apr", actual: 180n, target: 150n },
        ], ArrayType(StructType({ month: StringType, actual: IntegerType, target: IntegerType })));
        return (
            <Box height="240px" width="100%">
                <Chart layers={[
                    Chart.Line(rows, { x: r => r.month, y: r => r.actual }, { key: "Actual", color: "teal.solid", width: 2 }),
                    Chart.Line(rows, { x: r => r.month, y: r => r.target }, { key: "Target", color: "gray.solid", dash: "5 5", dots: false }),
                ]} legend grid />
            </Box>
        );
    }),
    inputs: [],
});

export const lineTemporal = example({
    keywords: ["Chart", "Line", "time", "temporal", "DateTime", "format"],
    description: "Temporal line — DateTime x (time scale inferred), date tick format",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { at: new Date("2025-01-01"), users: 1200n }, { at: new Date("2025-02-01"), users: 1500n },
            { at: new Date("2025-03-01"), users: 1700n }, { at: new Date("2025-04-01"), users: 1650n },
        ], ArrayType(StructType({ at: DateTimeType, users: IntegerType })));
        return (
            <Box height="240px" width="100%">
                <Chart
                    layers={Chart.Line(rows, { x: r => r.at, y: r => r.users })}
                    x={{ format: Chart.format.date("MMM YYYY") }}
                    y={{ format: Chart.format.compact() }}
                    grid
                />
            </Box>
        );
    }),
    inputs: [],
});

export const lineNumericX = example({
    keywords: ["Chart", "Line", "linear", "numeric", "domain"],
    description: "Continuous numeric x-axis with an explicit domain",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { dose: 0.5, response: 12.0 }, { dose: 1.0, response: 30.0 },
            { dose: 2.5, response: 55.0 }, { dose: 5.0, response: 70.0 },
        ], ArrayType(StructType({ dose: FloatType, response: FloatType })));
        return (
            <Box height="240px" width="100%">
                <Chart
                    layers={Chart.Line(rows, { x: r => r.dose, y: r => r.response }, { color: "purple.solid" })}
                    x={{ label: "Dose", scale: "linear", domain: [0, 6] }}
                    y={{ label: "Response" }}
                    grid
                />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Bar — grouped, stacked, percent-stacked, breakdown
// ============================================================================

export const barBasic = example({
    keywords: ["Chart", "Bar", "single-series", "currency"],
    description: "Single bar series with a compact-currency y-axis",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { q: "Q1", revenue: 186n }, { q: "Q2", revenue: 305n }, { q: "Q3", revenue: 237n }, { q: "Q4", revenue: 273n },
        ], ArrayType(StructType({ q: StringType, revenue: IntegerType })));
        return (
            <Box height="220px" width="100%">
                <Chart layers={Chart.Bar(rows, { x: r => r.q, y: r => r.revenue }, { color: "teal.solid" })} y={{ format: Chart.format.currency({ compact: true }) }} grid />
            </Box>
        );
    }),
    inputs: [],
});

export const barGrouped = example({
    keywords: ["Chart", "Bar", "grouped", "columns", "multi-series"],
    description: "Grouped bars from value columns",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { region: "NA", a: 40n, b: 30n }, { region: "EU", a: 55n, b: 45n }, { region: "APAC", a: 30n, b: 60n },
        ], ArrayType(StructType({ region: StringType, a: IntegerType, b: IntegerType })));
        return (
            <Box height="220px" width="100%">
                <Chart layers={Chart.Bar(rows, { x: r => r.region, columns: { Product: r => r.a, Service: r => r.b } })} legend />
            </Box>
        );
    }),
    inputs: [],
});

export const barStacked = example({
    keywords: ["Chart", "Bar", "stacked", "stack", "columns"],
    description: "Stacked bars sharing a stack id",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { week: "W1", mobile: 50n, desktop: 100n }, { week: "W2", mobile: 70n, desktop: 120n },
            { week: "W3", mobile: 60n, desktop: 110n },
        ], ArrayType(StructType({ week: StringType, mobile: IntegerType, desktop: IntegerType })));
        return (
            <Box height="220px" width="100%">
                <Chart layers={Chart.Bar(rows, { x: r => r.week, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop } }, { stack: "traffic" })} legend />
            </Box>
        );
    }),
    inputs: [],
});

export const barPercentStacked = example({
    keywords: ["Chart", "Bar", "stackOffset", "expand", "percent", "breakdown"],
    description: "100% stacked bars by breakdown, percent axis",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { week: "W1", channel: "Search", spend: 40n }, { week: "W1", channel: "Social", spend: 60n },
            { week: "W2", channel: "Search", spend: 55n }, { week: "W2", channel: "Social", spend: 45n },
        ], ArrayType(StructType({ week: StringType, channel: StringType, spend: IntegerType })));
        return (
            <Box height="240px" width="100%">
                <Chart layers={Chart.Bar(rows, { x: r => r.week, y: r => r.spend, by: r => r.channel })} stackOffset="expand" y={{ format: Chart.format.percent() }} legend />
            </Box>
        );
    }),
    inputs: [],
});

export const barCustomColors = example({
    keywords: ["Chart", "Bar", "by", "colors", "custom", "palette"],
    description: "Breakdown bars with an explicit per-value colour map overriding the palette",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { week: "W1", channel: "Search", spend: 40n }, { week: "W1", channel: "Social", spend: 60n },
            { week: "W2", channel: "Search", spend: 55n }, { week: "W2", channel: "Social", spend: 45n },
        ], ArrayType(StructType({ week: StringType, channel: StringType, spend: IntegerType })));
        return (
            <Box height="220px" width="100%">
                <Chart layers={Chart.Bar(rows, { x: r => r.week, y: r => r.spend, by: r => r.channel, colors: { Search: "blue.solid", Social: "orange.solid" } })} legend />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Area — stacked, band (area-range)
// ============================================================================

export const areaStacked = example({
    keywords: ["Chart", "Area", "stacked", "stack", "fillOpacity", "columns"],
    description: "Stacked filled areas",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { month: "Jan", mobile: 50n, desktop: 100n }, { month: "Feb", mobile: 70n, desktop: 120n },
            { month: "Mar", mobile: 60n, desktop: 110n }, { month: "Apr", mobile: 90n, desktop: 140n },
        ], ArrayType(StructType({ month: StringType, mobile: IntegerType, desktop: IntegerType })));
        return (
            <Box height="240px" width="100%">
                <Chart layers={Chart.Area(rows, { x: r => r.month, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop } }, { stack: "traffic", fillOpacity: 0.5 })} legend grid />
            </Box>
        );
    }),
    inputs: [],
});

export const areaConfidenceBand = example({
    keywords: ["Chart", "Band", "area-range", "confidence", "low", "high"],
    description: "Confidence band (low/high) behind a line",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { day: "Mon", value: 100n, lo: 80n, hi: 120n }, { day: "Tue", value: 150n, lo: 130n, hi: 170n },
            { day: "Wed", value: 130n, lo: 110n, hi: 150n }, { day: "Thu", value: 180n, lo: 160n, hi: 200n },
        ], ArrayType(StructType({ day: StringType, value: IntegerType, lo: IntegerType, hi: IntegerType })));
        return (
            <Box height="240px" width="100%">
                <Chart layers={[
                    Chart.Band(rows, { x: r => r.day, low: r => r.lo, high: r => r.hi }, { key: "Range", color: "blue.200", fillOpacity: 0.3 }),
                    Chart.Line(rows, { x: r => r.day, y: r => r.value }, { key: "Value", color: "blue.solid", width: 2 }),
                ]} legend tooltip grid />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Scatter
// ============================================================================

export const scatterQuadrants = example({
    keywords: ["Chart", "Scatter", "columns", "domain", "reference", "refLine", "size"],
    description: "Two cohorts with a fixed domain, larger markers, and quadrant reference lines",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { effort: 10.0, value: 80.0, baseline: 20.0 }, { effort: 35.0, value: 55.0, baseline: 60.0 },
            { effort: 70.0, value: 30.0, baseline: 90.0 },
        ], ArrayType(StructType({ effort: FloatType, value: FloatType, baseline: FloatType })));
        return (
            <Box height="280px" width="100%">
                <Chart
                    layers={[
                        Chart.Scatter(rows, { x: r => r.effort, columns: { Value: r => r.value, Baseline: r => r.baseline } }, { size: 6 }),
                        Chart.refLine({ x: 50, dash: "3 3" }),
                        Chart.refLine({ y: 50, dash: "3 3" }),
                    ]}
                    x={{ label: "Effort", scale: "linear", domain: [0, 100] }}
                    y={{ label: "Value", domain: [0, 100] }}
                    legend
                />
            </Box>
        );
    }),
    inputs: [],
});

export const scatterBubble = example({
    keywords: ["Chart", "Scatter", "bubble", "size", "per-point", "area"],
    description: "Bubble chart — per-point marker size from a data field (area-proportional)",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { gdp: 1.2, life: 62.0, pop: 1400.0 }, { gdp: 4.5, life: 78.0, pop: 330.0 },
            { gdp: 2.1, life: 70.0, pop: 210.0 }, { gdp: 5.8, life: 82.0, pop: 125.0 },
        ], ArrayType(StructType({ gdp: FloatType, life: FloatType, pop: FloatType })));
        return (
            <Box height="260px" width="100%">
                <Chart layers={Chart.Scatter(rows, { x: r => r.gdp, y: r => r.life, size: r => r.pop })} x={{ label: "GDP per capita" }} y={{ label: "Life expectancy" }} grid />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Composed — mixed marks, dual-axis, band, references
// ============================================================================

export const composedBarLine = example({
    keywords: ["Chart", "Composed", "bar", "line", "mixed-marks"],
    description: "Revenue bars with a profit line overlay",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { month: "Jan", revenue: 186n, profit: 80n }, { month: "Feb", revenue: 305n, profit: 120n },
            { month: "Mar", revenue: 237n, profit: 95n }, { month: "Apr", revenue: 273n, profit: 150n },
        ], ArrayType(StructType({ month: StringType, revenue: IntegerType, profit: IntegerType })));
        return (
            <Box height="260px" width="100%">
                <Chart layers={[
                    Chart.Bar(rows, { x: r => r.month, y: r => r.revenue }, { key: "Revenue", color: "teal.solid" }),
                    Chart.Line(rows, { x: r => r.month, y: r => r.profit }, { key: "Profit", color: "purple.solid", dots: true }),
                ]} legend tooltip grid />
            </Box>
        );
    }),
    inputs: [],
});

export const composedDualAxisForecast = example({
    keywords: ["Chart", "Composed", "dual-axis", "axis", "y2", "band", "reference", "stack"],
    description: "Stacked traffic + confidence band + right-axis trend line + reference line",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { month: "Jan", mobile: 50n, desktop: 100n, lo: 130n, hi: 170n, trend: 150n },
            { month: "Feb", mobile: 70n, desktop: 120n, lo: 165n, hi: 215n, trend: 190n },
            { month: "Mar", mobile: 60n, desktop: 110n, lo: 150n, hi: 200n, trend: 175n },
            { month: "Apr", mobile: 90n, desktop: 140n, lo: 205n, hi: 265n, trend: 235n },
        ], ArrayType(StructType({
            month: StringType, mobile: IntegerType, desktop: IntegerType, lo: IntegerType, hi: IntegerType, trend: IntegerType,
        })));
        return (
            <Box height="300px" width="100%">
                <Chart
                    layers={[
                        Chart.Area(rows, { x: r => r.month, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop } }, { stack: "traffic", fillOpacity: 0.5 }),
                        Chart.Band(rows, { x: r => r.month, low: r => r.lo, high: r => r.hi }, { key: "Confidence", color: "blue.200", fillOpacity: 0.3 }),
                        Chart.Line(rows, { x: r => r.month, y: r => r.trend }, { key: "Trend", color: "red.solid", dash: "5 5", dots: false, axis: "right", order: 10 }),
                        Chart.refLine({ y: 200, label: "Capacity", dash: "4 4" }),
                    ]}
                    y={{ label: "Sessions" }}
                    y2={{ label: "Trend", format: Chart.format.compact() }}
                    legend
                    tooltip
                    grid
                />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// References — line / band / dot annotations
// ============================================================================

export const referenceAnnotations = example({
    keywords: ["Chart", "refLine", "refBand", "refDot", "reference", "annotation"],
    description: "A target line, a normal-range band, and a highlighted peak dot",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { month: "Jan", value: 100n }, { month: "Feb", value: 150n },
            { month: "Mar", value: 237n }, { month: "Apr", value: 180n },
        ], ArrayType(StructType({ month: StringType, value: IntegerType })));
        return (
            <Box height="240px" width="100%">
                <Chart layers={[
                    Chart.refBand({ y: [120, 200], label: "Normal" }),
                    Chart.Line(rows, { x: r => r.month, y: r => r.value }, { color: "teal.solid" }),
                    Chart.refLine({ y: 220, label: "Target", dash: "4 4" }),
                    Chart.refDot({ x: "Mar", y: 237, label: "Peak" }),
                ]} grid />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Axis formatting
// ============================================================================

export const axisFormatting = example({
    keywords: ["Chart", "format", "currency", "date", "compact", "axis"],
    description: "Date x-axis with a compact-currency y-axis",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { at: new Date("2025-01-01"), revenue: 12000n }, { at: new Date("2025-02-01"), revenue: 18500n },
            { at: new Date("2025-03-01"), revenue: 21000n },
        ], ArrayType(StructType({ at: DateTimeType, revenue: IntegerType })));
        return (
            <Box height="240px" width="100%">
                <Chart layers={Chart.Bar(rows, { x: r => r.at, y: r => r.revenue }, { color: "teal.solid" })} x={{ format: Chart.format.date("MMM") }} y={{ format: Chart.format.currency({ compact: true }) }} grid />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Interactive — value sourced from reactive State (proves expression-valued data)
// ============================================================================

export const interactiveValue = example({
    keywords: ["Chart", "Reactive", "State", "interactive", "expression"],
    description: "A bar chart whose last value is driven by reactive State",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const peak = $.let(State.bind([IntegerType], "chart_peak", 90n));
            const peakVal = $.let(peak.read());
            const rows = $.const([
                { q: "Q1", v: 40n }, { q: "Q2", v: 65n }, { q: "Q3", v: 55n }, { q: "Q4", v: peakVal },
            ], ArrayType(StructType({ q: StringType, v: IntegerType })));
            return <Chart layers={Chart.Bar(rows, { x: r => r.q, y: r => r.v }, { color: "teal.solid" })} grid />;
        }}</Reactive>
    )),
    inputs: [],
});
