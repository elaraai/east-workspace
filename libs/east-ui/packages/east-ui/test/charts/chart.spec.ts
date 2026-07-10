/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, IntegerType, StringType, StructType, ArrayType, FloatType, BooleanType } from "@elaraai/east";
import { Chart } from "@elaraai/east-ui/internal";
import * as ex from "./chart.examples.js";

describeEast("Chart", (test) => {
    Assert.examples(test, {
        lineBasic: ex.lineBasic,
        tooltipOverStickyTable: ex.tooltipOverStickyTable,
        columnStackedDiverging: ex.columnStackedDiverging,
        lineMultiColumns: ex.lineMultiColumns,
        lineBreakdown: ex.lineBreakdown,
        lineCurveNatural: ex.lineCurveNatural,
        lineStepNoDots: ex.lineStepNoDots,
        lineStepAfterSetpoint: ex.lineStepAfterSetpoint,
        lineDashedTargetOverlay: ex.lineDashedTargetOverlay,
        lineTemporal: ex.lineTemporal,
        lineNumericX: ex.lineNumericX,
        lineIntegerDayTicks: ex.lineIntegerDayTicks,
        lineRuntimeDomain: ex.lineRuntimeDomain,
        lineRuntimeTimeDomain: ex.lineRuntimeTimeDomain,
        axisTextStyled: ex.axisTextStyled,
        lineSampleFan: ex.lineSampleFan,
        columnBasic: ex.columnBasic,
        columnPerCategory: ex.columnPerCategory,
        columnGrouped: ex.columnGrouped,
        columnStacked: ex.columnStacked,
        columnPercentStacked: ex.columnPercentStacked,
        columnCustomColors: ex.columnCustomColors,
        barRanked: ex.barRanked,
        barGrouped: ex.barGrouped,
        barStacked: ex.barStacked,
        barPercentStacked: ex.barPercentStacked,
        areaStacked: ex.areaStacked,
        areaConfidenceBand: ex.areaConfidenceBand,
        scatterQuadrants: ex.scatterQuadrants,
        scatterBubble: ex.scatterBubble,
        composedColumnLine: ex.composedColumnLine,
        composedDualAxisForecast: ex.composedDualAxisForecast,
        referenceAnnotations: ex.referenceAnnotations,
        axisFormatting: ex.axisFormatting,
        interactiveValue: ex.interactiveValue,
    });

    // =========================================================================
    // Structure — Chart.Root assembles a VisxChart frame
    // =========================================================================

    test("Chart.Root wraps a VisxChart frame with the given height + inferred scale", $ => {
        const rows = $.const([
            { month: "Jan", sales: 100n }, { month: "Feb", sales: 150n },
        ], ArrayType(StructType({ month: StringType, sales: IntegerType })));
        const chart = $.let(Chart.Root(Chart.Line(rows, { x: r => r.month, y: r => r.sales }), { height: 200 }));
        const frame = chart.unwrap().unwrap("VisxChart").unwrap().unwrap("frame");
        $(Assert.equal(frame.height, 200.0));
        $(Assert.equal(frame.xScale.hasTag("band"), true));
    });

    test("a dual-axis chart enables the secondary y-scale", $ => {
        const rows = $.const([
            { month: "Jan", a: 10n, b: 100n }, { month: "Feb", a: 20n, b: 120n },
        ], ArrayType(StructType({ month: StringType, a: IntegerType, b: IntegerType })));
        const chart = $.let(Chart.Root([
            Chart.Column(rows, { x: r => r.month, y: r => r.a }),
            Chart.Line(rows, { x: r => r.month, y: r => r.b }, { axis: "right" }),
        ], { y2: { label: "Secondary" } }));
        const frame = chart.unwrap().unwrap("VisxChart").unwrap().unwrap("frame");
        $(Assert.equal(frame.yScale2.hasTag("some"), true));
    });

    test("axis tickStyle / titleStyle lower onto the axis nodes (#315)", $ => {
        const rows = $.const([
            { month: "Jan", sales: 100n }, { month: "Feb", sales: 150n },
        ], ArrayType(StructType({ month: StringType, sales: IntegerType })));
        const chart = $.let(Chart.Root(Chart.Line(rows, { x: r => r.month, y: r => r.sales }), {
            grid: false,
            x: { tickStyle: { fontSize: "12px", fontFamily: "sans", color: "fg.default" } },
            y: { label: "kL", titleStyle: { fontWeight: "semibold", letterSpacing: "0.02em" } },
        }));
        // grid: false + one layer ⇒ children = [series, axisBottom, axisLeft].
        const frame = $.const(chart.unwrap().unwrap("VisxChart").unwrap().unwrap("frame"));
        const xAxis = $.const(frame.children.get(1n).unwrap().unwrap("axisBottom"));
        const tick = $.const(xAxis.tickStyle.unwrap("some"));
        $(Assert.equal(tick.fontSize.unwrap("some"), "12px"));
        $(Assert.equal(tick.fontFamily.unwrap("some").hasTag("sans"), true));
        $(Assert.equal(tick.color.unwrap("some"), "fg.default"));
        $(Assert.equal(xAxis.titleStyle.hasTag("none"), true));
        const yAxis = $.const(frame.children.get(2n).unwrap().unwrap("axisLeft"));
        const title = $.const(yAxis.titleStyle.unwrap("some"));
        $(Assert.equal(title.fontWeight.unwrap("some").hasTag("semibold"), true));
        $(Assert.equal(title.letterSpacing.unwrap("some"), "0.02em"));
        $(Assert.equal(yAxis.tickStyle.hasTag("none"), true));
    });

    // =========================================================================
    // Per-line stroke opacity + per-layer legend / tooltip opt-out (issues #108, #117)
    // =========================================================================

    test("MarkStyle.opacity lowers to some(opacity) on the series node", $ => {
        const rows = $.const([
            { month: "Jan", sales: 100n }, { month: "Feb", sales: 150n },
        ], ArrayType(StructType({ month: StringType, sales: IntegerType })));
        const chart = $.let(Chart.Root(Chart.Line(rows, { x: r => r.month, y: r => r.sales }, { opacity: 0.2 }), { grid: false }));
        const series = $.const(chart.unwrap().unwrap("VisxChart").unwrap().unwrap("frame").children.get(0n).unwrap().unwrap("series"));
        $(Assert.equal(series.opacity.hasTag("some"), true));
        $(Assert.equal(series.opacity.unwrap("some"), 0.2));
        $(Assert.equal(series.legend.hasTag("none"), true));
    });

    test("MarkStyle.legend false lowers to some(false) on a by-split series node", $ => {
        const rows = $.const([
            { month: "Jan", os: "Mac", n: 10n }, { month: "Jan", os: "Linux", n: 120n },
            { month: "Feb", os: "Mac", n: 95n }, { month: "Feb", os: "Linux", n: 110n },
        ], ArrayType(StructType({ month: StringType, os: StringType, n: IntegerType })));
        const chart = $.let(Chart.Root(Chart.Line(rows, { x: r => r.month, y: r => r.n, by: r => r.os }, { legend: false }), { grid: false }));
        const series = $.const(chart.unwrap().unwrap("VisxChart").unwrap().unwrap("frame").children.get(0n).unwrap().unwrap("series"));
        $(Assert.equal(series.legend.hasTag("some"), true));
        $(Assert.equal(series.legend.unwrap("some"), false));
        $(Assert.equal(series.opacity.hasTag("none"), true));
    });

    test("MarkStyle.tooltip false lowers to some(false) on a by-split series node", $ => {
        const rows = $.const([
            { month: "Jan", os: "Mac", n: 10n }, { month: "Jan", os: "Linux", n: 120n },
            { month: "Feb", os: "Mac", n: 95n }, { month: "Feb", os: "Linux", n: 110n },
        ], ArrayType(StructType({ month: StringType, os: StringType, n: IntegerType })));
        const chart = $.let(Chart.Root(Chart.Line(rows, { x: r => r.month, y: r => r.n, by: r => r.os }, { tooltip: false }), { grid: false }));
        const series = $.const(chart.unwrap().unwrap("VisxChart").unwrap().unwrap("frame").children.get(0n).unwrap().unwrap("series"));
        $(Assert.equal(series.tooltip.hasTag("some"), true));
        $(Assert.equal(series.tooltip.unwrap("some"), false));
        // legend is a separate, untouched knob.
        $(Assert.equal(series.legend.hasTag("none"), true));
    });

    test("MarkStyle legend and tooltip are independent: legend false leaves tooltip none", $ => {
        const rows = $.const([
            { month: "Jan", os: "Mac", n: 10n }, { month: "Jan", os: "Linux", n: 120n },
            { month: "Feb", os: "Mac", n: 95n }, { month: "Feb", os: "Linux", n: 110n },
        ], ArrayType(StructType({ month: StringType, os: StringType, n: IntegerType })));
        const chart = $.let(Chart.Root(Chart.Line(rows, { x: r => r.month, y: r => r.n, by: r => r.os }, { legend: false }), { grid: false }));
        const series = $.const(chart.unwrap().unwrap("VisxChart").unwrap().unwrap("frame").children.get(0n).unwrap().unwrap("series"));
        $(Assert.equal(series.legend.unwrap("some"), false));
        $(Assert.equal(series.tooltip.hasTag("none"), true));
    });

    test("both legend and tooltip false lower to some(false) — the decoration-layer case", $ => {
        const rows = $.const([
            { t: 0n, sid: "s0", y: 10.0 }, { t: 1n, sid: "s0", y: 14.0 },
            { t: 0n, sid: "s1", y: 11.0 }, { t: 1n, sid: "s1", y: 9.0 },
        ], ArrayType(StructType({ t: IntegerType, sid: StringType, y: FloatType })));
        const chart = $.let(Chart.Root(Chart.Line(rows, { x: r => r.t, y: r => r.y, by: r => r.sid }, { opacity: 0.2, legend: false, tooltip: false }), { grid: false }));
        const series = $.const(chart.unwrap().unwrap("VisxChart").unwrap().unwrap("frame").children.get(0n).unwrap().unwrap("series"));
        $(Assert.equal(series.legend.unwrap("some"), false));
        $(Assert.equal(series.tooltip.unwrap("some"), false));
        $(Assert.equal(series.opacity.unwrap("some"), 0.2));
    });

    test("omitting opacity + legend + tooltip leaves all three fields none (backward compatible)", $ => {
        const rows = $.const([
            { month: "Jan", sales: 100n }, { month: "Feb", sales: 150n },
        ], ArrayType(StructType({ month: StringType, sales: IntegerType })));
        const chart = $.let(Chart.Root(Chart.Line(rows, { x: r => r.month, y: r => r.sales }), { grid: false }));
        const series = $.const(chart.unwrap().unwrap("VisxChart").unwrap().unwrap("frame").children.get(0n).unwrap().unwrap("series"));
        $(Assert.equal(series.opacity.hasTag("none"), true));
        $(Assert.equal(series.legend.hasTag("none"), true));
        $(Assert.equal(series.tooltip.hasTag("none"), true));
    });

    // =========================================================================
    // Horizontal bars — Chart.Bar (numeric x, categorical y) + Chart.Column (#249)
    // =========================================================================

    test("Chart.Bar flips the frame horizontal: linear xScale + band yScale", $ => {
        const rows = $.const([
            { site: "North", throughput: 120n }, { site: "South", throughput: 90n },
        ], ArrayType(StructType({ site: StringType, throughput: IntegerType })));
        const chart = $.let(Chart.Root(Chart.Bar(rows, { x: r => r.throughput, y: r => r.site })));
        const frame = $.const(chart.unwrap().unwrap("VisxChart").unwrap().unwrap("frame"));
        $(Assert.equal(frame.xScale.hasTag("linear"), true));
        $(Assert.equal(frame.yScale.hasTag("band"), true));
    });

    test("Chart.Column keeps the vertical frame: band xScale + linear yScale", $ => {
        const rows = $.const([
            { q: "Q1", revenue: 186n }, { q: "Q2", revenue: 305n },
        ], ArrayType(StructType({ q: StringType, revenue: IntegerType })));
        const chart = $.let(Chart.Root(Chart.Column(rows, { x: r => r.q, y: r => r.revenue })));
        const frame = $.const(chart.unwrap().unwrap("VisxChart").unwrap().unwrap("frame"));
        $(Assert.equal(frame.xScale.hasTag("band"), true));
        $(Assert.equal(frame.yScale.hasTag("linear"), true));
    });

    test("Chart.Bar pivots the category into the point's coordinate and the numeric x into its value", $ => {
        const rows = $.const([
            { site: "North", throughput: 120n },
        ], ArrayType(StructType({ site: StringType, throughput: IntegerType })));
        const chart = $.let(Chart.Root(Chart.Bar(rows, { x: r => r.throughput, y: r => r.site }), { grid: false }));
        const series = $.const(chart.unwrap().unwrap("VisxChart").unwrap().unwrap("frame").children.get(0n).unwrap().unwrap("series"));
        const point = $.const(series.data.get(0n).points.get(0n));
        $(Assert.equal(point.x.unwrap("category"), "North"));
        $(Assert.equal(point.value, 120.0));
        $(Assert.equal(series.mark.hasTag("bar"), true));
    });

    test("a horizontal columns encoding fans one series per named column over the y categories", $ => {
        const rows = $.const([
            { site: "North", loaded: 42n, empty: 18n }, { site: "South", loaded: 35n, empty: 25n },
        ], ArrayType(StructType({ site: StringType, loaded: IntegerType, empty: IntegerType })));
        const chart = $.let(Chart.Root(Chart.Bar(rows, { y: r => r.site, columns: { Loaded: r => r.loaded, Empty: r => r.empty } }), { grid: false }));
        const series = $.const(chart.unwrap().unwrap("VisxChart").unwrap().unwrap("frame").children.get(0n).unwrap().unwrap("series"));
        $(Assert.equal(series.data.length(), 2n));
        $(Assert.equal(series.data.get(0n).key, "Loaded"));
        $(Assert.equal(series.data.get(0n).points.get(1n).x.unwrap("category"), "South"));
        $(Assert.equal(series.data.get(1n).points.get(0n).value, 18.0));
    });

    // The orientation guards throw while the chart VALUE is being built (plain
    // JS), so the assertions capture the JS error and check it as East data.
    // The would-be chart is bound with `$.const` so a regression (no throw)
    // still leaves a tracked, well-formed test body.

    test("composing Chart.Bar with a vertical mark layer is a build-time error", $ => {
        const rows = $.const([
            { site: "North", v: 120n }, { site: "South", v: 90n },
        ], ArrayType(StructType({ site: StringType, v: IntegerType })));
        let msg = "";
        try {
            $.const(Chart.Root([
                Chart.Bar(rows, { x: r => r.v, y: r => r.site }),
                Chart.Line(rows, { x: r => r.site, y: r => r.v }),
            ]));
        } catch (e) { msg = (e as Error).message; }
        $(Assert.equal(East.value(msg.includes("one categorical axis"), BooleanType), true));
    });

    test("y2 with Chart.Bar is a build-time error", $ => {
        const rows = $.const([
            { site: "North", v: 120n },
        ], ArrayType(StructType({ site: StringType, v: IntegerType })));
        let msg = "";
        try {
            $.const(Chart.Root(Chart.Bar(rows, { x: r => r.v, y: r => r.site }), { y2: { label: "Trend" } }));
        } catch (e) { msg = (e as Error).message; }
        $(Assert.equal(East.value(msg.includes("y2"), BooleanType), true));
    });

    test("Chart.Bar with a numeric y is a build-time error pointing at Chart.Column", $ => {
        const rows = $.const([
            { site: "North", v: 120n },
        ], ArrayType(StructType({ site: StringType, v: IntegerType })));
        let msg = "";
        // Dodge the encoding types the way a plain-JS caller would (a vertical
        // encoding fed to Chart.Bar); the runtime guard still catches it.
        try {
            (Chart.Bar as typeof Chart.Column)(rows, { x: r => r.site, y: r => r.v });
        } catch (e) { msg = (e as Error).message; }
        $(Assert.equal(East.value(msg.includes("Chart.Column"), BooleanType), true));
    });

    test("a categorical y on a vertical mark is a build-time error pointing at Chart.Bar", $ => {
        const rows = $.const([
            { site: "North", v: 120n },
        ], ArrayType(StructType({ site: StringType, v: IntegerType })));
        let msg = "";
        try {
            (Chart.Line as typeof Chart.Bar)(rows, { x: r => r.v, y: r => r.site });
        } catch (e) { msg = (e as Error).message; }
        $(Assert.equal(East.value(msg.includes("Chart.Bar"), BooleanType), true));
    });
}, { platformFns: TestImpl });
