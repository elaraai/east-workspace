/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { IntegerType, StringType, StructType, ArrayType } from "@elaraai/east";
import { Chart } from "@elaraai/east-ui/internal";
import * as ex from "./chart.examples.js";

describeEast("Chart", (test) => {
    Assert.examples(test, {
        lineBasic: ex.lineBasic,
        lineMultiColumns: ex.lineMultiColumns,
        lineBreakdown: ex.lineBreakdown,
        lineCurveNatural: ex.lineCurveNatural,
        lineStepNoDots: ex.lineStepNoDots,
        lineDashedTargetOverlay: ex.lineDashedTargetOverlay,
        lineTemporal: ex.lineTemporal,
        lineNumericX: ex.lineNumericX,
        barBasic: ex.barBasic,
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
}, { platformFns: TestImpl });
