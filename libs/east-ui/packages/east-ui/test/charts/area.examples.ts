/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Box, Button, Chart, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const areaBasic = example({
    keywords: ["Chart", "Area", "basic", "single series"],
    description: "Single series area chart",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
                [
                    { month: "Jan", revenue: 186 },
                    { month: "Feb", revenue: 305 },
                    { month: "Mar", revenue: 237 },
                    { month: "Apr", revenue: 273 },
                    { month: "May", revenue: 209 },
                ],
                {
                    revenue: { color: "teal.solid" },
                },
                {
                    xAxis: { dataKey: "month" },
                    grid: { show: true },
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const areaMultiSeries = example({
    keywords: ["Chart", "Area", "multi-series", "legend", "tooltip"],
    description: "Multiple data series overlaid",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
                [
                    { month: "Jan", windows: 186, mac: 80, linux: 120 },
                    { month: "Feb", windows: 165, mac: 95, linux: 110 },
                    { month: "Mar", windows: 190, mac: 87, linux: 125 },
                    { month: "Apr", windows: 175, mac: 92, linux: 115 },
                ],
                {
                    windows: { color: "teal.solid" },
                    mac: { color: "purple.solid" },
                    linux: { color: "blue.solid" },
                },
                {
                    xAxis: { dataKey: "month" },
                    legend: { show: true },
                    tooltip: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaStacked = example({
    keywords: ["Chart", "Area", "stacked", "stackId"],
    description: "Areas stacked on top of each other",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
                [
                    { month: "Jan", windows: 186, mac: 80, linux: 120 },
                    { month: "Feb", windows: 165, mac: 95, linux: 110 },
                    { month: "Mar", windows: 190, mac: 87, linux: 125 },
                ],
                {
                    windows: { color: "teal.solid", stackId: "a" },
                    mac: { color: "purple.solid", stackId: "a" },
                    linux: { color: "blue.solid", stackId: "a" },
                },
                {
                    xAxis: { dataKey: "month" },
                    stacked: true,
                    legend: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaPercentStacked = example({
    keywords: ["Chart", "Area", "stacked", "stackOffset", "expand", "percent"],
    description: "Proportional stacked area chart",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
                [
                    { month: "Jan", windows: 186, mac: 80, linux: 120 },
                    { month: "Feb", windows: 165, mac: 95, linux: 110 },
                    { month: "Mar", windows: 190, mac: 87, linux: 125 },
                ],
                {
                    windows: { color: "teal.solid", stackId: "a" },
                    mac: { color: "purple.solid", stackId: "a" },
                    linux: { color: "blue.solid", stackId: "a" },
                },
                {
                    xAxis: { dataKey: "month" },
                    yAxis: { tickFormat: "percent" },
                    stacked: true,
                    stackOffset: "expand",
                    legend: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaCurved = example({
    keywords: ["Chart", "Area", "curveType", "natural", "smooth"],
    description: "Smooth natural interpolation",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
                [
                    { month: "Jan", revenue: 180 },
                    { month: "Feb", revenue: 220 },
                    { month: "Mar", revenue: 190 },
                    { month: "Apr", revenue: 260 },
                    { month: "May", revenue: 230 },
                ],
                {
                    revenue: { color: "green.solid" },
                },
                {
                    xAxis: { dataKey: "month" },
                    curveType: "natural",
                    fillOpacity: 0.3,
                    grid: { show: true },
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const areaOpacity = example({
    keywords: ["Chart", "Area", "fillOpacity"],
    description: "Lower opacity for lighter fill",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
                [
                    { month: "Jan", sales: 100 },
                    { month: "Feb", sales: 150 },
                    { month: "Mar", sales: 120 },
                    { month: "Apr", sales: 180 },
                ],
                {
                    sales: { color: "blue.solid" },
                },
                {
                    xAxis: { dataKey: "month" },
                    fillOpacity: 0.2,
                    grid: { show: true },
                    tooltip: { show: true },
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const areaWithBrush = example({
    keywords: ["Chart", "Area", "brush", "zoom", "pan"],
    description: "Drag to zoom/pan across data range",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
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

export const areaSparseMultiSeries = example({
    keywords: ["Chart", "AreaMulti", "sparse", "connectNulls"],
    description: "Separate arrays for each series (avoids null values)",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.AreaMulti(
                {
                    windows: [
                        { month: "Jan", value: 186n },
                        { month: "Feb", value: 165n },
                        { month: "Mar", value: 190n },
                        { month: "Apr", value: 175n },
                    ],
                    mac: [
                        { month: "Jan", value: 80n },
                        { month: "Mar", value: 87n },
                        { month: "Apr", value: 92n },
                    ],
                },
                {
                    xAxis: { dataKey: "month" },
                    valueKey: "value",
                    series: {
                        windows: { color: "teal.solid" },
                        mac: { color: "purple.solid" },
                    },
                    connectNulls: true,
                    tooltip: { show: true },
                    legend: { show: true },
                    grid: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaWithBrushAndLabels = example({
    keywords: ["Chart", "Area", "brush", "yAxis", "label"],
    description: "Zoomable area chart with labeled axes",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
                [
                    { month: "Jan", revenue: 186 },
                    { month: "Feb", revenue: 305 },
                    { month: "Mar", revenue: 237 },
                    { month: "Apr", revenue: 273 },
                    { month: "May", revenue: 209 },
                    { month: "Jun", revenue: 314 },
                    { month: "Jul", revenue: 256 },
                    { month: "Aug", revenue: 289 },
                    { month: "Sep", revenue: 321 },
                    { month: "Oct", revenue: 278 },
                    { month: "Nov", revenue: 342 },
                    { month: "Dec", revenue: 398 },
                ],
                { revenue: { color: "teal.solid" } },
                {
                    xAxis: { dataKey: "month" },
                    yAxis: { label: "Revenue ($K)" },
                    grid: { show: true },
                    tooltip: { show: true },
                    brush: { dataKey: "month", height: 30n },
                }
            ),
        ], { height: "300px", width: "100%" });
    }),
    inputs: [],
});

export const areaWithReferenceLine = example({
    keywords: ["Chart", "Area", "referenceLines", "threshold"],
    description: "Horizontal threshold line at y=250",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
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
                    grid: { show: true },
                    tooltip: { show: true },
                    referenceLines: [
                        { y: 250, stroke: "red", strokeDasharray: "5 5", label: "Threshold", labelPosition: "insideBottomRight" }
                    ],
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaWithReferenceArea = example({
    keywords: ["Chart", "Area", "referenceAreas", "range"],
    description: "Highlight acceptable range between y=200 and y=280",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
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
                    grid: { show: true },
                    tooltip: { show: true },
                    referenceAreas: [
                        { y1: 200, y2: 280, fill: "blue", fillOpacity: 0.1, label: "Target Range", labelPosition: "insideTopRight" }
                    ],
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaDualYAxis = example({
    keywords: ["Chart", "Area", "dual axis", "yAxis2", "yAxisId"],
    description: "Revenue (left axis) vs Conversion Rate % (right axis)",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
                [
                    { month: "Jan", revenue: 186, conversionRate: 2.5 },
                    { month: "Feb", revenue: 305, conversionRate: 3.2 },
                    { month: "Mar", revenue: 237, conversionRate: 2.8 },
                    { month: "Apr", revenue: 273, conversionRate: 3.5 },
                    { month: "May", revenue: 350, conversionRate: 4.1 },
                ],
                {
                    revenue: { color: "teal.solid", yAxisId: "left" },
                    conversionRate: { color: "purple.solid", yAxisId: "right" },
                },
                {
                    xAxis: { dataKey: "month" },
                    yAxis: { label: "Revenue ($)" },
                    yAxis2: { label: "Conversion (%)" },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                    fillOpacity: 0.3,
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const areaRange = example({
    keywords: ["Chart", "AreaRange", "band", "low", "high"],
    description: "Temperature range showing low/high values as a band",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.AreaRange(
                [
                    { day: "Mon", low: 5, high: 15 },
                    { day: "Tue", low: 3, high: 12 },
                    { day: "Wed", low: 7, high: 18 },
                    { day: "Thu", low: 8, high: 20 },
                    { day: "Fri", low: 6, high: 16 },
                ],
                {
                    temperature: { lowKey: "low", highKey: "high", color: "teal.solid" },
                },
                {
                    xAxis: { dataKey: "day" },
                    grid: { show: true },
                    tooltip: { show: true },
                    fillOpacity: 0.4,
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaRangeMulti = example({
    keywords: ["Chart", "AreaRange", "multi-series", "overlaid"],
    description: "Temperature and humidity ranges overlaid",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.AreaRange(
                [
                    { day: "Mon", tempLow: 5, tempHigh: 15, humidLow: 40, humidHigh: 60 },
                    { day: "Tue", tempLow: 3, tempHigh: 12, humidLow: 45, humidHigh: 65 },
                    { day: "Wed", tempLow: 7, tempHigh: 18, humidLow: 35, humidHigh: 55 },
                    { day: "Thu", tempLow: 8, tempHigh: 20, humidLow: 30, humidHigh: 50 },
                    { day: "Fri", tempLow: 6, tempHigh: 16, humidLow: 38, humidHigh: 58 },
                ],
                {
                    temperature: { lowKey: "tempLow", highKey: "tempHigh", color: "teal.solid", label: "Temperature" },
                    humidity: { lowKey: "humidLow", highKey: "humidHigh", color: "blue.solid", label: "Humidity" },
                },
                {
                    xAxis: { dataKey: "day" },
                    legend: { show: true },
                    tooltip: { show: true },
                    curveType: "natural",
                    fillOpacity: 0.3,
                }
            ),
        ], { height: "240px", width: "100%" });
    }),
    inputs: [],
});

export const areaPivotWithColors = example({
    keywords: ["Chart", "Area", "pivot", "pivotColors", "pivotKey", "valueKey"],
    description: "Long-format data with explicit pivotColors mapping",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
                [
                    { month: "Jan", region: "North", revenue: 100 },
                    { month: "Jan", region: "South", revenue: 80 },
                    { month: "Feb", region: "North", revenue: 120 },
                    { month: "Feb", region: "South", revenue: 90 },
                    { month: "Mar", region: "North", revenue: 140 },
                    { month: "Mar", region: "South", revenue: 110 },
                ],
                {
                    revenue: {
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
                    valueKey: "revenue",
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                    fillOpacity: 0.4,
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaPivotWithoutColors = example({
    keywords: ["Chart", "Area", "pivot", "default color"],
    description: "Long-format data using default color for all series",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
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
                    fillOpacity: 0.3,
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaMultiPivotWithColors = example({
    keywords: ["Chart", "AreaMulti", "pivot", "pivotColors", "pivotKey"],
    description: "Multi-series with pivot within each record",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.AreaMulti(
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
                    fillOpacity: 0.3,
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaMultiPivotWithoutColors = example({
    keywords: ["Chart", "AreaMulti", "pivot", "default"],
    description: "Multi-series pivot using default colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.AreaMulti(
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
                    fillOpacity: 0.3,
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaStackedPivotSparse = example({
    keywords: ["Chart", "Area", "pivot", "stacked", "sparse"],
    description: "Stacked pivot where not all x-values have every pivot key — missing values filled with null",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
                [
                    { quarter: "Q1", region: "North", revenue: 100 },
                    { quarter: "Q1", region: "South", revenue: 80 },
                    { quarter: "Q1", region: "East", revenue: 60 },
                    { quarter: "Q2", region: "North", revenue: 120 },
                    { quarter: "Q2", region: "South", revenue: 90 },
                    { quarter: "Q3", region: "North", revenue: 140 },
                    { quarter: "Q3", region: "East", revenue: 75 },
                    { quarter: "Q4", region: "South", revenue: 110 },
                    { quarter: "Q4", region: "East", revenue: 85 },
                ],
                {
                    revenue: { color: "blue.500" },
                },
                {
                    xAxis: { dataKey: "quarter" },
                    pivotKey: "region",
                    valueKey: "revenue",
                    stacked: true,
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                    fillOpacity: 0.4,
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaBrushDateFormatting = example({
    keywords: ["Chart", "Area", "brush", "date", "tickFormat", "TickFormat"],
    description: "Brush handle values use the same date formatter as the x-axis",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
                [
                    { date: new Date("2024-01-15"), revenue: 12500 },
                    { date: new Date("2024-02-15"), revenue: 15800 },
                    { date: new Date("2024-03-15"), revenue: 18200 },
                    { date: new Date("2024-04-15"), revenue: 16500 },
                    { date: new Date("2024-05-15"), revenue: 21000 },
                    { date: new Date("2024-06-15"), revenue: 24300 },
                    { date: new Date("2024-07-15"), revenue: 19800 },
                    { date: new Date("2024-08-15"), revenue: 22100 },
                    { date: new Date("2024-09-15"), revenue: 26500 },
                    { date: new Date("2024-10-15"), revenue: 23400 },
                    { date: new Date("2024-11-15"), revenue: 28900 },
                    { date: new Date("2024-12-15"), revenue: 31200 },
                ],
                { revenue: { color: "teal.solid" } },
                {
                    xAxis: {
                        dataKey: "date",
                        tickFormat: Chart.TickFormat.Date({ format: "DD MMM" }),
                    },
                    yAxis: {
                        tickFormat: Chart.TickFormat.Currency({ currency: "USD", compact: "short" }),
                    },
                    grid: { show: true },
                    tooltip: { show: true },
                    brush: { dataKey: "date", height: 30n },
                    fillOpacity: 0.3,
                }
            ),
        ], { height: "300px", width: "100%" });
    }),
    inputs: [],
});

export const areaIntegerXAxis = example({
    keywords: ["Chart", "Area", "xAxis", "integer", "numeric"],
    description: "Numeric integer x-axis — gaps at hours 1-2, 13-17 show proportional spacing",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
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
                    fillOpacity: 0.3,
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaFloatXAxis = example({
    keywords: ["Chart", "Area", "xAxis", "float", "continuous"],
    description: "Continuous float x-axis — non-uniform dose spacing shows proportional gaps",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
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
                    fillOpacity: 0.3,
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaStringXAxis = example({
    keywords: ["Chart", "Area", "xAxis", "string", "categorical"],
    description: "Categorical string x-axis — all categories equally spaced",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
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
                    fillOpacity: 0.3,
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaAxisFormatting = example({
    keywords: ["Chart", "Area", "tickFormat", "Date", "Currency", "TickFormat"],
    description: "Custom tick formats for date (x-axis) and currency (y-axis)",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Area(
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
                    fillOpacity: 0.3,
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const areaInteractive = example({
    keywords: ["Chart", "Area", "Reactive", "State", "interactive", "counter"],
    description: "Area chart whose last data point is driven by a reactive counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "area_counter", 0n));
            const value = $.let(counter.read());
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Box.Root([
                    Chart.Area(
                        [
                            { month: "Jan", revenue: 186 },
                            { month: "Feb", revenue: 305 },
                            { month: "Mar", revenue: 237 },
                            { month: "Apr", revenue: 273 },
                            { month: "May", revenue: value.multiply(20).add(209) },
                        ],
                        { revenue: { color: "teal.solid" } },
                        { xAxis: { dataKey: "month" }, grid: { show: true } },
                    ),
                ], { height: "200px", width: "100%" }),
                Button.Root("Bump May value", { onClick: inc }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
