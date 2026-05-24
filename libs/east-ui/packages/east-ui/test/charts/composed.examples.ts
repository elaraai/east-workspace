/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Box, Button, Chart, Reactive, Stack, State, UIComponentType } from "@elaraai/east-ui";

export const composedBasic = example({
    keywords: ["Chart", "Composed", "bar", "line", "combo"],
    description: "Revenue as bars, profit as line",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { month: "Jan", revenue: 186n, profit: 80n },
                    { month: "Feb", revenue: 305n, profit: 120n },
                    { month: "Mar", revenue: 237n, profit: 95n },
                    { month: "Apr", revenue: 273n, profit: 150n },
                    { month: "May", revenue: 209n, profit: 110n },
                ],
                {
                    xAxis: { dataKey: "month" },
                    series: {
                        revenue: { type: "bar", color: "teal.solid" },
                        profit: { type: "line", color: "purple.solid", showDots: true },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedAllTypes = example({
    keywords: ["Chart", "Composed", "bar", "line", "area", "scatter"],
    description: "Bar, Line, Area, and Scatter in one chart",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { month: "Jan", bars: 186n, lines: 80n, areas: 150n, dots: 100n },
                    { month: "Feb", bars: 305n, lines: 120n, areas: 200n, dots: 150n },
                    { month: "Mar", bars: 237n, lines: 95n, areas: 180n, dots: 130n },
                    { month: "Apr", bars: 273n, lines: 150n, areas: 220n, dots: 160n },
                ],
                {
                    xAxis: { dataKey: "month" },
                    series: {
                        bars: { type: "bar", color: "teal.solid" },
                        areas: { type: "area", color: "blue.solid", fillOpacity: 0.3 },
                        lines: { type: "line", color: "purple.solid", showDots: true },
                        dots: { type: "scatter", color: "orange.solid" },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedConfidenceBand = example({
    keywords: ["Chart", "Composed", "area-range", "confidence", "uncertainty"],
    description: "Line with area-range for uncertainty bounds",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { day: "Mon", value: 100n, low: 80n, high: 120n },
                    { day: "Tue", value: 150n, low: 130n, high: 170n },
                    { day: "Wed", value: 130n, low: 110n, high: 150n },
                    { day: "Thu", value: 180n, low: 160n, high: 200n },
                    { day: "Fri", value: 160n, low: 140n, high: 180n },
                ],
                {
                    xAxis: { dataKey: "day" },
                    series: {
                        confidence: { type: "area-range", lowKey: "low", highKey: "high", color: "blue.200", fillOpacity: 0.3 },
                        value: { type: "line", color: "blue.solid", strokeWidth: 2n, showDots: true },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedStackedAreas = example({
    keywords: ["Chart", "Composed", "stackId", "area", "trend"],
    description: "Stacked area chart with trend line overlay",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { month: "Jan", mobile: 50n, desktop: 100n, trend: 130n },
                    { month: "Feb", mobile: 70n, desktop: 120n, trend: 160n },
                    { month: "Mar", mobile: 60n, desktop: 110n, trend: 145n },
                    { month: "Apr", mobile: 90n, desktop: 140n, trend: 200n },
                ],
                {
                    xAxis: { dataKey: "month" },
                    series: {
                        mobile: { type: "area", color: "teal.solid", fillOpacity: 0.5, stackId: "traffic" },
                        desktop: { type: "area", color: "blue.solid", fillOpacity: 0.5, stackId: "traffic" },
                        trend: { type: "line", color: "red.solid", strokeWidth: 2n, strokeDasharray: "5 5", showDots: false },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedStackedBars = example({
    keywords: ["Chart", "Composed", "stacked", "bar", "cumulative"],
    description: "Stacked bar chart with cumulative line",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { month: "Jan", productA: 100n, productB: 80n, total: 180n },
                    { month: "Feb", productA: 150n, productB: 100n, total: 250n },
                    { month: "Mar", productA: 120n, productB: 90n, total: 210n },
                    { month: "Apr", productA: 180n, productB: 120n, total: 300n },
                ],
                {
                    xAxis: { dataKey: "month" },
                    series: {
                        productA: { type: "bar", color: "teal.solid", stackId: "products" },
                        productB: { type: "bar", color: "purple.solid", stackId: "products" },
                        total: { type: "line", color: "orange.solid", strokeWidth: 3n, showDots: true },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedSparseData = example({
    keywords: ["Chart", "ComposedMulti", "sparse"],
    description: "Different data points per series using ComposedMulti",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.ComposedMulti(
                {
                    revenue: [
                        { month: "Jan", value: 186n },
                        { month: "Feb", value: 305n },
                        { month: "Mar", value: 237n },
                        { month: "Apr", value: 273n },
                    ],
                    profit: [
                        { month: "Jan", value: 80n },
                        { month: "Mar", value: 120n },
                        { month: "Apr", value: 150n },
                    ],
                },
                {
                    xAxis: { dataKey: "month" },
                    series: {
                        revenue: { type: "bar", dataKey: "value", color: "teal.solid" },
                        profit: { type: "line", dataKey: "value", color: "purple.solid", showDots: true },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedNaturalCurve = example({
    keywords: ["Chart", "Composed", "curveType", "natural", "smooth"],
    description: "Smooth natural interpolation for lines and areas",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { month: "Jan", area: 100n, line: 80n },
                    { month: "Feb", area: 150n, line: 120n },
                    { month: "Mar", area: 120n, line: 95n },
                    { month: "Apr", area: 180n, line: 150n },
                    { month: "May", area: 140n, line: 110n },
                ],
                {
                    xAxis: { dataKey: "month" },
                    series: {
                        area: { type: "area", color: "teal.solid", fillOpacity: 0.3 },
                        line: { type: "line", color: "purple.solid", showDots: true },
                    },
                    curveType: "natural",
                    grid: { show: true },
                    tooltip: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedDualYAxis = example({
    keywords: ["Chart", "Composed", "yAxis2", "yAxisId", "dual"],
    description: "Revenue bars (left) vs Growth rate line (right)",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { month: "Jan", revenue: 186n, growthRate: 5n },
                    { month: "Feb", revenue: 305n, growthRate: 12n },
                    { month: "Mar", revenue: 237n, growthRate: -8n },
                    { month: "Apr", revenue: 273n, growthRate: 15n },
                    { month: "May", revenue: 350n, growthRate: 28n },
                ],
                {
                    xAxis: { dataKey: "month" },
                    yAxis: { label: "Revenue ($K)" },
                    yAxis2: { label: "Growth (%)" },
                    series: {
                        revenue: { type: "bar", color: "teal.solid", yAxisId: "left" },
                        growthRate: { type: "line", color: "purple.solid", yAxisId: "right", showDots: true, strokeWidth: 2n },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedWithReference = example({
    keywords: ["Chart", "Composed", "referenceLines", "target"],
    description: "Target line across the chart",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { month: "Jan", actual: 186n, forecast: 150n },
                    { month: "Feb", actual: 305n, forecast: 200n },
                    { month: "Mar", actual: 237n, forecast: 180n },
                    { month: "Apr", actual: 273n, forecast: 220n },
                ],
                {
                    xAxis: { dataKey: "month" },
                    series: {
                        actual: { type: "bar", color: "teal.solid" },
                        forecast: { type: "area", color: "gray.200", fillOpacity: 0.5 },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                    referenceLines: [
                        { y: 200, stroke: "red", strokeDasharray: "5 5", label: "Target" }
                    ],
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedWithBrush = example({
    keywords: ["Chart", "Composed", "brush", "zoom"],
    description: "Drag to zoom/pan across data range",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { month: "Jan", revenue: 186n, profit: 80n },
                    { month: "Feb", revenue: 305n, profit: 120n },
                    { month: "Mar", revenue: 237n, profit: 95n },
                    { month: "Apr", revenue: 273n, profit: 150n },
                    { month: "May", revenue: 209n, profit: 110n },
                    { month: "Jun", revenue: 314n, profit: 165n },
                    { month: "Jul", revenue: 256n, profit: 130n },
                    { month: "Aug", revenue: 289n, profit: 145n },
                    { month: "Sep", revenue: 321n, profit: 170n },
                    { month: "Oct", revenue: 278n, profit: 140n },
                    { month: "Nov", revenue: 342n, profit: 180n },
                    { month: "Dec", revenue: 398n, profit: 210n },
                ],
                {
                    xAxis: { dataKey: "month" },
                    series: {
                        revenue: { type: "bar", color: "teal.solid" },
                        profit: { type: "line", color: "purple.solid", showDots: true },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                    brush: { dataKey: "month", height: 30n },
                }
            ),
        ], { height: "320px", width: "100%" });
    }),
    inputs: [],
});

export const composedPivotWithColors = example({
    keywords: ["Chart", "Composed", "pivot", "pivotColors"],
    description: "Long-format data with explicit pivotColors mapping",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { month: "Jan", region: "North", sales: 100n },
                    { month: "Jan", region: "South", sales: 80n },
                    { month: "Feb", region: "North", sales: 120n },
                    { month: "Feb", region: "South", sales: 90n },
                    { month: "Mar", region: "North", sales: 140n },
                    { month: "Mar", region: "South", sales: 110n },
                ],
                {
                    xAxis: { dataKey: "month" },
                    pivotKey: "region",
                    valueKey: "sales",
                    series: {
                        sales: {
                            type: "bar",
                            color: "blue.500",
                            pivotColors: new Map([
                                ["North", "blue.700"],
                                ["South", "teal.500"],
                            ]),
                        },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedPivotWithoutColors = example({
    keywords: ["Chart", "Composed", "pivot", "default color"],
    description: "Long-format data using default color for all series",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { month: "Jan", category: "A", value: 100n },
                    { month: "Jan", category: "B", value: 80n },
                    { month: "Jan", category: "C", value: 60n },
                    { month: "Feb", category: "A", value: 120n },
                    { month: "Feb", category: "B", value: 90n },
                    { month: "Feb", category: "C", value: 70n },
                ],
                {
                    xAxis: { dataKey: "month" },
                    pivotKey: "category",
                    valueKey: "value",
                    series: {
                        value: { type: "line", showDots: true },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedMultiPivotWithColors = example({
    keywords: ["Chart", "ComposedMulti", "pivot", "pivotColors"],
    description: "Multi-series with pivot within each record",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.ComposedMulti(
                {
                    revenue: [
                        { month: "Jan", region: "North", value: 100n },
                        { month: "Jan", region: "South", value: 80n },
                        { month: "Feb", region: "North", value: 120n },
                        { month: "Feb", region: "South", value: 95n },
                    ],
                    profit: [
                        { month: "Jan", region: "North", value: 40n },
                        { month: "Jan", region: "South", value: 30n },
                        { month: "Feb", region: "North", value: 50n },
                        { month: "Feb", region: "South", value: 40n },
                    ],
                },
                {
                    xAxis: { dataKey: "month" },
                    pivotKey: "region",
                    series: {
                        revenue: {
                            type: "bar",
                            dataKey: "value",
                            color: "teal.500",
                            layerIndex: 0n,
                            pivotColors: new Map([
                                ["North", "teal.700"],
                                ["South", "teal.300"],
                            ]),
                        },
                        profit: {
                            type: "line",
                            dataKey: "value",
                            color: "blue.500",
                            layerIndex: 1n,
                            showDots: true,
                            pivotColors: new Map([
                                ["North", "blue.700"],
                                ["South", "blue.300"],
                            ]),
                        },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedMultiPivotWithoutColors = example({
    keywords: ["Chart", "ComposedMulti", "pivot", "default"],
    description: "Multi-series pivot using default colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.ComposedMulti(
                {
                    actual: [
                        { month: "Jan", type: "Online", value: 50n },
                        { month: "Jan", type: "Store", value: 30n },
                        { month: "Feb", type: "Online", value: 60n },
                        { month: "Feb", type: "Store", value: 40n },
                    ],
                    forecast: [
                        { month: "Jan", type: "Online", value: 55n },
                        { month: "Jan", type: "Store", value: 35n },
                        { month: "Feb", type: "Online", value: 65n },
                        { month: "Feb", type: "Store", value: 45n },
                    ],
                },
                {
                    xAxis: { dataKey: "month" },
                    pivotKey: "type",
                    series: {
                        actual: { type: "bar", dataKey: "value" },
                        forecast: { type: "area", dataKey: "value", color: "orange.solid", fillOpacity: 0.3 },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedMultiDualAxisWithAreaRange = example({
    keywords: ["Chart", "ComposedMulti", "area-range", "scatter", "line", "dual axis"],
    description: "Line, scatter, and confidence band on dual y-axes",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.ComposedMulti(
                {
                    actual: [
                        { day: 1n, value: 100n },
                        { day: 2n, value: 150n },
                        { day: 3n, value: 130n },
                        { day: 4n, value: 180n },
                        { day: 5n, value: 160n },
                    ],
                    predicted: [
                        { day: 1n, value: 95n },
                        { day: 2n, value: 145n },
                        { day: 3n, value: 140n },
                        { day: 4n, value: 175n },
                        { day: 5n, value: 165n },
                    ],
                    confidence: [
                        { day: 1n, low: 80n, high: 110n },
                        { day: 2n, low: 130n, high: 160n },
                        { day: 3n, low: 120n, high: 160n },
                        { day: 4n, low: 155n, high: 195n },
                        { day: 5n, low: 145n, high: 185n },
                    ],
                    temperature: [
                        { day: 1n, value: 22n },
                        { day: 2n, value: 25n },
                        { day: 3n, value: 23n },
                        { day: 4n, value: 28n },
                        { day: 5n, value: 26n },
                    ],
                } as any,
                {
                    xAxis: { dataKey: "day", label: "Day" },
                    yAxis: { label: "Value" },
                    yAxis2: { label: "Temperature (°C)" },
                    series: {
                        confidence: { type: "area-range", lowKey: "low", highKey: "high", color: "blue.200", fillOpacity: 0.3, yAxisId: "left" },
                        actual: { type: "scatter", dataKey: "value", color: "blue.solid", yAxisId: "left" },
                        predicted: { type: "line", dataKey: "value", color: "purple.solid", showDots: true, yAxisId: "left" },
                        temperature: { type: "line", dataKey: "value", color: "orange.solid", showDots: true, yAxisId: "right" },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "300px", width: "100%" });
    }),
    inputs: [],
});

export const composedIntegerXAxis = example({
    keywords: ["Chart", "Composed", "xAxis", "integer", "numeric"],
    description: "Numeric integer x-axis — gaps at hours 1-2, 13-17 show proportional spacing",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { hour: 0n, temp: 8n, humidity: 85n },
                    { hour: 3n, temp: 6n, humidity: 90n },
                    { hour: 6n, temp: 7n, humidity: 88n },
                    { hour: 9n, temp: 15n, humidity: 65n },
                    { hour: 12n, temp: 22n, humidity: 45n },
                    { hour: 18n, temp: 18n, humidity: 55n },
                    { hour: 24n, temp: 10n, humidity: 80n },
                ],
                {
                    xAxis: { dataKey: "hour", label: "Hour" },
                    series: {
                        temp: { type: "bar", color: "teal.solid" },
                        humidity: { type: "line", color: "purple.solid", showDots: true },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedFloatXAxis = example({
    keywords: ["Chart", "Composed", "xAxis", "float", "continuous"],
    description: "Continuous float x-axis — non-uniform dose spacing shows proportional gaps",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { dose: 0.1, response: 2, control: 1 },
                    { dose: 0.25, response: 8, control: 3 },
                    { dose: 0.5, response: 25, control: 5 },
                    { dose: 1.0, response: 50, control: 8 },
                    { dose: 2.5, response: 80, control: 10 },
                    { dose: 5.0, response: 95, control: 12 },
                ],
                {
                    xAxis: { dataKey: "dose", label: "Dose (mg)" },
                    series: {
                        response: { type: "area", color: "blue.solid", fillOpacity: 0.3 },
                        control: { type: "line", color: "orange.solid", showDots: true },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedStringXAxis = example({
    keywords: ["Chart", "Composed", "xAxis", "string", "categorical"],
    description: "Categorical string x-axis — all categories equally spaced",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { region: "North", sales: 120, target: 100 },
                    { region: "South", sales: 200, target: 180 },
                    { region: "East", sales: 150, target: 160 },
                    { region: "West", sales: 180, target: 170 },
                    { region: "Central", sales: 95, target: 110 },
                ],
                {
                    xAxis: { dataKey: "region" },
                    series: {
                        sales: { type: "bar", color: "green.solid" },
                        target: { type: "line", color: "red.solid", showDots: true },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedAxisFormatting = example({
    keywords: ["Chart", "Composed", "TickFormat", "Date", "Currency"],
    description: "Custom tick formats for date (x-axis) and currency (y-axis)",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Composed(
                [
                    { date: new Date("2024-01-15"), revenue: 12500, target: 10000 },
                    { date: new Date("2024-02-15"), revenue: 15800, target: 13000 },
                    { date: new Date("2024-03-15"), revenue: 18200, target: 16000 },
                    { date: new Date("2024-04-15"), revenue: 16500, target: 17000 },
                    { date: new Date("2024-05-15"), revenue: 21000, target: 18000 },
                    { date: new Date("2024-06-15"), revenue: 24300, target: 20000 },
                ],
                {
                    xAxis: {
                        dataKey: "date",
                        tickFormat: Chart.TickFormat.Date({ format: "DD MMM" }),
                    },
                    yAxis: {
                        label: "Amount",
                        tickFormat: Chart.TickFormat.Currency({ currency: "USD", compact: "short" }),
                    },
                    series: {
                        revenue: { type: "bar", color: "teal.solid" },
                        target: { type: "line", color: "orange.solid" },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const composedInteractive = example({
    keywords: ["Chart", "Composed", "Reactive", "State", "interactive", "counter"],
    description: "Composed chart whose March profit is driven by a reactive counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "composed_counter", 0n));
            const value = $.let(counter.read());
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Box.Root([
                    Chart.Composed(
                        [
                            { month: "Jan", revenue: 186n, profit: 80n },
                            { month: "Feb", revenue: 305n, profit: 120n },
                            { month: "Mar", revenue: 237n, profit: value.multiply(15n).add(95n) },
                        ],
                        {
                            xAxis: { dataKey: "month" },
                            series: {
                                revenue: { type: "bar", color: "teal.solid" },
                                profit: { type: "line", color: "purple.solid", showDots: true },
                            },
                            grid: { show: true },
                        },
                    ),
                ], { height: "250px", width: "100%" }),
                Button.Root("Bump March profit", { onClick: inc }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
