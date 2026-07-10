/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, FloatType, DateTimeType, StringType, StructType, ArrayType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { AlignedStack, Box, Chart, Reactive, Table, VStack } from "@elaraai/east-ui";

// Rows for the tooltip-over-sticky-header layering example (below).
const TOOLTIP_TABLE_ROWS = Array.from({ length: 14 }, (_, i) => ({
    id: `SKU-${String(i + 1).padStart(3, "0")}`,
    region: (["North", "South", "East", "West"] as const)[i % 4]!,
    value: BigInt(600 + i * 73),
}));

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

export const tooltipOverStickyTable = example({
    keywords: ["Chart", "tooltip", "zIndex", "z-index", "sticky", "stickyHeader", "Table", "header", "overlay", "layering", "portal"],
    description: "Chart hover tooltip layers ABOVE a sibling Table's sticky column header — hover the line near the BOTTOM of the chart so the tooltip overlaps the header row directly below it. The tooltip's z-index must sit on its own positioned content (the visx portal wrapper is position:static, so its z-index is ignored) or the sticky header (z-index 2) paints over it.",
    fn: East.function([], UIComponentType, ($) => {
        const chartRows = $.const([
            { month: "Jan", sales: 100n }, { month: "Feb", sales: 150n }, { month: "Mar", sales: 120n },
            { month: "Apr", sales: 180n }, { month: "May", sales: 140n }, { month: "Jun", sales: 170n },
        ], ArrayType(StructType({ month: StringType, sales: IntegerType })));
        const tableRows = $.const(TOOLTIP_TABLE_ROWS, ArrayType(StructType({ id: StringType, region: StringType, value: IntegerType })));
        return (
            <VStack gap="0" align="stretch" width="100%">
                <Box height="160px" width="100%">
                    <Chart layers={Chart.Line(chartRows, { x: r => r.month, y: r => r.sales }, { color: "teal.solid" })} grid tooltip />
                </Box>
                <Table data={tableRows} columns={["id", "region", "value"]} height="150px" stickyHeader />
            </VStack>
        );
    }),
    inputs: [],
});

