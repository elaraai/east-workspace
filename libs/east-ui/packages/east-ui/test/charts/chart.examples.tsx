/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, FloatType, DateTimeType, StringType, StructType, ArrayType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { AlignedStack, Box, Chart, Reactive, Table, Text, VStack } from "@elaraai/east-ui";

// Rows for the tooltip-over-sticky-header layering example (below).
const TOOLTIP_TABLE_ROWS = Array.from({ length: 14 }, (_, i) => ({
    id: `SKU-${String(i + 1).padStart(3, "0")}`,
    region: (["North", "South", "East", "West"] as const)[i % 4]!,
    value: BigInt(600 + i * 73),
}));

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const LINE_MULTI_COLUMNS_DATA = [
    { month: "Jan", mac: 10n, linux: 120n }, { month: "Feb", mac: 95n, linux: 110n },
    { month: "Mar", mac: 87n, linux: 125n }, { month: "Apr", mac: 110n, linux: 100n },
];
const LINE_BREAKDOWN_DATA = [
    { month: "Jan", os: "Mac", n: 10n }, { month: "Jan", os: "Linux", n: 120n },
    { month: "Feb", os: "Mac", n: 95n }, { month: "Feb", os: "Linux", n: 110n },
    { month: "Mar", os: "Mac", n: 87n }, { month: "Mar", os: "Linux", n: 125n },
];
const LINE_CURVE_NATURAL_DATA = [
    { month: "Jan", sales: 100n }, { month: "Feb", sales: 150n },
    { month: "Mar", sales: 120n }, { month: "Apr", sales: 180n },
];
const LINE_STEP_NO_DOTS_DATA = [
    { month: "Jan", price: 100n }, { month: "Feb", price: 120n },
    { month: "Mar", price: 115n }, { month: "Apr", price: 140n },
];
const LINE_STEP_AFTER_SETPOINT_DATA = [
    { day: 0n, setpoint: 18.0 }, { day: 2n, setpoint: 22.0 },
    { day: 5n, setpoint: 20.0 }, { day: 8n, setpoint: 16.0 },
];
const LINE_DASHED_TARGET_OVERLAY_DATA = [
    { month: "Jan", actual: 100n, target: 110n }, { month: "Feb", actual: 150n, target: 130n },
    { month: "Mar", actual: 120n, target: 140n }, { month: "Apr", actual: 180n, target: 150n },
];
const LINE_SAMPLE_FAN_DATA = [
    { t: 0n, sid: "s0", y: 10.0 }, { t: 1n, sid: "s0", y: 14.0 }, { t: 2n, sid: "s0", y: 13.0 },
    { t: 0n, sid: "s1", y: 11.0 }, { t: 1n, sid: "s1", y: 9.0 }, { t: 2n, sid: "s1", y: 15.0 },
    { t: 0n, sid: "s2", y: 9.0 }, { t: 1n, sid: "s2", y: 12.0 }, { t: 2n, sid: "s2", y: 11.0 },
];
const LINE_SAMPLE_FAN_MEDIAN_DATA = [
    { t: 0n, y: 10.0 }, { t: 1n, y: 12.0 }, { t: 2n, y: 13.0 },
];
const LINE_TEMPORAL_DATA = [
    { at: new Date("2025-01-01"), users: 1200n }, { at: new Date("2025-02-01"), users: 1500n },
    { at: new Date("2025-03-01"), users: 1700n }, { at: new Date("2025-04-01"), users: 1650n },
];
const LINE_NUMERIC_X_DATA = [
    { dose: 0.5, response: 12.0 }, { dose: 1.0, response: 30.0 },
    { dose: 2.5, response: 55.0 }, { dose: 5.0, response: 70.0 },
];
const LINE_INTEGER_DAY_TICKS_DATA = [
    { day: 0.0, temp: 22.0 }, { day: 2.0, temp: 20.5 },
    { day: 4.0, temp: 18.0 }, { day: 6.0, temp: 16.5 },
];
const LINE_RUNTIME_DOMAIN_DATA = [
    { day: 0.0, value: 10.0 }, { day: 1.5, value: 22.0 },
    { day: 3.0, value: 41.0 }, { day: 4.0, value: 52.0 },
];
const LINE_RUNTIME_TIME_DOMAIN_DATA = [
    { at: new Date("2025-01-01"), v: 10.0 },
    { at: new Date("2025-02-01"), v: 18.0 },
    { at: new Date("2025-03-01"), v: 26.0 },
];
// Axis typography overrides (#315) — `tickStyle` / `titleStyle` on any axis
// restyle its tick labels and caption over the spec chrome; titleGap pushes
// the caption out from the ticks. The legibility treatment for dense lanes.
const AXIS_TEXT_STYLED_DATA = [
    { at: new Date("2026-03-30T12:00:00Z"), v: 8.0 },
    { at: new Date("2026-03-31T12:00:00Z"), v: 10.0 },
    { at: new Date("2026-04-01T12:00:00Z"), v: 14.0 },
    { at: new Date("2026-04-02T12:00:00Z"), v: 12.0 },
    { at: new Date("2026-04-03T12:00:00Z"), v: 9.0 },
];
const AXIS_FORMATTING_DATA = [
    { at: new Date("2025-01-01"), revenue: 12000n }, { at: new Date("2025-02-01"), revenue: 18500n },
    { at: new Date("2025-03-01"), revenue: 21000n },
];
// Explicit Date ticks on a `time` axis (#318) — `tickValues` accepts
// `DateTime[]` positions on a time scale, rendered through the date
// `tickFormat`; pins ticks to exact instants (e.g. a stacked Planner's
// day-column starts under a shared AlignedStack gutter).
const CHART_TIME_TICK_VALUES_DATA = [
    { at: new Date("2026-03-30T00:00:00Z"), v: 12.0 },
    { at: new Date("2026-03-31T12:00:00Z"), v: 15.5 },
    { at: new Date("2026-04-02T00:00:00Z"), v: 14.0 },
    { at: new Date("2026-04-03T18:00:00Z"), v: 18.5 },
    { at: new Date("2026-04-05T06:00:00Z"), v: 16.0 },
];
const COLUMN_BASIC_DATA = [
    { q: "Q1", revenue: 186n }, { q: "Q2", revenue: 305n }, { q: "Q3", revenue: 237n }, { q: "Q4", revenue: 273n },
];
const COLUMN_PER_CATEGORY_DATA = [
    { discipline: "RN", share: 42n }, { discipline: "EN", share: 28n }, { discipline: "Physio", share: 16n },
    { discipline: "OT", share: 9n }, { discipline: "Admin", share: 5n },
];
const COLUMN_GROUPED_DATA = [
    { region: "NA", a: 40n, b: 30n }, { region: "EU", a: 55n, b: 45n }, { region: "APAC", a: 30n, b: 60n },
];
const COLUMN_STACKED_DATA = [
    { week: "W1", mobile: 50n, desktop: 100n }, { week: "W2", mobile: 70n, desktop: 120n },
    { week: "W3", mobile: 60n, desktop: 110n },
];
const COLUMN_PERCENT_STACKED_DATA = [
    { week: "W1", channel: "Search", spend: 40n }, { week: "W1", channel: "Social", spend: 60n },
    { week: "W2", channel: "Search", spend: 55n }, { week: "W2", channel: "Social", spend: 45n },
];
const COLUMN_CUSTOM_COLORS_DATA = [
    { week: "W1", channel: "Search", spend: 40n }, { week: "W1", channel: "Social", spend: 60n },
    { week: "W2", channel: "Search", spend: 55n }, { week: "W2", channel: "Social", spend: 45n },
];
const COLUMN_STACKED_DIVERGING_DATA = [
    { day: "Mon", grp: "A", kl: 40.0 }, { day: "Mon", grp: "B", kl: 30.0 },
    { day: "Tue", grp: "A", kl: 55.0 }, { day: "Tue", grp: "B", kl: 20.0 },
    { day: "Wed", grp: "A", kl: 35.0 }, { day: "Wed", grp: "B", kl: 45.0 },
];
const COLUMN_STACKED_DIVERGING_CONSUMED_DATA = [
    { day: "Mon", grp: "X", kl: 25.0 }, { day: "Mon", grp: "Y", kl: 35.0 },
    { day: "Tue", grp: "X", kl: 40.0 }, { day: "Tue", grp: "Y", kl: 15.0 },
    { day: "Wed", grp: "X", kl: 30.0 }, { day: "Wed", grp: "Y", kl: 20.0 },
];
const BAR_RANKED_DATA = [
    { product: "Industrial Conveyor Belts", revenue: 482n },
    { product: "Hydraulic Press Fittings", revenue: 305n },
    { product: "Pneumatic Valve Assemblies", revenue: 237n },
    { product: "Stainless Fastener Kits", revenue: 186n },
    { product: "Bearing Housings", revenue: 121n },
];
const BAR_GROUPED_DATA = [
    { site: "North", loaded: 42n, empty: 18n }, { site: "South", loaded: 35n, empty: 25n },
    { site: "West", loaded: 28n, empty: 12n },
];
const BAR_STACKED_DATA = [
    { site: "North", shift: "Day", tonnes: 120n }, { site: "North", shift: "Night", tonnes: 80n },
    { site: "South", shift: "Day", tonnes: 95n }, { site: "South", shift: "Night", tonnes: 110n },
    { site: "West", shift: "Day", tonnes: 60n }, { site: "West", shift: "Night", tonnes: 45n },
];
const BAR_PERCENT_STACKED_DATA = [
    { week: "W1", channel: "Search", spend: 40n }, { week: "W1", channel: "Social", spend: 60n },
    { week: "W2", channel: "Search", spend: 55n }, { week: "W2", channel: "Social", spend: 45n },
];
const AREA_STACKED_DATA = [
    { month: "Jan", mobile: 50n, desktop: 100n }, { month: "Feb", mobile: 70n, desktop: 120n },
    { month: "Mar", mobile: 60n, desktop: 110n }, { month: "Apr", mobile: 90n, desktop: 140n },
];
const AREA_CONFIDENCE_BAND_DATA = [
    { day: "Mon", value: 100n, lo: 80n, hi: 120n }, { day: "Tue", value: 150n, lo: 130n, hi: 170n },
    { day: "Wed", value: 130n, lo: 110n, hi: 150n }, { day: "Thu", value: 180n, lo: 160n, hi: 200n },
];
const SCATTER_QUADRANTS_DATA = [
    { effort: 10.0, value: 80.0, baseline: 20.0 }, { effort: 35.0, value: 55.0, baseline: 60.0 },
    { effort: 70.0, value: 30.0, baseline: 90.0 },
];
const SCATTER_BUBBLE_DATA = [
    { gdp: 1.2, life: 62.0, pop: 1400.0 }, { gdp: 4.5, life: 78.0, pop: 330.0 },
    { gdp: 2.1, life: 70.0, pop: 210.0 }, { gdp: 5.8, life: 82.0, pop: 125.0 },
];
const COMPOSED_COLUMN_LINE_DATA = [
    { month: "Jan", revenue: 186n, profit: 80n }, { month: "Feb", revenue: 305n, profit: 120n },
    { month: "Mar", revenue: 237n, profit: 95n }, { month: "Apr", revenue: 273n, profit: 150n },
];
const COMPOSED_DUAL_AXIS_FORECAST_DATA = [
    { month: "Jan", mobile: 50n, desktop: 100n, lo: 130n, hi: 170n, trend: 150n },
    { month: "Feb", mobile: 70n, desktop: 120n, lo: 165n, hi: 215n, trend: 190n },
    { month: "Mar", mobile: 60n, desktop: 110n, lo: 150n, hi: 200n, trend: 175n },
    { month: "Apr", mobile: 90n, desktop: 140n, lo: 205n, hi: 265n, trend: 235n },
];
const REFERENCE_ANNOTATIONS_DATA = [
    { month: "Jan", value: 100n }, { month: "Feb", value: 150n },
    { month: "Mar", value: 237n }, { month: "Apr", value: 180n },
];

