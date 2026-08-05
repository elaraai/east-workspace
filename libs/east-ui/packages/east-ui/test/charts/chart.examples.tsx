/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, FloatType, StringType, StructType, ArrayType, BooleanType, NullType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Chart, Configurator, HStack, Reactive, SegmentGroup, Switch, Table, Text, VStack } from "@elaraai/east-ui";

// Rows for the tooltip-over-sticky-header layering example (below).
const TOOLTIP_TABLE_ROWS = Array.from({ length: 14 }, (_, i) => ({
    id: `SKU-${String(i + 1).padStart(3, "0")}`,
    region: (["North", "South", "East", "West"] as const)[i % 4]!,
    value: BigInt(600 + i * 73),
}));

// ============================================================================
// Module-scope fixtures — one per configurator cell (consolidation epic #455).
// ============================================================================

const LINE_CURVE_NATURAL_DATA = [
    { month: "Jan", sales: 100n }, { month: "Feb", sales: 150n },
    { month: "Mar", sales: 120n }, { month: "Apr", sales: 180n },
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
    description: "Line chart configurator — curve and fill axes plus points, grid, tick-format and pinned-range switches driving one live chart; the aside's Q4 column tracks a reactive peak",
    fn: East.function([], UIComponentType, (_$) => {
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
                const fills = $.const(["line", "area"], ArrayType(StringType));

                const curveBind  = $.let(State.bind([StringType], "chart_curve", "natural"));
                const fillBind   = $.let(State.bind([StringType], "chart_fill", "line"));
                const pointsBind = $.let(State.bind([BooleanType], "chart_points", true));
                const gridBind   = $.let(State.bind([BooleanType], "chart_grid", true));
                const formatBind = $.let(State.bind([BooleanType], "chart_format", false));
                const rangeBind  = $.let(State.bind([BooleanType], "chart_range", false));
                const peak       = $.let(State.bind([IntegerType], "chart_peak", 90n));

                const curveKey   = $.let(curveBind.read());
                const fillKey    = $.let(fillBind.read());
                const dots       = $.let(pointsBind.read());
                const showGrid   = $.let(gridBind.read());
                const compactFmt = $.let(formatBind.read());
                const pinned     = $.let(rangeBind.read());
                const peakVal    = $.let(peak.read());

                const onCurve  = $.const(East.function([StringType], NullType, ($, next) => { $(curveBind.write(next)); }));
                const onFill   = $.const(East.function([StringType], NullType, ($, next) => { $(fillBind.write(next)); }));
                const onPoints = $.const(East.function([BooleanType], NullType, ($, next) => { $(pointsBind.write(next)); }));
                const onGrid   = $.const(East.function([BooleanType], NullType, ($, next) => { $(gridBind.write(next)); }));
                const onFormat = $.const(East.function([BooleanType], NullType, ($, next) => { $(formatBind.write(next)); }));
                const onRange  = $.const(East.function([BooleanType], NullType, ($, next) => { $(rangeBind.write(next)); }));
                const bump     = $.const(East.function([], NullType, $ => {
                    const cur = $.let(peak.read());
                    const next = $.let(cur.greater(140n).ifElse(_$ => 60n, _$ => cur.add(15n)));
                    $(peak.write(next));
                }));

                // Each selection is a lookup into the same array the control renders.
                const curve = $.let(curves.filter((_$, v) => v.getTag().equal(curveKey)).get(0n));
                // curve / dots / format are runtime expressions, so one subtree
                // serves every switch position; `grid` and the y-domain PRESENCE
                // are build-time, so those switches swap whole <Chart> subtrees.
                const yFormat = $.let(compactFmt.ifElse(_$ => Chart.format.currency({ compact: true }), _$ => Chart.format.number()));
                const isArea = $.let(fillKey.equal("area"));
                const preview = $.let(isArea.ifElse(
                    _$ => showGrid.ifElse(
                        _$ => pinned.ifElse(
                            _$ => <Chart layers={Chart.Area(rows, { x: r => r.month, y: r => r.sales }, { curve, dots, color: "teal.solid", fillOpacity: 0.35 })} y={{ domain: [0, 220], format: yFormat }} grid tooltip />,
                            _$ => <Chart layers={Chart.Area(rows, { x: r => r.month, y: r => r.sales }, { curve, dots, color: "teal.solid", fillOpacity: 0.35 })} y={{ format: yFormat }} grid tooltip />),
                        _$ => pinned.ifElse(
                            _$ => <Chart layers={Chart.Area(rows, { x: r => r.month, y: r => r.sales }, { curve, dots, color: "teal.solid", fillOpacity: 0.35 })} y={{ domain: [0, 220], format: yFormat }} tooltip />,
                            _$ => <Chart layers={Chart.Area(rows, { x: r => r.month, y: r => r.sales }, { curve, dots, color: "teal.solid", fillOpacity: 0.35 })} y={{ format: yFormat }} tooltip />)),
                    _$ => showGrid.ifElse(
                        _$ => pinned.ifElse(
                            _$ => <Chart layers={Chart.Line(rows, { x: r => r.month, y: r => r.sales }, { curve, dots, color: "teal.solid", width: 2 })} y={{ domain: [0, 220], format: yFormat }} grid tooltip />,
                            _$ => <Chart layers={Chart.Line(rows, { x: r => r.month, y: r => r.sales }, { curve, dots, color: "teal.solid", width: 2 })} y={{ format: yFormat }} grid tooltip />),
                        _$ => pinned.ifElse(
                            _$ => <Chart layers={Chart.Line(rows, { x: r => r.month, y: r => r.sales }, { curve, dots, color: "teal.solid", width: 2 })} y={{ domain: [0, 220], format: yFormat }} tooltip />,
                            _$ => <Chart layers={Chart.Line(rows, { x: r => r.month, y: r => r.sales }, { curve, dots, color: "teal.solid", width: 2 })} y={{ format: yFormat }} tooltip />))));

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
                                <SegmentGroup value={curveKey} onChange={onCurve} size="sm"
                                    items={curves.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Fill", fillKey,
                                <SegmentGroup value={fillKey} onChange={onFill} size="sm"
                                    items={fills.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switches report as the spec
                            // rows below rather than as one value.
                            Configurator.Slot("Marks",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={dots} label="Points" onChange={onPoints} />
                                </HStack>),
                            Configurator.Slot("Axes",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={showGrid} label="Grid" onChange={onGrid} />
                                    <Switch checked={compactFmt} label="Compact currency" onChange={onFormat} />
                                    <Switch checked={pinned} label="Pin y" onChange={onRange} />
                                </HStack>),
                        ]}
                        preview={<Box height="260px" width="100%">{preview}</Box>}
                        aside={{
                            label: "Peak · Reactive",
                            body: (
                                <VStack gap="3" align="stretch">
                                    <Box height="260px" width="100%">
                                        <Chart layers={Chart.Column(peakRows, { x: r => r.q, y: r => r.v }, { color: "teal.solid" })} />
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
                            Configurator.Spec("Grid", showGrid.ifElse(_$ => "on", _$ => "off")),
                            Configurator.Spec("Tick format", compactFmt.ifElse(_$ => "compact currency", _$ => "number")),
                            Configurator.Spec("Y domain", pinned.ifElse(_$ => "0 – 220", _$ => "auto")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// Column + Bar — live configurator; orientation swaps the whole subtree (#249)
// ============================================================================

export const columnBarVariants = example({
    keywords: ["Chart", "Column", "bar", "vertical", "single-series", "currency", "per-category", "colors", "composition", "grouped", "columns", "multi-series", "stacked", "stack", "stackOffset", "expand", "percent", "breakdown", "by", "custom", "palette", "negative", "diverging", "bidirectional", "refLine", "Bar", "horizontal", "ranked", "categorical-y", "long-labels", "AlignedStack", "plotGutter", "tooltip", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Column/Bar configurator — an orientation axis swaps the whole Column ↔ Bar subtree (#249 split), plus series (grouped / stacked / percent) and palette (theme / explicit colour map) axes",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const colGrouped = $.const(COLUMN_GROUPED_DATA, ArrayType(StructType({ region: StringType, a: IntegerType, b: IntegerType })));
                const colStacked = $.const(COLUMN_STACKED_DATA, ArrayType(StructType({ week: StringType, mobile: IntegerType, desktop: IntegerType })));
                const colPercent = $.const(COLUMN_PERCENT_STACKED_DATA, ArrayType(StructType({ week: StringType, channel: StringType, spend: IntegerType })));
                const barGrouped = $.const(BAR_GROUPED_DATA, ArrayType(StructType({ site: StringType, loaded: IntegerType, empty: IntegerType })));
                const barStacked = $.const(BAR_STACKED_DATA, ArrayType(StructType({ site: StringType, shift: StringType, tonnes: IntegerType })));
                const barPercent = $.const(BAR_PERCENT_STACKED_DATA, ArrayType(StructType({ week: StringType, channel: StringType, spend: IntegerType })));

                const orientations = $.const(["column", "bar"], ArrayType(StringType));
                const seriesKinds = $.const(["grouped", "stacked", "percent"], ArrayType(StringType));
                const palettes = $.const(["default", "custom"], ArrayType(StringType));

                const orientationBind = $.let(State.bind([StringType], "chart_orientation", "column"));
                const seriesBind      = $.let(State.bind([StringType], "chart_series", "grouped"));
                const paletteBind     = $.let(State.bind([StringType], "chart_palette", "default"));

                const oKey = $.let(orientationBind.read());
                const sKey = $.let(seriesBind.read());
                const pKey = $.let(paletteBind.read());

                const onOrientation = $.const(East.function([StringType], NullType, ($, next) => { $(orientationBind.write(next)); }));
                const onSeries      = $.const(East.function([StringType], NullType, ($, next) => { $(seriesBind.write(next)); }));
                const onPalette     = $.const(East.function([StringType], NullType, ($, next) => { $(paletteBind.write(next)); }));

                const isColumn = $.let(oKey.equal("column"));
                const custom = $.let(pKey.equal("custom"));

                // Orientation swaps the WHOLE component subtree — Column and Bar
                // are separate components since the #249 split — and the encoding
                // `colors` map is build-time, so the palette axis also swaps
                // subtrees; the lookup + ifElse picks one fully-built chart per
                // (orientation, series, palette) cell.
                const preview = $.let(isColumn.ifElse(
                    _$ => sKey.equal("grouped").ifElse(
                        _$ => custom.ifElse(
                            _$ => <Chart layers={Chart.Column(colGrouped, { x: r => r.region, columns: { Product: r => r.a, Service: r => r.b }, colors: { Product: "purple.solid", Service: "orange.solid" } })} legend grid />,
                            _$ => <Chart layers={Chart.Column(colGrouped, { x: r => r.region, columns: { Product: r => r.a, Service: r => r.b } })} legend grid />),
                        _$ => sKey.equal("stacked").ifElse(
                            _$ => custom.ifElse(
                                _$ => <Chart layers={Chart.Column(colStacked, { x: r => r.week, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop }, colors: { Mobile: "purple.solid", Desktop: "orange.solid" } }, { stack: "traffic" })} legend grid />,
                                _$ => <Chart layers={Chart.Column(colStacked, { x: r => r.week, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop } }, { stack: "traffic" })} legend grid />),
                            _$ => custom.ifElse(
                                _$ => <Chart layers={Chart.Column(colPercent, { x: r => r.week, y: r => r.spend, by: r => r.channel, colors: { Search: "blue.solid", Social: "orange.solid" } }, { stack: "mix" })} stackOffset="expand" y={{ format: Chart.format.percent() }} legend />,
                                _$ => <Chart layers={Chart.Column(colPercent, { x: r => r.week, y: r => r.spend, by: r => r.channel }, { stack: "mix" })} stackOffset="expand" y={{ format: Chart.format.percent() }} legend />))),
                    _$ => sKey.equal("grouped").ifElse(
                        _$ => custom.ifElse(
                            _$ => <Chart layers={Chart.Bar(barGrouped, { y: r => r.site, columns: { Loaded: r => r.loaded, Empty: r => r.empty }, colors: { Loaded: "purple.solid", Empty: "orange.solid" } })} legend grid />,
                            _$ => <Chart layers={Chart.Bar(barGrouped, { y: r => r.site, columns: { Loaded: r => r.loaded, Empty: r => r.empty } })} legend grid />),
                        _$ => sKey.equal("stacked").ifElse(
                            _$ => custom.ifElse(
                                _$ => <Chart layers={Chart.Bar(barStacked, { x: r => r.tonnes, y: r => r.site, by: r => r.shift, colors: { Day: "purple.solid", Night: "orange.solid" } }, { stack: "tonnage" })} legend tooltip grid />,
                                _$ => <Chart layers={Chart.Bar(barStacked, { x: r => r.tonnes, y: r => r.site, by: r => r.shift }, { stack: "tonnage" })} legend tooltip grid />),
                            _$ => custom.ifElse(
                                _$ => <Chart layers={Chart.Bar(barPercent, { x: r => r.spend, y: r => r.week, by: r => r.channel, colors: { Search: "blue.solid", Social: "orange.solid" } }, { stack: "mix" })} stackOffset="expand" x={{ format: Chart.format.percent() }} legend />,
                                _$ => <Chart layers={Chart.Bar(barPercent, { x: r => r.spend, y: r => r.week, by: r => r.channel }, { stack: "mix" })} stackOffset="expand" x={{ format: Chart.format.percent() }} legend />)))));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Orientation", oKey,
                                <SegmentGroup value={oKey} onChange={onOrientation} size="sm"
                                    items={orientations.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                            Configurator.Control("Series", sKey,
                                <SegmentGroup value={sKey} onChange={onSeries} size="sm"
                                    items={seriesKinds.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                            Configurator.Control("Palette", pKey,
                                <SegmentGroup value={pKey} onChange={onPalette} size="sm"
                                    items={palettes.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                        ]}
                        preview={<Box height="260px" width="100%">{preview}</Box>}
                        spec={[
                            Configurator.Spec("Component", isColumn.ifElse(_$ => "Chart.Column", _$ => "Chart.Bar")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// Area + Scatter — live configurator; the kind axis swaps the mark subtree
// ============================================================================

export const areaScatterVariants = example({
    keywords: ["Chart", "Area", "stacked", "stack", "fillOpacity", "columns", "Band", "area-range", "confidence", "low", "high", "Scatter", "domain", "reference", "refLine", "size", "bubble", "per-point", "area", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Area/Scatter configurator — one face axis: stacked areas, the Band confidence range, quadrant scatter with refLines, or per-point bubble sizes",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const areaRows = $.const(AREA_STACKED_DATA, ArrayType(StructType({ month: StringType, mobile: IntegerType, desktop: IntegerType })));
                const bandRows = $.const(AREA_CONFIDENCE_BAND_DATA, ArrayType(StructType({ day: StringType, value: IntegerType, lo: IntegerType, hi: IntegerType })));
                const quadRows = $.const(SCATTER_QUADRANTS_DATA, ArrayType(StructType({ effort: FloatType, value: FloatType, baseline: FloatType })));
                const bubbleRows = $.const(SCATTER_BUBBLE_DATA, ArrayType(StructType({ gdp: FloatType, life: FloatType, pop: FloatType })));

                const faces = $.const(["stacked", "band", "quadrants", "bubble"], ArrayType(StringType));

                const faceBind = $.let(State.bind([StringType], "chart_face", "stacked"));
                const fKey = $.let(faceBind.read());
                const onFace = $.const(East.function([StringType], NullType, ($, next) => { $(faceBind.write(next)); }));

                // Each face is a complete chart — stacked areas, the Band
                // confidence range, the quadrant scatter, per-point bubbles.
                const preview = $.let(fKey.equal("stacked").ifElse(
                    _$ => <Chart layers={Chart.Area(areaRows, { x: r => r.month, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop } }, { stack: "traffic", fillOpacity: 0.5 })} legend grid />,
                    _$ => fKey.equal("band").ifElse(
                        _$ => <Chart layers={[
                            Chart.Band(bandRows, { x: r => r.day, low: r => r.lo, high: r => r.hi }, { key: "Range", color: "link", fillOpacity: 0.3 }),
                            Chart.Line(bandRows, { x: r => r.day, y: r => r.value }, { key: "Value", color: "blue.solid", width: 2 }),
                        ]} legend tooltip grid />,
                        _$ => fKey.equal("bubble").ifElse(
                            _$ => <Chart layers={Chart.Scatter(bubbleRows, { x: r => r.gdp, y: r => r.life, size: r => r.pop })} x={{ label: "GDP per capita" }} y={{ label: "Life expectancy" }} grid />,
                            _$ => <Chart layers={[
                                Chart.Scatter(quadRows, { x: r => r.effort, columns: { Value: r => r.value, Baseline: r => r.baseline } }, { size: 6 }),
                                Chart.refLine({ x: 50, dash: "3 3" }),
                                Chart.refLine({ y: 50, dash: "3 3" }),
                            ]} x={{ label: "Effort", scale: "linear", domain: [0, 100] }} y={{ label: "Value", domain: [0, 100] }} legend />))));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Face", fKey,
                                <SegmentGroup value={fKey} onChange={onFace} size="sm"
                                    items={faces.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                        ]}
                        preview={<Box height="280px" width="100%">{preview}</Box>}
                        spec={[
                            Configurator.Spec("Mark", fKey.equal("bubble").or(_$ => fKey.equal("quadrants")).ifElse(_$ => "Chart.Scatter", _$ => fKey.equal("band").ifElse(_$ => "Chart.Band + Line", _$ => "Chart.Area"))),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// Composed — live configurator; the preset axis swaps whole layer sets
// ============================================================================

export const composedVariants = example({
    keywords: ["Chart", "Composed", "column", "bar", "line", "mixed-marks", "dual-axis", "axis", "y2", "band", "reference", "stack", "refLine", "refBand", "refDot", "annotation", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Composed chart configurator — a composition preset axis swaps whole layer sets: column + line, dual-axis forecast (Area + Band + right-axis trend), reference annotations",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                const columnLine = $.const(COMPOSED_COLUMN_LINE_DATA, ArrayType(StructType({ month: StringType, revenue: IntegerType, profit: IntegerType })));
                const forecast = $.const(COMPOSED_DUAL_AXIS_FORECAST_DATA, ArrayType(StructType({
                    month: StringType, mobile: IntegerType, desktop: IntegerType, lo: IntegerType, hi: IntegerType, trend: IntegerType,
                })));
                const annotations = $.const(REFERENCE_ANNOTATIONS_DATA, ArrayType(StructType({ month: StringType, value: IntegerType })));

                const compositions = $.const(["column-line", "dual-axis", "annotations"], ArrayType(StringType));

                const compositionBind = $.let(State.bind([StringType], "chart_composition", "column-line"));
                const cKey = $.let(compositionBind.read());
                const onComposition = $.const(East.function([StringType], NullType, ($, next) => { $(compositionBind.write(next)); }));

                // Each preset is a whole layer set — mixed marks, a dual-axis
                // forecast, or pure reference annotations — so the axis lookup +
                // ifElse swaps the entire chart subtree.
                const preview = $.let(cKey.equal("column-line").ifElse(
                    _$ => <Chart layers={[
                        Chart.Column(columnLine, { x: r => r.month, y: r => r.revenue }, { key: "Revenue", color: "teal.solid" }),
                        Chart.Line(columnLine, { x: r => r.month, y: r => r.profit }, { key: "Profit", color: "purple.solid", dots: true }),
                    ]} legend tooltip grid />,
                    _$ => cKey.equal("dual-axis").ifElse(
                        _$ => <Chart
                            layers={[
                                Chart.Area(forecast, { x: r => r.month, columns: { Mobile: r => r.mobile, Desktop: r => r.desktop } }, { stack: "traffic", fillOpacity: 0.5 }),
                                Chart.Band(forecast, { x: r => r.month, low: r => r.lo, high: r => r.hi }, { key: "Confidence", color: "link", fillOpacity: 0.3 }),
                                Chart.Line(forecast, { x: r => r.month, y: r => r.trend }, { key: "Trend", color: "red.solid", dash: "5 5", dots: false, axis: "right", order: 10 }),
                                Chart.refLine({ y: 200, label: "Capacity", dash: "4 4" }),
                            ]}
                            y={{ label: "Sessions" }}
                            y2={{ label: "Trend", format: Chart.format.compact() }}
                            legend
                            tooltip
                            grid
                        />,
                        _$ => <Chart layers={[
                            Chart.refBand({ y: [120, 200], label: "Normal" }),
                            Chart.Line(annotations, { x: r => r.month, y: r => r.value }, { color: "teal.solid" }),
                            Chart.refLine({ y: 220, label: "Target", dash: "4 4" }),
                            Chart.refDot({ x: "Mar", y: 237, label: "Peak" }),
                        ]} grid />)));

                const layersLabel = $.let(cKey.equal("column-line").ifElse(
                    _$ => "Column + Line",
                    _$ => cKey.equal("dual-axis").ifElse(
                        _$ => "Area + Band + right-axis Line + refLine",
                        _$ => "refBand + Line + refLine + refDot")));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Composition", cKey,
                                <SegmentGroup value={cKey} onChange={onComposition} size="sm"
                                    items={compositions.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                        ]}
                        preview={<Box height="300px" width="100%">{preview}</Box>}
                        spec={[
                            Configurator.Spec("Layers", layersLabel),
                        ]}
                    />
                );
            }}</Reactive>
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