export const columnStackedDiverging = example({
    keywords: ["Chart", "Column", "stack", "stacked", "negative", "diverging", "bidirectional", "refLine"],
    description: "Diverging stacked columns — a positive stack grows UP from zero and a negative stack (values × -1) grows DOWN, on one left axis; the negative stacked bars must render (a bare bot−top height collapses them to zero).",
    fn: East.function([], UIComponentType, ($) => {
        const freed = $.const([
            { day: "Mon", grp: "A", kl: 40.0 }, { day: "Mon", grp: "B", kl: 30.0 },
            { day: "Tue", grp: "A", kl: 55.0 }, { day: "Tue", grp: "B", kl: 20.0 },
            { day: "Wed", grp: "A", kl: 35.0 }, { day: "Wed", grp: "B", kl: 45.0 },
        ], ArrayType(StructType({ day: StringType, grp: StringType, kl: FloatType })));
        const consumed = $.const([
            { day: "Mon", grp: "X", kl: 25.0 }, { day: "Mon", grp: "Y", kl: 35.0 },
            { day: "Tue", grp: "X", kl: 40.0 }, { day: "Tue", grp: "Y", kl: 15.0 },
            { day: "Wed", grp: "X", kl: 30.0 }, { day: "Wed", grp: "Y", kl: 20.0 },
        ], ArrayType(StructType({ day: StringType, grp: StringType, kl: FloatType })));
        return (
            <Box height="280px" width="100%">
                <Chart grid legend tooltip layers={[
                    Chart.Column(freed, { x: r => r.day, y: r => r.kl, by: r => r.grp }, { stack: "freed" }),
                    Chart.Column(consumed, { x: r => r.day, y: r => r.kl.multiply(-1.0), by: r => r.grp }, { stack: "consumed" }),
                    Chart.refLine({ y: 0.0 }),
                ]} />
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

export const lineStepAfterSetpoint = example({
    keywords: ["Chart", "Line", "curve", "stepAfter", "stepBefore", "step", "setpoint", "held"],
    description: "stepAfter curve — a held setpoint extends forward from each point until the next change (riser after the point); stepBefore holds up to the point",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { day: 0n, setpoint: 18.0 }, { day: 2n, setpoint: 22.0 },
            { day: 5n, setpoint: 20.0 }, { day: 8n, setpoint: 16.0 },
        ], ArrayType(StructType({ day: IntegerType, setpoint: FloatType })));
        return (
            <Box height="220px" width="100%">
                <Chart layers={Chart.Line(rows, { x: r => r.day, y: r => r.setpoint }, { curve: "stepAfter", width: 2, color: "black" })} grid />
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

export const lineIntegerDayTicks = example({
    keywords: ["Chart", "axis", "numTicks", "tickValues", "ticks", "integer", "day", "align", "Planner"],
    description: "Explicit integer day ticks (tickValues) on the x-axis — pins the ticks to [0,1,…,6] so a stacked Planner's day columns line up, instead of the auto-niced set",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { day: 0.0, temp: 22.0 }, { day: 2.0, temp: 20.5 },
            { day: 4.0, temp: 18.0 }, { day: 6.0, temp: 16.5 },
        ], ArrayType(StructType({ day: FloatType, temp: FloatType })));
        return (
            <Box height="240px" width="100%">
                <Chart
                    layers={Chart.Line(rows, { x: r => r.day, y: r => r.temp }, { color: "teal.solid" })}
                    x={{ label: "Day", scale: "linear", domain: [0, 6], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                    y={{ label: "°C", numTicks: 3 }}
                    grid
                />
            </Box>
        );
    }),
    inputs: [],
});

export const lineRuntimeDomain = example({
    keywords: ["Chart", "Line", "domain", "axis", "extent", "runtime", "expression", "SubtypeExprOrValue", "forecast"],
    description: "Numeric x-axis whose upper extent is runtime-driven — the domain max is an East expression (decision day + p95 + buffer)",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { day: 0.0, value: 10.0 }, { day: 1.5, value: 22.0 },
            { day: 3.0, value: 41.0 }, { day: 4.0, value: 52.0 },
        ], ArrayType(StructType({ day: FloatType, value: FloatType })));
        // A data-derived press-ETA: the axis ends exactly where the forecast does,
        // rather than at a compile-time constant.
        const decisionDay = $.const(2.0, FloatType);
        const p95 = $.const(3.5, FloatType);
        const buffer = $.const(1.0, FloatType);
        return (
            <Box height="240px" width="100%">
                <Chart
                    layers={Chart.Line(rows, { x: r => r.day, y: r => r.value }, { color: "teal.solid" })}
                    x={{ label: "Day", scale: "linear", domain: [0, decisionDay.add(p95).add(buffer)] }}
                    y={{ label: "Forecast" }}
                    grid
                />
            </Box>
        );
    }),
    inputs: [],
});

export const lineRuntimeTimeDomain = example({
    keywords: ["Chart", "Line", "domain", "time", "DateTime", "axis", "extent", "runtime", "expression"],
    description: "Time x-axis whose extent is given by DateTime expressions (runtime-driven temporal domain)",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { at: new Date("2025-01-01"), v: 10.0 },
            { at: new Date("2025-02-01"), v: 18.0 },
            { at: new Date("2025-03-01"), v: 26.0 },
        ], ArrayType(StructType({ at: DateTimeType, v: FloatType })));
        const start = $.const(new Date("2024-12-15"), DateTimeType);
        const end = $.const(new Date("2025-03-20"), DateTimeType);
        return (
            <Box height="240px" width="100%">
                <Chart
                    layers={Chart.Line(rows, { x: r => r.at, y: r => r.v })}
                    x={{ label: "Month", scale: "time", domain: [start, end], format: Chart.format.date("MMM YYYY") }}
                    y={{ label: "Value" }}
                    grid
                />
            </Box>
        );
    }),
    inputs: [],
});

