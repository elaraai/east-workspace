/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, FloatType, StringType, StructType, ArrayType, BooleanType, NullType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Chart, Configurator, HStack, Reactive, SegmentGroup, Select, Switch, Table, Text, VStack } from "@elaraai/east-ui";

// Rows for the tooltip-over-sticky-header layering example (below).

// ============================================================================
// Module-scope fixtures — one per configurator cell (consolidation epic #455).
// ============================================================================

const BAR_GROUPED_DATA = [
    { site: "North", loaded: 42n, empty: 18n }, { site: "South", loaded: 35n, empty: 25n },
    { site: "West", loaded: 28n, empty: 12n },
];

const BAR_PERCENT_STACKED_DATA = [
    { week: "W1", channel: "Search", spend: 40n }, { week: "W1", channel: "Social", spend: 60n },
    { week: "W2", channel: "Search", spend: 55n }, { week: "W2", channel: "Social", spend: 45n },
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
            <Box height="260px" width="100%">
                <Chart layers={Chart.Line(rows, { x: r => r.month, y: r => r.sales }, { color: "teal.solid" })} grid tooltip />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Line — live configurator over the mark + axis dimensions
// ============================================================================

export const lineVariants = example({
    keywords: ["Chart", "Line", "multi-series", "columns", "wide", "legend", "breakdown", "by", "split", "curve", "natural", "smooth", "step", "dots", "strokeWidth", "stepAfter", "stepBefore", "setpoint", "held", "dash", "layers", "per-series-style", "opacity", "tooltip", "fan", "sample-path", "overlay", "decoration", "time", "temporal", "DateTime", "format", "linear", "numeric", "domain", "axis", "numTicks", "tickValues", "ticks", "integer", "day", "align", "Planner", "extent", "runtime", "expression", "SubtypeExprOrValue", "forecast", "tickStyle", "titleStyle", "titleGap", "font", "typography", "fontSize", "fontFamily", "fontWeight", "color", "letterSpacing", "legibility", "label", "currency", "date", "compact", "pin", "explicit", "#318", "Column", "Reactive", "State", "interactive", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Line chart configurator — a curve axis plus points and tick-format switches on ONE live line; the aside’s Q4 column tracks a reactive peak against a pinned domain",
    fn: East.function([], UIComponentType, (_$) => {
        const LINE_CURVE_NATURAL_DATA = [
            { month: "Jan", sales: 100n }, { month: "Feb", sales: 150n },
            { month: "Mar", sales: 120n }, { month: "Apr", sales: 180n },
        ];
        return (
            <Reactive>{$ => {
                const rows = $.const(LINE_CURVE_NATURAL_DATA, ArrayType(StructType({ month: StringType, sales: IntegerType })));
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const curves = $.const([
                    variant("linear", null), variant("natural", null),
                    variant("step", null), variant("stepAfter", null),
                ], ArrayType(Chart.Spec.Types.Curve));
                const curveBind  = $.let(State.bind([StringType], "chart_curve", "natural"));
                const pointsBind = $.let(State.bind([BooleanType], "chart_points", true));
                const formatBind = $.let(State.bind([BooleanType], "chart_format", false));
                const peak       = $.let(State.bind([IntegerType], "chart_peak", 90n));

                const curveKey   = $.let(curveBind.read());
                const dots       = $.let(pointsBind.read());
                const compactFmt = $.let(formatBind.read());
                const peakVal    = $.let(peak.read());

                const onCurve  = $.const(East.function([StringType], NullType, ($, next) => { $(curveBind.write(next)); }));
                const onPoints = $.const(East.function([BooleanType], NullType, ($, next) => { $(pointsBind.write(next)); }));
                const onFormat = $.const(East.function([BooleanType], NullType, ($, next) => { $(formatBind.write(next)); }));
                const bump     = $.const(East.function([], NullType, $ => {
                    const cur = $.let(peak.read());
                    const next = $.let(cur.greater(140n).ifElse(_$ => 60n, _$ => cur.add(15n)));
                    $(peak.write(next));
                }));

                // Each selection is a lookup into the same array the control renders.
                const curve = $.let(curves.filter((_$, v) => v.getTag().equal(curveKey)).get(0n));
                // curve / dots / format are runtime expressions on the ONE line
                // chart; grid stays on (the design norm) and the pinned y-domain
                // rides the reactive aside chart where it belongs.
                const yFormat = $.let(compactFmt.ifElse(_$ => Chart.format.currency({ compact: true }), _$ => Chart.format.number()));
                const preview = $.let(
                    <Chart layers={Chart.Line(rows, { x: r => r.month, y: r => r.sales }, { curve, dots, color: "teal.solid", width: 2 })} y={{ format: yFormat }} grid tooltip />,
                );

                // The aside is the old `interactiveValue` isolate: the Q4 column is
                // sourced from reactive State (same `chart_peak` key), proving
                // expression-valued data.
                const peakRows = $.const([
                    { q: "Q1", v: 40n }, { q: "Q2", v: 65n }, { q: "Q3", v: 55n }, { q: "Q4", v: peakVal },
                ], ArrayType(StructType({ q: StringType, v: IntegerType })));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Curve", curveKey,
                                <Select value={curveKey} onChange={onCurve} size="sm"
                                    items={curves.map((_$, v) => Select.Item(v.getTag(), v.getTag()))} />),
                            // A Slot, not a Control: the switches report as the spec
                            // rows below rather than as one value.
                            Configurator.Slot("Marks",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={dots} label="Points" onChange={onPoints} />
                                </HStack>),
                            Configurator.Slot("Axes",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={compactFmt} label="Compact currency" onChange={onFormat} />
                                </HStack>),
                        ]}
                        preview={<Box height="260px" width="100%">{preview}</Box>}
                        aside={{
                            label: "Peak · Reactive",
                            body: (
                                <VStack gap="3" align="stretch">
                                    <Box height="260px" width="100%">
                                        <Chart layers={Chart.Column(peakRows, { x: r => r.q, y: r => r.v }, { color: "teal.solid" })} y={{ domain: [0, 160] }} />
                                    </Box>
                                    <HStack gap="3" align="center" wrap="wrap">
                                        <Text.MonoLabel>{East.str`Q4 · ${East.print(peakVal)}`}</Text.MonoLabel>
                                        <Button size="xs" onClick={bump}>Bump Q4</Button>
                                    </HStack>
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Points", dots.ifElse(_$ => "on", _$ => "off")),
                            Configurator.Spec("Tick format", compactFmt.ifElse(_$ => "compact currency", _$ => "number")),
                            Configurator.Spec("Aside domain", "0 – 160 pinned"),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// Column + Bar (#249 split) — each series grammar is a build-time encoding,
// so each is its own single-instance example.
// ============================================================================

/** Grouped multi-series columns with an explicit colour map. */
export const columnGrouped = example({
    keywords: ["Chart", "Column", "vertical", "grouped", "columns", "multi-series", "colors", "custom", "palette", "legend", "grid"],
    description: "Grouped columns — two series per region with an explicit colour map",
    fn: East.function([], UIComponentType, ($) => {
        const COLUMN_GROUPED_DATA = [
            { region: "NA", a: 40n, b: 30n }, { region: "EU", a: 55n, b: 45n }, { region: "APAC", a: 30n, b: 60n },
        ];
        const rows = $.const(COLUMN_GROUPED_DATA, ArrayType(StructType({ region: StringType, a: IntegerType, b: IntegerType })));
        return (
            <Box height="260px" width="100%">
                <Chart layers={Chart.Column(rows, { x: r => r.region, columns: { Product: r => r.a, Service: r => r.b }, colors: { Product: "purple.solid", Service: "orange.solid" } })} legend grid />
            </Box>
        );
    }),
    inputs: [],
});

/** Stacked columns — two series share one stack key. */
export const columnStacked = example({
    keywords: ["Chart", "Column", "stacked", "stack", "columns", "multi-series", "legend", "grid"],
    description: "Stacked columns — mobile and desktop traffic share one stack",
    fn: East.function([], UIComponentType, ($) => {
        const COLUMN_STACKED_DATA = [
            { week: "W1", mobile: 50n, desktop: 100n }, { week: "W2", mobile: 70n, desktop: 120n },
            { week: "W3", mobile: 60n, desktop: 110n },
        ];
        const rows = $.const(COLUMN_STACKED_DATA, ArrayType(StructType({ week: StringType, mobile: IntegerType, desktop: IntegerType })));
        return (
            <Box height="260px" width="100%">
                <Chart layers={Chart.Column(rows, { x: r => r.week, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop } }, { stack: "traffic" })} legend grid />
            </Box>
        );
    }),
    inputs: [],
});

/** Percent-stacked columns — stackOffset expand + a percent axis format. */
export const columnPercent = example({
    keywords: ["Chart", "Column", "stack", "stackOffset", "expand", "percent", "breakdown", "by", "legend"],
    description: "Percent-stacked columns — stackOffset expand normalises the mix to 100%",
    fn: East.function([], UIComponentType, ($) => {
        const COLUMN_PERCENT_STACKED_DATA = [
            { week: "W1", channel: "Search", spend: 40n }, { week: "W1", channel: "Social", spend: 60n },
            { week: "W2", channel: "Search", spend: 55n }, { week: "W2", channel: "Social", spend: 45n },
        ];
        const rows = $.const(COLUMN_PERCENT_STACKED_DATA, ArrayType(StructType({ week: StringType, channel: StringType, spend: IntegerType })));
        return (
            <Box height="260px" width="100%">
                <Chart layers={Chart.Column(rows, { x: r => r.week, y: r => r.spend, by: r => r.channel }, { stack: "mix" })} stackOffset="expand" y={{ format: Chart.format.percent() }} legend />
            </Box>
        );
    }),
    inputs: [],
});

/** Horizontal Bar — ranked categorical-y with stacked shifts and tooltip. */
export const barStacked = example({
    keywords: ["Chart", "Bar", "horizontal", "ranked", "categorical-y", "long-labels", "stacked", "stack", "by", "tooltip", "legend", "grid"],
    description: "Stacked horizontal bars — sites ranked on the categorical y-axis, day/night shifts stacked",
    fn: East.function([], UIComponentType, ($) => {
        const BAR_STACKED_DATA = [
            { site: "North", shift: "Day", tonnes: 120n }, { site: "North", shift: "Night", tonnes: 80n },
            { site: "South", shift: "Day", tonnes: 95n }, { site: "South", shift: "Night", tonnes: 110n },
            { site: "West", shift: "Day", tonnes: 60n }, { site: "West", shift: "Night", tonnes: 45n },
        ];
        const rows = $.const(BAR_STACKED_DATA, ArrayType(StructType({ site: StringType, shift: StringType, tonnes: IntegerType })));
        return (
            <Box height="260px" width="100%">
                <Chart layers={Chart.Bar(rows, { x: r => r.tonnes, y: r => r.site, by: r => r.shift }, { stack: "tonnage" })} legend tooltip grid />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Area / Band / Scatter — each mark contract is its own single instance.
// ============================================================================

/** Stacked areas — two series share one stack with a soft fill. */
export const areaStacked = example({
    keywords: ["Chart", "Area", "stacked", "stack", "fillOpacity", "columns", "legend", "grid"],
    description: "Stacked areas — mobile and desktop traffic share one stack with a soft fill",
    fn: East.function([], UIComponentType, ($) => {
        const AREA_STACKED_DATA = [
            { month: "Jan", mobile: 50n, desktop: 100n }, { month: "Feb", mobile: 70n, desktop: 120n },
            { month: "Mar", mobile: 60n, desktop: 110n }, { month: "Apr", mobile: 90n, desktop: 140n },
        ];
        const rows = $.const(AREA_STACKED_DATA, ArrayType(StructType({ month: StringType, mobile: IntegerType, desktop: IntegerType })));
        return (
            <Box height="280px" width="100%">
                <Chart layers={Chart.Area(rows, { x: r => r.month, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop } }, { stack: "traffic", fillOpacity: 0.5 })} legend grid />
            </Box>
        );
    }),
    inputs: [],
});

/** Band — an area-range confidence band under its value line. */
export const bandConfidence = example({
    keywords: ["Chart", "Band", "area-range", "confidence", "low", "high", "Line", "legend", "tooltip", "grid"],
    description: "Confidence band — Chart.Band low/high under the value line",
    fn: East.function([], UIComponentType, ($) => {
        const AREA_CONFIDENCE_BAND_DATA = [
            { day: "Mon", value: 100n, lo: 80n, hi: 120n }, { day: "Tue", value: 150n, lo: 130n, hi: 170n },
            { day: "Wed", value: 130n, lo: 110n, hi: 150n }, { day: "Thu", value: 180n, lo: 160n, hi: 200n },
        ];
        const rows = $.const(AREA_CONFIDENCE_BAND_DATA, ArrayType(StructType({ day: StringType, value: IntegerType, lo: IntegerType, hi: IntegerType })));
        return (
            <Box height="280px" width="100%">
                <Chart layers={[
                    Chart.Band(rows, { x: r => r.day, low: r => r.lo, high: r => r.hi }, { key: "Range", color: "link", fillOpacity: 0.3 }),
                    Chart.Line(rows, { x: r => r.day, y: r => r.value }, { key: "Value", color: "blue.solid", width: 2 }),
                ]} legend tooltip grid />
            </Box>
        );
    }),
    inputs: [],
});

/** Quadrant scatter — two series with pinned domains and refLine cross-hairs. */
export const scatterQuadrants = example({
    keywords: ["Chart", "Scatter", "domain", "reference", "refLine", "quadrant", "linear", "legend"],
    description: "Quadrant scatter — pinned 0–100 domains with refLine cross-hairs at 50",
    fn: East.function([], UIComponentType, ($) => {
        const SCATTER_QUADRANTS_DATA = [
            { effort: 10.0, value: 80.0, baseline: 20.0 }, { effort: 35.0, value: 55.0, baseline: 60.0 },
            { effort: 70.0, value: 30.0, baseline: 90.0 },
        ];
        const rows = $.const(SCATTER_QUADRANTS_DATA, ArrayType(StructType({ effort: FloatType, value: FloatType, baseline: FloatType })));
        return (
            <Box height="280px" width="100%">
                <Chart layers={[
                    Chart.Scatter(rows, { x: r => r.effort, columns: { Value: r => r.value, Baseline: r => r.baseline } }, { size: 6 }),
                    Chart.refLine({ x: 50, dash: "3 3" }),
                    Chart.refLine({ y: 50, dash: "3 3" }),
                ]} x={{ label: "Effort", scale: "linear", domain: [0, 100] }} y={{ label: "Value", domain: [0, 100] }} legend />
            </Box>
        );
    }),
    inputs: [],
});

/** Bubble scatter — per-point size encodes a third measure. */
export const scatterBubble = example({
    keywords: ["Chart", "Scatter", "size", "bubble", "per-point", "grid"],
    description: "Bubble scatter — per-point size encodes population",
    fn: East.function([], UIComponentType, ($) => {
        const SCATTER_BUBBLE_DATA = [
            { gdp: 1.2, life: 62.0, pop: 1400.0 }, { gdp: 4.5, life: 78.0, pop: 330.0 },
            { gdp: 2.1, life: 70.0, pop: 210.0 }, { gdp: 5.8, life: 82.0, pop: 125.0 },
        ];
        const rows = $.const(SCATTER_BUBBLE_DATA, ArrayType(StructType({ gdp: FloatType, life: FloatType, pop: FloatType })));
        return (
            <Box height="280px" width="100%">
                <Chart layers={Chart.Scatter(rows, { x: r => r.gdp, y: r => r.life, size: r => r.pop })} x={{ label: "GDP per capita" }} y={{ label: "Life expectancy" }} grid />
            </Box>
        );
    }),
    inputs: [],
});

// ============================================================================
// Composed — each preset is one multi-layer chart.
// ============================================================================

/** Column + Line mixed marks on one chart. */
export const composedColumnLine = example({
    keywords: ["Chart", "Composed", "column", "line", "mixed-marks", "legend", "tooltip", "grid"],
    description: "Composed marks — revenue columns under a dotted profit line",
    fn: East.function([], UIComponentType, ($) => {
        const COMPOSED_COLUMN_LINE_DATA = [
            { month: "Jan", revenue: 186n, profit: 80n }, { month: "Feb", revenue: 305n, profit: 120n },
            { month: "Mar", revenue: 237n, profit: 95n }, { month: "Apr", revenue: 273n, profit: 150n },
        ];
        const rows = $.const(COMPOSED_COLUMN_LINE_DATA, ArrayType(StructType({ month: StringType, revenue: IntegerType, profit: IntegerType })));
        return (
            <Box height="300px" width="100%">
                <Chart layers={[
                    Chart.Column(rows, { x: r => r.month, y: r => r.revenue }, { key: "Revenue", color: "teal.solid" }),
                    Chart.Line(rows, { x: r => r.month, y: r => r.profit }, { key: "Profit", color: "purple.solid", dots: true }),
                ]} legend tooltip grid />
            </Box>
        );
    }),
    inputs: [],
});

/** Dual-axis forecast — Area + Band + right-axis trend + capacity refLine. */
export const composedDualAxis = example({
    keywords: ["Chart", "Composed", "dual-axis", "axis", "y2", "Area", "Band", "Line", "refLine", "stack", "forecast"],
    description: "Dual-axis forecast — stacked areas + confidence band with a right-axis trend and capacity refLine",
    fn: East.function([], UIComponentType, ($) => {
        const COMPOSED_DUAL_AXIS_FORECAST_DATA = [
            { month: "Jan", mobile: 50n, desktop: 100n, lo: 130n, hi: 170n, trend: 150n },
            { month: "Feb", mobile: 70n, desktop: 120n, lo: 165n, hi: 215n, trend: 190n },
            { month: "Mar", mobile: 60n, desktop: 110n, lo: 150n, hi: 200n, trend: 175n },
            { month: "Apr", mobile: 90n, desktop: 140n, lo: 205n, hi: 265n, trend: 235n },
        ];
        const rows = $.const(COMPOSED_DUAL_AXIS_FORECAST_DATA, ArrayType(StructType({
            month: StringType, mobile: IntegerType, desktop: IntegerType, lo: IntegerType, hi: IntegerType, trend: IntegerType,
        })));
        return (
            <Box height="300px" width="100%">
                <Chart
                    layers={[
                        Chart.Area(rows, { x: r => r.month, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop } }, { stack: "traffic", fillOpacity: 0.5 }),
                        Chart.Band(rows, { x: r => r.month, low: r => r.lo, high: r => r.hi }, { key: "Confidence", color: "link", fillOpacity: 0.3 }),
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

/** Reference annotations — refBand, refLine and refDot around one line. */
export const composedAnnotations = example({
    keywords: ["Chart", "reference", "refLine", "refBand", "refDot", "annotation", "grid"],
    description: "Reference annotations — a normal band, target line and peak dot around one series",
    fn: East.function([], UIComponentType, ($) => {
        const REFERENCE_ANNOTATIONS_DATA = [
            { month: "Jan", value: 100n }, { month: "Feb", value: 150n },
            { month: "Mar", value: 237n }, { month: "Apr", value: 180n },
        ];
        const rows = $.const(REFERENCE_ANNOTATIONS_DATA, ArrayType(StructType({ month: StringType, value: IntegerType })));
        return (
            <Box height="300px" width="100%">
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
// Behavioral isolates
// ============================================================================

export const tooltipOverStickyTable = example({
    keywords: ["Chart", "tooltip", "zIndex", "z-index", "sticky", "stickyHeader", "Table", "header", "overlay", "layering", "portal"],
    description: "Chart hover tooltip layers ABOVE a sibling Table's sticky column header — hover the line near the BOTTOM of the chart so the tooltip overlaps the header row directly below it. The tooltip's z-index must sit on its own positioned content (the visx portal wrapper is position:static, so its z-index is ignored) or the sticky header (z-index 2) paints over it.",
    fn: East.function([], UIComponentType, ($) => {
        const TOOLTIP_TABLE_ROWS = Array.from({ length: 14 }, (_, i) => ({
            id: `SKU-${String(i + 1).padStart(3, "0")}`,
            region: (["North", "South", "East", "West"] as const)[i % 4]!,
            value: BigInt(600 + i * 73),
        }));
        const chartRows = $.const([
            { month: "Jan", sales: 100n }, { month: "Feb", sales: 150n }, { month: "Mar", sales: 120n },
            { month: "Apr", sales: 180n }, { month: "May", sales: 140n }, { month: "Jun", sales: 170n },
        ], ArrayType(StructType({ month: StringType, sales: IntegerType })));
        const tableRows = $.const(TOOLTIP_TABLE_ROWS, ArrayType(StructType({ id: StringType, region: StringType, value: IntegerType })));
        return (
            <VStack gap="0" align="stretch" width="100%">
                <Box height="260px" width="100%">
                    <Chart layers={Chart.Line(chartRows, { x: r => r.month, y: r => r.sales }, { color: "teal.solid" })} grid tooltip />
                </Box>
                <Table data={tableRows} columns={["id", "region", "value"]} height="150px" stickyHeader />
            </VStack>
        );
    }),
    inputs: [],
});
