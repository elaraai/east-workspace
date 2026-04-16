/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, example } from "@elaraai/east";
import { Chart, Box, UIComponentType } from "../../src/index.js";

export const lineBasic = example({
    keywords: ["Chart", "Line", "basic", "single series"],
    description: "Single series line chart",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "January", sale: 10 },
                    { month: "February", sale: 95 },
                    { month: "March", sale: 87 },
                    { month: "April", sale: 120 },
                    { month: "May", sale: 150 },
                ],
                { sale: { color: "teal.solid" } },
                {
                    xAxis: { dataKey: "month" },
                    grid: { show: true },
                    tooltip: { show: true },
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const lineMultiSeries = example({
    keywords: ["Chart", "Line", "multi-series", "legend"],
    description: "Multiple data series",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "January", mac: 10, linux: 120 },
                    { month: "February", mac: 95, linux: 110 },
                    { month: "March", mac: 87, linux: 125 },
                    { month: "April", mac: 110, linux: 100 },
                ],
                {
                    mac: { color: "purple.solid" },
                    linux: { color: "blue.solid" },
                },
                {
                    xAxis: { dataKey: "month" },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const lineNatural = example({
    keywords: ["Chart", "Line", "curveType", "natural", "smooth"],
    description: "Smooth natural interpolation",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "Jan", sales: 100 },
                    { month: "Feb", sales: 150 },
                    { month: "Mar", sales: 120 },
                    { month: "Apr", sales: 180 },
                    { month: "May", sales: 140 },
                ],
                { sales: { color: "green.solid" } },
                {
                    xAxis: { dataKey: "month" },
                    curveType: "natural",
                    grid: { show: true },
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const lineStep = example({
    keywords: ["Chart", "Line", "curveType", "step"],
    description: "Stepped line interpolation",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "Jan", price: 100 },
                    { month: "Feb", price: 120 },
                    { month: "Mar", price: 115 },
                    { month: "Apr", price: 140 },
                    { month: "May", price: 135 },
                ],
                { price: { color: "orange.solid" } },
                {
                    xAxis: { dataKey: "month" },
                    curveType: "step",
                    grid: { show: true },
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const lineNoDots = example({
    keywords: ["Chart", "Line", "showDots", "strokeWidth"],
    description: "Clean line without data points",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "Jan", revenue: 186 },
                    { month: "Feb", revenue: 305 },
                    { month: "Mar", revenue: 237 },
                    { month: "Apr", revenue: 273 },
                    { month: "May", revenue: 209 },
                ],
                { revenue: { color: "teal.solid" } },
                {
                    xAxis: { dataKey: "month" },
                    showDots: false,
                    strokeWidth: 2n,
                    grid: { show: true },
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const lineThickLine = example({
    keywords: ["Chart", "Line", "strokeWidth", "thick"],
    description: "Thicker line for emphasis",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "Jan", value: 50 },
                    { month: "Feb", value: 80 },
                    { month: "Mar", value: 65 },
                    { month: "Apr", value: 95 },
                ],
                { value: { color: "pink.solid" } },
                {
                    xAxis: { dataKey: "month" },
                    strokeWidth: 4n,
                    showDots: true,
                    grid: { show: true },
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const lineSparseMultiSeries = example({
    keywords: ["Chart", "LineMulti", "sparse", "connectNulls"],
    description: "Separate arrays for each series (avoids null values)",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.LineMulti(
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
                    valueKey: "value",
                    series: {
                        revenue: { color: "teal.solid" },
                        profit: { color: "purple.solid" },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                    connectNulls: false,
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const linePerSeriesStyling = example({
    keywords: ["Chart", "Line", "strokeWidth", "strokeDasharray", "showDots", "per-series"],
    description: "Different strokeWidth, dashed lines, dots per series",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "Jan", actual: 100, target: 120, forecast: 110 },
                    { month: "Feb", actual: 150, target: 130, forecast: 140 },
                    { month: "Mar", actual: 130, target: 140, forecast: 145 },
                    { month: "Apr", actual: 180, target: 150, forecast: 160 },
                    { month: "May", actual: 160, target: 160, forecast: 170 },
                ],
                {
                    actual: {
                        color: "teal.solid",
                        strokeWidth: 3n,
                        showDots: true,
                    },
                    target: {
                        color: "red.solid",
                        strokeWidth: 2n,
                        strokeDasharray: "5 5",
                        showDots: false,
                    },
                    forecast: {
                        color: "purple.solid",
                        strokeWidth: 1n,
                        strokeDasharray: "2 2",
                        showDots: false,
                    },
                },
                {
                    xAxis: { dataKey: "month" },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const lineDotsOnly = example({
    keywords: ["Chart", "Line", "showLine", "scatter", "dots only"],
    description: "Hide lines per series for scatter-like appearance",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "Jan", revenue: 186, profit: 80 },
                    { month: "Feb", revenue: 305, profit: 120 },
                    { month: "Mar", revenue: 237, profit: 95 },
                    { month: "Apr", revenue: 273, profit: 150 },
                    { month: "May", revenue: 209, profit: 110 },
                ],
                {
                    revenue: {
                        color: "teal.solid",
                        showLine: false,
                        showDots: true,
                    },
                    profit: {
                        color: "orange.solid",
                        showLine: true,
                        showDots: true,
                        strokeWidth: 2n,
                    },
                },
                {
                    xAxis: { dataKey: "month" },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const lineWithBrush = example({
    keywords: ["Chart", "Line", "brush", "zoom"],
    description: "Drag to zoom/pan across data range",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "Jan", sales: 186 },
                    { month: "Feb", sales: 305 },
                    { month: "Mar", sales: 237 },
                    { month: "Apr", sales: 273 },
                    { month: "May", sales: 209 },
                    { month: "Jun", sales: 314 },
                    { month: "Jul", sales: 256 },
                    { month: "Aug", sales: 289 },
                    { month: "Sep", sales: 321 },
                    { month: "Oct", sales: 278 },
                    { month: "Nov", sales: 342 },
                    { month: "Dec", sales: 398 },
                ],
                { sales: { color: "teal.solid" } },
                {
                    xAxis: { dataKey: "month" },
                    grid: { show: true },
                    tooltip: { show: true },
                    brush: { dataKey: "month", height: 30n },
                }
            ),
        ], { height: "280px", width: "100%" });
    }),
    inputs: [],
});

export const lineWithBrushAndLabels = example({
    keywords: ["Chart", "Line", "brush", "yAxis", "label"],
    description: "Zoomable line chart with labeled axes",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "Jan", sales: 186 },
                    { month: "Feb", sales: 305 },
                    { month: "Mar", sales: 237 },
                    { month: "Apr", sales: 273 },
                    { month: "May", sales: 209 },
                    { month: "Jun", sales: 314 },
                    { month: "Jul", sales: 256 },
                    { month: "Aug", sales: 289 },
                    { month: "Sep", sales: 321 },
                    { month: "Oct", sales: 278 },
                    { month: "Nov", sales: 342 },
                    { month: "Dec", sales: 398 },
                ],
                { sales: { color: "teal.solid" } },
                {
                    xAxis: { dataKey: "month" },
                    yAxis: { label: "Monthly Sales ($)" },
                    grid: { show: true },
                    tooltip: { show: true },
                    brush: { dataKey: "month", height: 30n },
                }
            ),
        ], { height: "300px", width: "100%" });
    }),
    inputs: [],
});