export const lineSampleFan = example({
    keywords: ["Chart", "Line", "opacity", "legend", "tooltip", "fan", "sample-path", "by", "overlay", "decoration"],
    description: "A faint fan of generative sample paths (low stroke opacity, kept out of both the legend and the tooltip) behind a bold median line",
    fn: East.function([], UIComponentType, ($) => {
        const fan = $.const([
            { t: 0n, sid: "s0", y: 10.0 }, { t: 1n, sid: "s0", y: 14.0 }, { t: 2n, sid: "s0", y: 13.0 },
            { t: 0n, sid: "s1", y: 11.0 }, { t: 1n, sid: "s1", y: 9.0 }, { t: 2n, sid: "s1", y: 15.0 },
            { t: 0n, sid: "s2", y: 9.0 }, { t: 1n, sid: "s2", y: 12.0 }, { t: 2n, sid: "s2", y: 11.0 },
        ], ArrayType(StructType({ t: IntegerType, sid: StringType, y: FloatType })));
        const median = $.const([
            { t: 0n, y: 10.0 }, { t: 1n, y: 12.0 }, { t: 2n, y: 13.0 },
        ], ArrayType(StructType({ t: IntegerType, y: FloatType })));
        return (
            <Box height="260px" width="100%">
                <Chart
                    layers={[
                        // Decoration layer: out of the legend AND the tooltip, so hovering
                        // surfaces only the median rather than one row per sample id.
                        Chart.Line(fan, { x: r => r.t, y: r => r.y, by: r => r.sid }, { opacity: 0.2, legend: false, tooltip: false, dots: false }),
                        Chart.Line(median, { x: r => r.t, y: r => r.y }, { key: "Median", color: "blue.solid", width: 2, dots: false }),
                    ]}
                    x={{ label: "Step", scale: "linear" }}
                    y={{ label: "Value" }}
                    legend grid tooltip
                />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Column — vertical bars: grouped, stacked, percent-stacked, breakdown
// ============================================================================

export const columnBasic = example({
    keywords: ["Chart", "Column", "bar", "vertical", "single-series", "currency"],
    description: "Single column series (vertical bars) with a compact-currency y-axis",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { q: "Q1", revenue: 186n }, { q: "Q2", revenue: 305n }, { q: "Q3", revenue: 237n }, { q: "Q4", revenue: 273n },
        ], ArrayType(StructType({ q: StringType, revenue: IntegerType })));
        return (
            <Box height="220px" width="100%">
                <Chart layers={Chart.Column(rows, { x: r => r.q, y: r => r.revenue }, { color: "teal.solid" })} y={{ format: Chart.format.currency({ compact: true }) }} grid />
            </Box>
        );
    }),
    inputs: [],
});

export const columnPerCategory = example({
    keywords: ["Chart", "Column", "bar", "per-category", "colors", "composition", "single-series"],
    description: "A single column series coloured per x-category (composition mix) — full-width columns, in data order, no grouped split",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { discipline: "RN", share: 42n }, { discipline: "EN", share: 28n }, { discipline: "Physio", share: 16n },
            { discipline: "OT", share: 9n }, { discipline: "Admin", share: 5n },
        ], ArrayType(StructType({ discipline: StringType, share: IntegerType })));
        return (
            <Box height="220px" width="100%">
                <Chart
                    layers={Chart.Column(rows, {
                        x: r => r.discipline, y: r => r.share,
                        colors: { RN: "teal.solid", EN: "cyan.solid", Physio: "blue.solid", OT: "purple.solid", Admin: "gray.solid" },
                    })}
                    grid
                />
            </Box>
        );
    }),
    inputs: [],
});

export const columnGrouped = example({
    keywords: ["Chart", "Column", "bar", "grouped", "columns", "multi-series"],
    description: "Grouped columns from value columns",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { region: "NA", a: 40n, b: 30n }, { region: "EU", a: 55n, b: 45n }, { region: "APAC", a: 30n, b: 60n },
        ], ArrayType(StructType({ region: StringType, a: IntegerType, b: IntegerType })));
        return (
            <Box height="220px" width="100%">
                <Chart layers={Chart.Column(rows, { x: r => r.region, columns: { Product: r => r.a, Service: r => r.b } })} legend />
            </Box>
        );
    }),
    inputs: [],
});