// ============================================================================
// Basic — the search-index front door
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

// ============================================================================
// Line — marks, encodings, curves (variant panel)
// ============================================================================

export const lineVariants = example({
    keywords: ["Chart", "Line", "multi-series", "columns", "wide", "legend", "breakdown", "by", "split", "curve", "natural", "smooth", "step", "dots", "strokeWidth", "stepAfter", "stepBefore", "setpoint", "held", "dash", "layers", "per-series-style", "opacity", "tooltip", "fan", "sample-path", "overlay", "decoration"],
    description: "Line mark variant panel — multi columns (wide value columns), breakdown (long-format split), curve natural, step no dots, step after setpoint (held setpoint), dashed target overlay, sample fan (decoration layer kept out of legend + tooltip)",
    fn: East.function([], UIComponentType, ($) => {
        const multiColumns = $.const(LINE_MULTI_COLUMNS_DATA, ArrayType(StructType({ month: StringType, mac: IntegerType, linux: IntegerType })));
        const breakdown = $.const(LINE_BREAKDOWN_DATA, ArrayType(StructType({ month: StringType, os: StringType, n: IntegerType })));
        const curveNatural = $.const(LINE_CURVE_NATURAL_DATA, ArrayType(StructType({ month: StringType, sales: IntegerType })));
        const stepNoDots = $.const(LINE_STEP_NO_DOTS_DATA, ArrayType(StructType({ month: StringType, price: IntegerType })));
        const stepAfter = $.const(LINE_STEP_AFTER_SETPOINT_DATA, ArrayType(StructType({ day: IntegerType, setpoint: FloatType })));
        const dashedTarget = $.const(LINE_DASHED_TARGET_OVERLAY_DATA, ArrayType(StructType({ month: StringType, actual: IntegerType, target: IntegerType })));
        const fan = $.const(LINE_SAMPLE_FAN_DATA, ArrayType(StructType({ t: IntegerType, sid: StringType, y: FloatType })));
        const median = $.const(LINE_SAMPLE_FAN_MEDIAN_DATA, ArrayType(StructType({ t: IntegerType, y: FloatType })));
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">MULTI COLUMNS</Text>
                    <Box height="240px" width="100%">
                        <Chart layers={Chart.Line(multiColumns, { x: r => r.month, columns: { Mac: r => r.mac, Linux: r => r.linux } })} legend grid tooltip />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">BREAKDOWN</Text>
                    <Box height="240px" width="100%">
                        <Chart layers={Chart.Line(breakdown, { x: r => r.month, y: r => r.n, by: r => r.os })} legend grid />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">CURVE NATURAL</Text>
                    <Box height="220px" width="100%">
                        <Chart layers={Chart.Line(curveNatural, { x: r => r.month, y: r => r.sales }, { curve: "natural", color: "green.solid" })} grid />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">STEP NO DOTS</Text>
                    <Box height="220px" width="100%">
                        <Chart layers={Chart.Line(stepNoDots, { x: r => r.month, y: r => r.price }, { curve: "step", width: 2, dots: false, color: "orange.solid" })} grid />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">STEP AFTER SETPOINT</Text>
                    <Box height="220px" width="100%">
                        <Chart layers={Chart.Line(stepAfter, { x: r => r.day, y: r => r.setpoint }, { curve: "stepAfter", width: 2, color: "black" })} grid />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">DASHED TARGET OVERLAY</Text>
                    <Box height="240px" width="100%">
                        <Chart layers={[
                            Chart.Line(dashedTarget, { x: r => r.month, y: r => r.actual }, { key: "Actual", color: "teal.solid", width: 2 }),
                            Chart.Line(dashedTarget, { x: r => r.month, y: r => r.target }, { key: "Target", color: "gray.solid", dash: "5 5", dots: false }),
                        ]} legend grid />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SAMPLE FAN</Text>
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
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Axes — scales, domains, ticks, formats, typography (variant panel)
// ============================================================================

export const axisVariants = example({
    keywords: ["Chart", "Line", "time", "temporal", "DateTime", "format", "linear", "numeric", "domain", "axis", "numTicks", "tickValues", "ticks", "integer", "day", "align", "Planner", "extent", "runtime", "expression", "SubtypeExprOrValue", "forecast", "tickStyle", "titleStyle", "titleGap", "font", "typography", "fontSize", "fontFamily", "fontWeight", "color", "letterSpacing", "legibility", "label", "currency", "date", "compact", "pin", "explicit", "#318"],
    description: "Axis variant panel — temporal (DateTime x, date tick format), numeric x (explicit domain), integer day ticks (tickValues pinned to [0..6]), runtime domain (East-expression extent), runtime time domain (DateTime expressions), axis text styled (tickStyle/titleStyle/titleGap, #315), axis formatting (date x + compact-currency y), chart time tick values (#318 Monday tick instants on a time axis)",
    fn: East.function([], UIComponentType, ($) => {
        const temporal = $.const(LINE_TEMPORAL_DATA, ArrayType(StructType({ at: DateTimeType, users: IntegerType })));
        const numericX = $.const(LINE_NUMERIC_X_DATA, ArrayType(StructType({ dose: FloatType, response: FloatType })));
        const dayTicks = $.const(LINE_INTEGER_DAY_TICKS_DATA, ArrayType(StructType({ day: FloatType, temp: FloatType })));
        const runtimeDomain = $.const(LINE_RUNTIME_DOMAIN_DATA, ArrayType(StructType({ day: FloatType, value: FloatType })));
        const runtimeTime = $.const(LINE_RUNTIME_TIME_DOMAIN_DATA, ArrayType(StructType({ at: DateTimeType, v: FloatType })));
        const axisStyled = $.const(AXIS_TEXT_STYLED_DATA, ArrayType(StructType({ at: DateTimeType, v: FloatType })));
        const axisFormat = $.const(AXIS_FORMATTING_DATA, ArrayType(StructType({ at: DateTimeType, revenue: IntegerType })));
        const timeTicks = $.const(CHART_TIME_TICK_VALUES_DATA, ArrayType(StructType({ at: DateTimeType, v: FloatType })));
        // A data-derived press-ETA: the axis ends exactly where the forecast does,
        // rather than at a compile-time constant.
        const decisionDay = $.const(2.0, FloatType);
        const p95 = $.const(3.5, FloatType);
        const buffer = $.const(1.0, FloatType);
        const start = $.const(new Date("2024-12-15"), DateTimeType);
        const end = $.const(new Date("2025-03-20"), DateTimeType);
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">TEMPORAL</Text>
                    <Box height="240px" width="100%">
                        <Chart
                            layers={Chart.Line(temporal, { x: r => r.at, y: r => r.users })}
                            x={{ format: Chart.format.date("MMM YYYY") }}
                            y={{ format: Chart.format.compact() }}
                            grid
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">NUMERIC X</Text>
                    <Box height="240px" width="100%">
                        <Chart
                            layers={Chart.Line(numericX, { x: r => r.dose, y: r => r.response }, { color: "purple.solid" })}
                            x={{ label: "Dose", scale: "linear", domain: [0, 6] }}
                            y={{ label: "Response" }}
                            grid
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">INTEGER DAY TICKS</Text>
                    <Box height="240px" width="100%">
                        <Chart
                            layers={Chart.Line(dayTicks, { x: r => r.day, y: r => r.temp }, { color: "teal.solid" })}
                            x={{ label: "Day", scale: "linear", domain: [0, 6], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                            y={{ label: "°C", numTicks: 3 }}
                            grid
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RUNTIME DOMAIN</Text>
                    <Box height="240px" width="100%">
                        <Chart
                            layers={Chart.Line(runtimeDomain, { x: r => r.day, y: r => r.value }, { color: "teal.solid" })}
                            x={{ label: "Day", scale: "linear", domain: [0, decisionDay.add(p95).add(buffer)] }}
                            y={{ label: "Forecast" }}
                            grid
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RUNTIME TIME DOMAIN</Text>
                    <Box height="240px" width="100%">
                        <Chart
                            layers={Chart.Line(runtimeTime, { x: r => r.at, y: r => r.v })}
                            x={{ label: "Month", scale: "time", domain: [start, end], format: Chart.format.date("MMM YYYY") }}
                            y={{ label: "Value" }}
                            grid
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">AXIS TEXT STYLED</Text>
                    <Box height="240px" width="100%">
                        <Chart
                            layers={Chart.Line(axisStyled, { x: r => r.at, y: r => r.v })}
                            x={{ scale: "time", format: Chart.format.date("ddd DD"), tickStyle: { fontSize: "12px", fontFamily: "sans", color: "fg.default" } }}
                            y={{ label: "Clarified kL", titleGap: 6, tickStyle: { fontSize: "12px" }, titleStyle: { fontFamily: "sans", fontWeight: "semibold", color: "fg.default", letterSpacing: "0.02em" } }}
                            grid
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">AXIS FORMATTING</Text>
                    <Box height="240px" width="100%">
                        <Chart layers={Chart.Column(axisFormat, { x: r => r.at, y: r => r.revenue }, { color: "teal.solid" })} x={{ format: Chart.format.date("MMM") }} y={{ format: Chart.format.currency({ compact: true }) }} grid />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">CHART TIME TICK VALUES — #318 MONDAY TICK INSTANTS</Text>
                    <Box height="240px" width="100%">
                        <Chart
                            layers={Chart.Line(timeTicks, { x: r => r.at, y: r => r.v }, { color: "teal.solid", dots: true })}
                            x={{
                                scale: "time",
                                domain: [new Date("2026-03-30T00:00:00Z"), new Date("2026-04-06T00:00:00Z")],
                                tickValues: [
                                    new Date("2026-03-30T00:00:00Z"),
                                    new Date("2026-04-01T00:00:00Z"),
                                    new Date("2026-04-03T00:00:00Z"),
                                    new Date("2026-04-05T00:00:00Z"),
                                ],
                                format: Chart.format.date("ddd DD"),
                            }}
                            grid
                        />
                    </Box>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Column — vertical bars (variant panel)
// ============================================================================

export const columnVariants = example({
    keywords: ["Chart", "Column", "bar", "vertical", "single-series", "currency", "per-category", "colors", "composition", "grouped", "columns", "multi-series", "stacked", "stack", "stackOffset", "expand", "percent", "breakdown", "by", "custom", "palette", "negative", "diverging", "bidirectional", "refLine"],
    description: "Column variant panel — column basic (compact-currency y), column per category (per-x colours), column grouped, column stacked, column percent stacked (stackOffset expand), column custom colors (explicit per-value colour map), column stacked diverging (negative stack grows down from zero, refLine at zero)",
    fn: East.function([], UIComponentType, ($) => {
        const basic = $.const(COLUMN_BASIC_DATA, ArrayType(StructType({ q: StringType, revenue: IntegerType })));
        const perCategory = $.const(COLUMN_PER_CATEGORY_DATA, ArrayType(StructType({ discipline: StringType, share: IntegerType })));
        const grouped = $.const(COLUMN_GROUPED_DATA, ArrayType(StructType({ region: StringType, a: IntegerType, b: IntegerType })));
        const stacked = $.const(COLUMN_STACKED_DATA, ArrayType(StructType({ week: StringType, mobile: IntegerType, desktop: IntegerType })));
        const percentStacked = $.const(COLUMN_PERCENT_STACKED_DATA, ArrayType(StructType({ week: StringType, channel: StringType, spend: IntegerType })));
        const customColors = $.const(COLUMN_CUSTOM_COLORS_DATA, ArrayType(StructType({ week: StringType, channel: StringType, spend: IntegerType })));
        const freed = $.const(COLUMN_STACKED_DIVERGING_DATA, ArrayType(StructType({ day: StringType, grp: StringType, kl: FloatType })));
        const consumed = $.const(COLUMN_STACKED_DIVERGING_CONSUMED_DATA, ArrayType(StructType({ day: StringType, grp: StringType, kl: FloatType })));
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">COLUMN BASIC</Text>
                    <Box height="220px" width="100%">
                        <Chart layers={Chart.Column(basic, { x: r => r.q, y: r => r.revenue }, { color: "teal.solid" })} y={{ format: Chart.format.currency({ compact: true }) }} grid />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">COLUMN PER CATEGORY</Text>
                    <Box height="220px" width="100%">
                        <Chart
                            layers={Chart.Column(perCategory, {
                                x: r => r.discipline, y: r => r.share,
                                colors: { RN: "teal.solid", EN: "cyan.solid", Physio: "blue.solid", OT: "purple.solid", Admin: "gray.solid" },
                            })}
                            grid
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">COLUMN GROUPED</Text>
                    <Box height="220px" width="100%">
                        <Chart layers={Chart.Column(grouped, { x: r => r.region, columns: { Product: r => r.a, Service: r => r.b } })} legend />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">COLUMN STACKED</Text>
                    <Box height="220px" width="100%">
                        <Chart layers={Chart.Column(stacked, { x: r => r.week, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop } }, { stack: "traffic" })} legend />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">COLUMN PERCENT STACKED</Text>
                    <Box height="240px" width="100%">
                        <Chart layers={Chart.Column(percentStacked, { x: r => r.week, y: r => r.spend, by: r => r.channel }, { stack: "mix" })} stackOffset="expand" y={{ format: Chart.format.percent() }} legend />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">COLUMN CUSTOM COLORS</Text>
                    <Box height="220px" width="100%">
                        <Chart layers={Chart.Column(customColors, { x: r => r.week, y: r => r.spend, by: r => r.channel, colors: { Search: "blue.solid", Social: "orange.solid" } })} legend />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">COLUMN STACKED DIVERGING</Text>
                    <Box height="280px" width="100%">
                        <Chart grid legend tooltip layers={[
                            Chart.Column(freed, { x: r => r.day, y: r => r.kl, by: r => r.grp }, { stack: "freed" }),
                            Chart.Column(consumed, { x: r => r.day, y: r => r.kl.multiply(-1.0), by: r => r.grp }, { stack: "consumed" }),
                            Chart.refLine({ y: 0.0 }),
                        ]} />
                    </Box>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Bar — horizontal bars (#249) (variant panel)
// ============================================================================

export const barVariants = example({
    keywords: ["Chart", "Bar", "horizontal", "ranked", "categorical-y", "long-labels", "AlignedStack", "plotGutter", "currency", "grouped", "columns", "multi-series", "stacked", "stack", "by", "breakdown", "tooltip", "stackOffset", "expand", "percent"],
    description: "Bar variant panel — bar ranked (long category labels in an AlignedStack left gutter), bar grouped (one sub-bar per column), bar stacked (tooltip matches on the y band), bar percent stacked (stackOffset expand, percent x-axis)",
    fn: East.function([], UIComponentType, ($) => {
        const ranked = $.const(BAR_RANKED_DATA, ArrayType(StructType({ product: StringType, revenue: IntegerType })));
        const grouped = $.const(BAR_GROUPED_DATA, ArrayType(StructType({ site: StringType, loaded: IntegerType, empty: IntegerType })));
        const stacked = $.const(BAR_STACKED_DATA, ArrayType(StructType({ site: StringType, shift: StringType, tonnes: IntegerType })));
        const percentStacked = $.const(BAR_PERCENT_STACKED_DATA, ArrayType(StructType({ week: StringType, channel: StringType, spend: IntegerType })));
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">BAR RANKED — ALIGNEDSTACK LABEL GUTTER</Text>
                    <AlignedStack gutter={{ left: "170px", right: "12px" }}>
                        <Box height="240px" width="100%">
                            <Chart
                                layers={Chart.Bar(ranked, { x: r => r.revenue, y: r => r.product }, { color: "teal.solid" })}
                                x={{ format: Chart.format.currency({ compact: true }) }}
                                grid tooltip
                            />
                        </Box>
                    </AlignedStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">BAR GROUPED</Text>
                    <Box height="240px" width="100%">
                        <Chart layers={Chart.Bar(grouped, { y: r => r.site, columns: { Loaded: r => r.loaded, Empty: r => r.empty } })} legend grid />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">BAR STACKED</Text>
                    <Box height="240px" width="100%">
                        <Chart layers={Chart.Bar(stacked, { x: r => r.tonnes, y: r => r.site, by: r => r.shift }, { stack: "tonnage" })} legend tooltip grid />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">BAR PERCENT STACKED</Text>
                    <Box height="240px" width="100%">
                        <Chart
                            layers={Chart.Bar(percentStacked, { x: r => r.spend, y: r => r.week, by: r => r.channel }, { stack: "mix" })}
                            stackOffset="expand"
                            x={{ format: Chart.format.percent() }}
                            legend
                        />
                    </Box>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Area + Scatter (variant panel)
// ============================================================================

export const areaScatterVariants = example({
    keywords: ["Chart", "Area", "stacked", "stack", "fillOpacity", "columns", "Band", "area-range", "confidence", "low", "high", "Scatter", "domain", "reference", "refLine", "size", "bubble", "per-point", "area"],
    description: "Area + Scatter variant panel — area stacked (filled areas sharing a stack), area confidence band (low/high Band behind a line), scatter quadrants (fixed domain, larger markers, quadrant refLines), scatter bubble (per-point marker size from a data field)",
    fn: East.function([], UIComponentType, ($) => {
        const stacked = $.const(AREA_STACKED_DATA, ArrayType(StructType({ month: StringType, mobile: IntegerType, desktop: IntegerType })));
        const band = $.const(AREA_CONFIDENCE_BAND_DATA, ArrayType(StructType({ day: StringType, value: IntegerType, lo: IntegerType, hi: IntegerType })));
        const quadrants = $.const(SCATTER_QUADRANTS_DATA, ArrayType(StructType({ effort: FloatType, value: FloatType, baseline: FloatType })));
        const bubble = $.const(SCATTER_BUBBLE_DATA, ArrayType(StructType({ gdp: FloatType, life: FloatType, pop: FloatType })));
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">AREA STACKED</Text>
                    <Box height="240px" width="100%">
                        <Chart layers={Chart.Area(stacked, { x: r => r.month, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop } }, { stack: "traffic", fillOpacity: 0.5 })} legend grid />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">AREA CONFIDENCE BAND</Text>
                    <Box height="240px" width="100%">
                        <Chart layers={[
                            Chart.Band(band, { x: r => r.day, low: r => r.lo, high: r => r.hi }, { key: "Range", color: "blue.200", fillOpacity: 0.3 }),
                            Chart.Line(band, { x: r => r.day, y: r => r.value }, { key: "Value", color: "blue.solid", width: 2 }),
                        ]} legend tooltip grid />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SCATTER QUADRANTS</Text>
                    <Box height="280px" width="100%">
                        <Chart
                            layers={[
                                Chart.Scatter(quadrants, { x: r => r.effort, columns: { Value: r => r.value, Baseline: r => r.baseline } }, { size: 6 }),
                                Chart.refLine({ x: 50, dash: "3 3" }),
                                Chart.refLine({ y: 50, dash: "3 3" }),
                            ]}
                            x={{ label: "Effort", scale: "linear", domain: [0, 100] }}
                            y={{ label: "Value", domain: [0, 100] }}
                            legend
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SCATTER BUBBLE</Text>
                    <Box height="260px" width="100%">
                        <Chart layers={Chart.Scatter(bubble, { x: r => r.gdp, y: r => r.life, size: r => r.pop })} x={{ label: "GDP per capita" }} y={{ label: "Life expectancy" }} grid />
                    </Box>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Composed — mixed marks, dual-axis, references (variant panel)
// ============================================================================

export const composedVariants = example({
    keywords: ["Chart", "Composed", "column", "bar", "line", "mixed-marks", "dual-axis", "axis", "y2", "band", "reference", "stack", "refLine", "refBand", "refDot", "annotation"],
    description: "Composed variant panel — composed column line (revenue columns + profit line), composed dual axis forecast (stacked traffic + confidence band + right-axis trend + refLine), reference annotations (a target refLine, a normal-range refBand, and a highlighted peak refDot, each visible)",
    fn: East.function([], UIComponentType, ($) => {
        const columnLine = $.const(COMPOSED_COLUMN_LINE_DATA, ArrayType(StructType({ month: StringType, revenue: IntegerType, profit: IntegerType })));
        const forecast = $.const(COMPOSED_DUAL_AXIS_FORECAST_DATA, ArrayType(StructType({
            month: StringType, mobile: IntegerType, desktop: IntegerType, lo: IntegerType, hi: IntegerType, trend: IntegerType,
        })));
        const annotations = $.const(REFERENCE_ANNOTATIONS_DATA, ArrayType(StructType({ month: StringType, value: IntegerType })));
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">COMPOSED COLUMN LINE</Text>
                    <Box height="260px" width="100%">
                        <Chart layers={[
                            Chart.Column(columnLine, { x: r => r.month, y: r => r.revenue }, { key: "Revenue", color: "teal.solid" }),
                            Chart.Line(columnLine, { x: r => r.month, y: r => r.profit }, { key: "Profit", color: "purple.solid", dots: true }),
                        ]} legend tooltip grid />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">COMPOSED DUAL AXIS FORECAST</Text>
                    <Box height="300px" width="100%">
                        <Chart
                            layers={[
                                Chart.Area(forecast, { x: r => r.month, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop } }, { stack: "traffic", fillOpacity: 0.5 }),
                                Chart.Band(forecast, { x: r => r.month, low: r => r.lo, high: r => r.hi }, { key: "Confidence", color: "blue.200", fillOpacity: 0.3 }),
                                Chart.Line(forecast, { x: r => r.month, y: r => r.trend }, { key: "Trend", color: "red.solid", dash: "5 5", dots: false, axis: "right", order: 10 }),
                                Chart.refLine({ y: 200, label: "Capacity", dash: "4 4" }),
                            ]}
                            y={{ label: "Sessions" }}
                            y2={{ label: "Trend", format: Chart.format.compact() }}
                            legend
                            tooltip
                            grid
                        />
                    </Box>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">REFERENCE ANNOTATIONS</Text>
                    <Box height="240px" width="100%">
                        <Chart layers={[
                            Chart.refBand({ y: [120, 200], label: "Normal" }),
                            Chart.Line(annotations, { x: r => r.month, y: r => r.value }, { color: "teal.solid" }),
                            Chart.refLine({ y: 220, label: "Target", dash: "4 4" }),
                            Chart.refDot({ x: "Mar", y: 237, label: "Peak" }),
                        ]} grid />
                    </Box>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Behavioral isolates
// ============================================================================

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
