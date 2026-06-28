/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { IntegerType, StringType, StructType, ArrayType, FloatType } from "@elaraai/east";
import { Chart } from "@elaraai/east-ui/internal";
import * as ex from "./chart.examples.js";

describeEast("Chart", (test) => {
    Assert.examples(test, {
        lineBasic: ex.lineBasic,
        lineMultiColumns: ex.lineMultiColumns,
        lineBreakdown: ex.lineBreakdown,
        lineCurveNatural: ex.lineCurveNatural,
        lineStepNoDots: ex.lineStepNoDots,
        lineStepAfterSetpoint: ex.lineStepAfterSetpoint,
        lineDashedTargetOverlay: ex.lineDashedTargetOverlay,
        lineTemporal: ex.lineTemporal,
        lineNumericX: ex.lineNumericX,
        lineRuntimeDomain: ex.lineRuntimeDomain,
        lineRuntimeTimeDomain: ex.lineRuntimeTimeDomain,
        lineSampleFan: ex.lineSampleFan,
        barBasic: ex.barBasic,
        barPerCategory: ex.barPerCategory,
        barGrouped: ex.barGrouped,
        barStacked: ex.barStacked,
        barPercentStacked: ex.barPercentStacked,
        barCustomColors: ex.barCustomColors,
        areaStacked: ex.areaStacked,
        areaConfidenceBand: ex.areaConfidenceBand,
        scatterQuadrants: ex.scatterQuadrants,
        scatterBubble: ex.scatterBubble,
        composedBarLine: ex.composedBarLine,
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
            Chart.Bar(rows, { x: r => r.month, y: r => r.a }),
            Chart.Line(rows, { x: r => r.month, y: r => r.b }, { axis: "right" }),
        ], { y2: { label: "Secondary" } }));
        const frame = chart.unwrap().unwrap("VisxChart").unwrap().unwrap("frame");
        $(Assert.equal(frame.yScale2.hasTag("some"), true));
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
}, { platformFns: TestImpl });