export const columnStacked = example({
    keywords: ["Chart", "Column", "bar", "stacked", "stack", "columns"],
    description: "Stacked columns sharing a stack id",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { week: "W1", mobile: 50n, desktop: 100n }, { week: "W2", mobile: 70n, desktop: 120n },
            { week: "W3", mobile: 60n, desktop: 110n },
        ], ArrayType(StructType({ week: StringType, mobile: IntegerType, desktop: IntegerType })));
        return (
            <Box height="220px" width="100%">
                <Chart layers={Chart.Column(rows, { x: r => r.week, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop } }, { stack: "traffic" })} legend />
            </Box>
        );
    }),
    inputs: [],
});

export const columnPercentStacked = example({
    keywords: ["Chart", "Column", "bar", "stackOffset", "expand", "percent", "breakdown"],
    description: "100% stacked columns by breakdown, percent axis",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { week: "W1", channel: "Search", spend: 40n }, { week: "W1", channel: "Social", spend: 60n },
            { week: "W2", channel: "Search", spend: 55n }, { week: "W2", channel: "Social", spend: 45n },
        ], ArrayType(StructType({ week: StringType, channel: StringType, spend: IntegerType })));
        return (
            <Box height="240px" width="100%">
                <Chart layers={Chart.Column(rows, { x: r => r.week, y: r => r.spend, by: r => r.channel }, { stack: "mix" })} stackOffset="expand" y={{ format: Chart.format.percent() }} legend />
            </Box>
        );
    }),
    inputs: [],
});

export const columnCustomColors = example({
    keywords: ["Chart", "Column", "bar", "by", "colors", "custom", "palette"],
    description: "Breakdown columns with an explicit per-value colour map overriding the palette",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { week: "W1", channel: "Search", spend: 40n }, { week: "W1", channel: "Social", spend: 60n },
            { week: "W2", channel: "Search", spend: 55n }, { week: "W2", channel: "Social", spend: 45n },
        ], ArrayType(StructType({ week: StringType, channel: StringType, spend: IntegerType })));
        return (
            <Box height="220px" width="100%">
                <Chart layers={Chart.Column(rows, { x: r => r.week, y: r => r.spend, by: r => r.channel, colors: { Search: "blue.solid", Social: "orange.solid" } })} legend />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Bar — horizontal bars (#249): numeric x measure, categorical y band
// ============================================================================

export const barRanked = example({
    keywords: ["Chart", "Bar", "horizontal", "ranked", "categorical-y", "long-labels", "AlignedStack", "plotGutter", "currency"],
    description: "Ranked horizontal bars — numeric x, categorical y; long category labels sit in an AlignedStack left gutter",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { product: "Industrial Conveyor Belts", revenue: 482n },
            { product: "Hydraulic Press Fittings", revenue: 305n },
            { product: "Pneumatic Valve Assemblies", revenue: 237n },
            { product: "Stainless Fastener Kits", revenue: 186n },
            { product: "Bearing Housings", revenue: 121n },
        ], ArrayType(StructType({ product: StringType, revenue: IntegerType })));
        return (
            <AlignedStack gutter={{ left: "170px", right: "12px" }}>
                <Box height="240px" width="100%">
                    <Chart
                        layers={Chart.Bar(rows, { x: r => r.revenue, y: r => r.product }, { color: "teal.solid" })}
                        x={{ format: Chart.format.currency({ compact: true }) }}
                        grid tooltip
                    />
                </Box>
            </AlignedStack>
        );
    }),
    inputs: [],
});