export const lineWithReferenceLine = example({
    keywords: ["Chart", "Line", "referenceLines", "target"],
    description: "Horizontal target line at y=200",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "Jan", sales: 186 },
                    { month: "Feb", sales: 305 },
                    { month: "Mar", sales: 237 },
                    { month: "Apr", sales: 273 },
                    { month: "May", sales: 209 },
                ],
                { sales: { color: "teal.solid" } },
                {
                    xAxis: { dataKey: "month" },
                    grid: { show: true },
                    tooltip: { show: true },
                    referenceLines: [
                        { y: 200, stroke: "red", strokeDasharray: "5 5", label: "Target", labelPosition: "insideBottomRight" }
                    ],
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const lineWithReferenceArea = example({
    keywords: ["Chart", "Line", "referenceAreas"],
    description: "Highlight target zone between y=180 and y=280",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "Jan", sales: 186 },
                    { month: "Feb", sales: 305 },
                    { month: "Mar", sales: 237 },
                    { month: "Apr", sales: 273 },
                    { month: "May", sales: 209 },
                ],
                { sales: { color: "teal.solid" } },
                {
                    xAxis: { dataKey: "month" },
                    grid: { show: true },
                    tooltip: { show: true },
                    referenceAreas: [
                        { y1: 180, y2: 280, fill: "green", fillOpacity: 0.15, label: "Target Zone", labelPosition: "insideTopRight" }
                    ],
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const lineWithReferenceDot = example({
    keywords: ["Chart", "Line", "referenceDots", "highlight"],
    description: "Highlight max value point",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "Jan", sales: 186 },
                    { month: "Feb", sales: 305 },
                    { month: "Mar", sales: 237 },
                    { month: "Apr", sales: 273 },
                    { month: "May", sales: 209 },
                ],
                { sales: { color: "teal.solid" } },
                {
                    xAxis: { dataKey: "month" },
                    grid: { show: true },
                    tooltip: { show: true },
                    showDots: false,
                    referenceDots: [
                        { x: "Feb", y: 305, fill: "red", r: 8n, label: "Peak", labelPosition: "top" }
                    ],
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const lineDualYAxis = example({
    keywords: ["Chart", "Line", "yAxis2", "yAxisId", "dual axis"],
    description: "Revenue (left axis) vs Growth Rate % (right axis)",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "Jan", revenue: 186, growthRate: 5 },
                    { month: "Feb", revenue: 305, growthRate: 12 },
                    { month: "Mar", revenue: 237, growthRate: -8 },
                    { month: "Apr", revenue: 273, growthRate: 15 },
                    { month: "May", revenue: 350, growthRate: 28 },
                ],
                {
                    revenue: { color: "teal.solid", yAxisId: "left" },
                    growthRate: { color: "purple.solid", yAxisId: "right", strokeDasharray: "5 5" },
                },
                {
                    xAxis: { dataKey: "month" },
                    yAxis: { label: "Revenue ($)" },
                    yAxis2: { label: "Growth (%)" },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const linePivotWithColors = example({
    keywords: ["Chart", "Line", "pivot", "pivotColors", "pivotKey"],
    description: "Long-format data with explicit pivotColors mapping",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "Jan", region: "North", sales: 100 },
                    { month: "Jan", region: "South", sales: 80 },
                    { month: "Feb", region: "North", sales: 120 },
                    { month: "Feb", region: "South", sales: 90 },
                    { month: "Mar", region: "North", sales: 140 },
                    { month: "Mar", region: "South", sales: 110 },
                ],
                {
                    sales: {
                        color: "blue.500",
                        pivotColors: new Map([
                            ["North", "blue.700"],
                            ["South", "teal.500"],
                        ]),
                    },
                },
                {
                    xAxis: { dataKey: "month" },
                    pivotKey: "region",
                    valueKey: "sales",
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const linePivotWithoutColors = example({
    keywords: ["Chart", "Line", "pivot", "default color"],
    description: "Long-format data using default color for all series",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { month: "Jan", category: "A", value: 100 },
                    { month: "Jan", category: "B", value: 80 },
                    { month: "Jan", category: "C", value: 60 },
                    { month: "Feb", category: "A", value: 120 },
                    { month: "Feb", category: "B", value: 90 },
                    { month: "Feb", category: "C", value: 70 },
                ],
                {
                    value: { color: "purple.solid" },
                },
                {
                    xAxis: { dataKey: "month" },
                    pivotKey: "category",
                    valueKey: "value",
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const lineMultiPivotWithColors = example({
    keywords: ["Chart", "LineMulti", "pivot", "pivotColors"],
    description: "Multi-series with pivot within each record",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.LineMulti(
                {
                    q1: [
                        { month: "Jan", region: "North", value: 100n },
                        { month: "Jan", region: "South", value: 80n },
                        { month: "Feb", region: "North", value: 120n },
                        { month: "Feb", region: "South", value: 95n },
                    ],
                    q2: [
                        { month: "Jan", region: "North", value: 110n },
                        { month: "Jan", region: "South", value: 85n },
                        { month: "Feb", region: "North", value: 130n },
                        { month: "Feb", region: "South", value: 100n },
                    ],
                },
                {
                    xAxis: { dataKey: "month" },
                    valueKey: "value",
                    pivotKey: "region",
                    series: {
                        q1: {
                            color: "teal.500",
                            pivotColors: new Map([
                                ["North", "teal.700"],
                                ["South", "teal.300"],
                            ]),
                        },
                        q2: {
                            color: "blue.500",
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
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const lineMultiPivotWithoutColors = example({
    keywords: ["Chart", "LineMulti", "pivot", "default"],
    description: "Multi-series pivot using default colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.LineMulti(
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
                    valueKey: "value",
                    pivotKey: "type",
                    series: {
                        actual: {  },
                        forecast: { color: "orange.solid" },
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const lineAxisFormatting = example({
    keywords: ["Chart", "Line", "TickFormat", "Date", "Currency"],
    description: "Custom tick formats for date (x-axis) and currency (y-axis)",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { date: new Date("2024-01-15"), revenue: 12500 },
                    { date: new Date("2024-02-15"), revenue: 15800 },
                    { date: new Date("2024-03-15"), revenue: 18200 },
                    { date: new Date("2024-04-15"), revenue: 16500 },
                    { date: new Date("2024-05-15"), revenue: 21000 },
                    { date: new Date("2024-06-15"), revenue: 24300 },
                ],
                { revenue: { color: "teal.solid" } },
                {
                    xAxis: {
                        dataKey: "date",
                        tickFormat: Chart.TickFormat.Date({ format: "DD MMM" }),
                    },
                    yAxis: {
                        label: "Revenue",
                        tickFormat: Chart.TickFormat.Currency({ currency: "USD", compact: "short" }),
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const lineIntegerXAxis = example({
    keywords: ["Chart", "Line", "xAxis", "integer", "numeric"],
    description: "Numeric integer x-axis — gaps at hours 1-2, 13-17 show proportional spacing",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { hour: 0n, temp: 8, humidity: 85 },
                    { hour: 3n, temp: 6, humidity: 90 },
                    { hour: 6n, temp: 7, humidity: 88 },
                    { hour: 9n, temp: 15, humidity: 65 },
                    { hour: 12n, temp: 22, humidity: 45 },
                    { hour: 18n, temp: 18, humidity: 55 },
                    { hour: 24n, temp: 10, humidity: 80 },
                ],
                {
                    temp: { color: "teal.solid" },
                    humidity: { color: "purple.solid" },
                },
                {
                    xAxis: { dataKey: "hour", label: "Hour" },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const lineFloatXAxis = example({
    keywords: ["Chart", "Line", "xAxis", "float", "continuous"],
    description: "Continuous float x-axis — non-uniform dose spacing shows proportional gaps",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { dose: 0.1, response: 2, control: 1 },
                    { dose: 0.25, response: 8, control: 3 },
                    { dose: 0.5, response: 25, control: 5 },
                    { dose: 1.0, response: 50, control: 8 },
                    { dose: 2.5, response: 80, control: 10 },
                    { dose: 5.0, response: 95, control: 12 },
                ],
                {
                    response: { color: "blue.solid" },
                    control: { color: "orange.solid" },
                },
                {
                    xAxis: { dataKey: "dose", label: "Dose (mg)" },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const lineStringXAxis = example({
    keywords: ["Chart", "Line", "xAxis", "string", "categorical"],
    description: "Categorical string x-axis — all categories equally spaced",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Line(
                [
                    { region: "North", sales: 120, target: 100 },
                    { region: "South", sales: 200, target: 180 },
                    { region: "East", sales: 150, target: 160 },
                    { region: "West", sales: 180, target: 170 },
                    { region: "Central", sales: 95, target: 110 },
                ],
                {
                    sales: { color: "green.solid" },
                    target: { color: "red.solid" },
                },
                {
                    xAxis: { dataKey: "region" },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});