export const barGrouped = example({
    keywords: ["Chart", "Bar", "horizontal", "grouped", "columns", "multi-series"],
    description: "Grouped horizontal bars from value columns — one sub-bar per column within each category band",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { site: "North", loaded: 42n, empty: 18n }, { site: "South", loaded: 35n, empty: 25n },
            { site: "West", loaded: 28n, empty: 12n },
        ], ArrayType(StructType({ site: StringType, loaded: IntegerType, empty: IntegerType })));
        return (
            <Box height="240px" width="100%">
                <Chart layers={Chart.Bar(rows, { y: r => r.site, columns: { Loaded: r => r.loaded, Empty: r => r.empty } })} legend grid />
            </Box>
        );
    }),
    inputs: [],
});

export const barStacked = example({
    keywords: ["Chart", "Bar", "horizontal", "stacked", "stack", "by", "breakdown", "tooltip"],
    description: "Stacked horizontal bars by breakdown — the hover tooltip matches on the y band",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { site: "North", shift: "Day", tonnes: 120n }, { site: "North", shift: "Night", tonnes: 80n },
            { site: "South", shift: "Day", tonnes: 95n }, { site: "South", shift: "Night", tonnes: 110n },
            { site: "West", shift: "Day", tonnes: 60n }, { site: "West", shift: "Night", tonnes: 45n },
        ], ArrayType(StructType({ site: StringType, shift: StringType, tonnes: IntegerType })));
        return (
            <Box height="240px" width="100%">
                <Chart layers={Chart.Bar(rows, { x: r => r.tonnes, y: r => r.site, by: r => r.shift }, { stack: "tonnage" })} legend tooltip grid />
            </Box>
        );
    }),
    inputs: [],
});

export const barPercentStacked = example({
    keywords: ["Chart", "Bar", "horizontal", "stackOffset", "expand", "percent", "breakdown"],
    description: "100% stacked horizontal bars by breakdown — percent x-axis via stackOffset expand",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { week: "W1", channel: "Search", spend: 40n }, { week: "W1", channel: "Social", spend: 60n },
            { week: "W2", channel: "Search", spend: 55n }, { week: "W2", channel: "Social", spend: 45n },
        ], ArrayType(StructType({ week: StringType, channel: StringType, spend: IntegerType })));
        return (
            <Box height="240px" width="100%">
                <Chart
                    layers={Chart.Bar(rows, { x: r => r.spend, y: r => r.week, by: r => r.channel }, { stack: "mix" })}
                    stackOffset="expand"
                    x={{ format: Chart.format.percent() }}
                    legend
                />
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

export const composedColumnLine = example({
    keywords: ["Chart", "Composed", "column", "bar", "line", "mixed-marks"],
    description: "Revenue columns with a profit line overlay",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { month: "Jan", revenue: 186n, profit: 80n }, { month: "Feb", revenue: 305n, profit: 120n },
            { month: "Mar", revenue: 237n, profit: 95n }, { month: "Apr", revenue: 273n, profit: 150n },
        ], ArrayType(StructType({ month: StringType, revenue: IntegerType, profit: IntegerType })));
        return (
            <Box height="260px" width="100%">
                <Chart layers={[
                    Chart.Column(rows, { x: r => r.month, y: r => r.revenue }, { key: "Revenue", color: "teal.solid" }),
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
                <Chart layers={Chart.Column(rows, { x: r => r.at, y: r => r.revenue }, { color: "teal.solid" })} x={{ format: Chart.format.date("MMM") }} y={{ format: Chart.format.currency({ compact: true }) }} grid />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Interactive — value sourced from reactive State (proves expression-valued data)
// ============================================================================

export const interactiveValue = example({
    keywords: ["Chart", "Column", "Reactive", "State", "interactive", "expression"],
    description: "A column chart whose last value is driven by reactive State",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const peak = $.let(State.bind([IntegerType], "chart_peak", 90n));
            const peakVal = $.let(peak.read());
            const rows = $.const([
                { q: "Q1", v: 40n }, { q: "Q2", v: 65n }, { q: "Q3", v: 55n }, { q: "Q4", v: peakVal },
            ], ArrayType(StructType({ q: StringType, v: IntegerType })));
            return <Chart layers={Chart.Column(rows, { x: r => r.q, y: r => r.v }, { color: "teal.solid" })} grid />;
        }}</Reactive>
    )),
    inputs: [],
});
