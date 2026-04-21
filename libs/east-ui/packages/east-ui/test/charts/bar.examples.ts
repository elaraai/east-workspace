/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Box, Button, Chart, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const barBasic = example({
    keywords: ["Chart", "Bar", "basic", "vertical"],
    description: "Vertical bars showing allocation",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
                [
                    { type: "Stock", allocation: 60 },
                    { type: "Crypto", allocation: 45 },
                    { type: "ETF", allocation: 12 },
                    { type: "Cash", allocation: 4 },
                ],
                { allocation: { color: "teal.solid" } },
                {
                    xAxis: { dataKey: "type" },
                    grid: { show: true },
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const barStacked = example({
    keywords: ["Chart", "Bar", "stacked", "stackId"],
    description: "Multiple series stacked together",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
                [
                    { month: "January", windows: 186, mac: 80, linux: 120 },
                    { month: "February", windows: 165, mac: 95, linux: 110 },
                    { month: "March", windows: 190, mac: 87, linux: 125 },
                ],
                {
                    windows: { color: "teal.solid", stackId: "a" },
                    mac: { color: "purple.solid", stackId: "a" },
                    linux: { color: "blue.solid", stackId: "a" },
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

export const barPercentStacked = example({
    keywords: ["Chart", "Bar", "stackOffset", "expand", "percent"],
    description: "Proportional stacked chart",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
                [
                    { month: "January", windows: 186, mac: 80, linux: 120 },
                    { month: "February", windows: 165, mac: 95, linux: 110 },
                ],
                {
                    windows: { color: "teal.solid", stackId: "a" },
                    mac: { color: "purple.solid", stackId: "a" },
                    linux: { color: "blue.solid", stackId: "a" },
                },
                {
                    xAxis: { dataKey: "month" },
                    yAxis: { tickFormat: "percent" },
                    stackOffset: "expand",
                    legend: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const barHorizontal = example({
    keywords: ["Chart", "Bar", "horizontal", "layout", "vertical"],
    description: "Bars oriented horizontally",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
                [
                    { month: "January", windows: 186, mac: 80 },
                    { month: "February", windows: 165, mac: 95 },
                    { month: "March", windows: 190, mac: 87 },
                ],
                {
                    windows: { color: "teal.solid", stackId: "a" },
                    mac: { color: "purple.solid", stackId: "a" },
                },
                {
                    layout: "vertical",
                    yAxis: { dataKey: "month" },
                    legend: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const barGrouped = example({
    keywords: ["Chart", "Bar", "grouped", "multi-series"],
    description: "Multiple bars per category",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
                [
                    { type: "mobile", poor: 40, fair: 100, good: 200, excellent: 70 },
                    { type: "marketing", poor: 15, fair: 40, good: 120, excellent: 90 },
                ],
                {
                    poor: { color: "red.solid" },
                    fair: { color: "orange.solid" },
                    good: { color: "yellow.solid" },
                    excellent: { color: "green.solid" },
                },
                {
                    xAxis: { dataKey: "type" },
                    legend: { show: true },
                    tooltip: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const barCurrency = example({
    keywords: ["Chart", "Bar", "currency", "TickFormat"],
    description: "Y-axis with currency format",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
                [
                    { month: "June", sales: 63000 },
                    { month: "July", sales: 72000 },
                    { month: "August", sales: 58000 },
                    { month: "September", sales: 81000 },
                ],
                { sales: { color: "teal.solid" } },
                {
                    xAxis: { dataKey: "month" },
                    yAxis: { tickFormat: Chart.TickFormat.Currency({ currency: "USD", compact: "short" }) },
                    grid: { show: true },
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const barWithBrush = example({
    keywords: ["Chart", "Bar", "brush", "zoom"],
    description: "Drag to zoom/pan across data range",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
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

export const barSparseMultiSeries = example({
    keywords: ["Chart", "BarMulti", "sparse", "multi-series"],
    description: "Separate arrays for each series (avoids null values)",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarMulti(
                {
                    sales: [
                        { month: "Jan", value: 186n },
                        { month: "Feb", value: 305n },
                        { month: "Mar", value: 237n },
                        { month: "Apr", value: 273n },
                    ],
                    returns: [
                        { month: "Jan", value: 20n },
                        { month: "Mar", value: 35n },
                        { month: "Apr", value: 28n },
                    ],
                },
                {
                    xAxis: { dataKey: "month" },
                    valueKey: "value",
                    series: {
                        sales: { color: "teal.solid" },
                        returns: { color: "red.solid" },
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

export const barWithBrushAndLabels = example({
    keywords: ["Chart", "Bar", "brush", "yAxis", "label"],
    description: "Zoomable bar chart with labeled axes",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
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

export const barWithReferenceLine = example({
    keywords: ["Chart", "Bar", "referenceLines", "target"],
    description: "Horizontal target line at y=200",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
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
                        { y: 250, stroke: "red", strokeDasharray: "5 5", label: "Target", labelPosition: "insideBottomRight" }
                    ],
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const barWithReferenceArea = example({
    keywords: ["Chart", "Bar", "referenceAreas", "zone"],
    description: "Highlight target zone between y=200 and y=300",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
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
                        { y1: 200, y2: 300, fill: "green", fillOpacity: 0.15, label: "Target Zone", labelPosition: "insideTopRight" }
                    ],
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const barDualYAxis = example({
    keywords: ["Chart", "Bar", "yAxis2", "yAxisId", "dual"],
    description: "Sales volume (left) vs Profit margin % (right)",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
                [
                    { month: "Jan", sales: 186, margin: 15 },
                    { month: "Feb", sales: 305, margin: 22 },
                    { month: "Mar", sales: 237, margin: 18 },
                    { month: "Apr", sales: 273, margin: 25 },
                    { month: "May", sales: 350, margin: 30 },
                ],
                {
                    sales: { color: "teal.solid", yAxisId: "left" },
                    margin: { color: "purple.solid", yAxisId: "right" },
                },
                {
                    xAxis: { dataKey: "month" },
                    yAxis: { label: "Sales ($K)" },
                    yAxis2: { label: "Margin (%)" },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const barPivotWithColors = example({
    keywords: ["Chart", "Bar", "pivot", "pivotColors", "pivotKey"],
    description: "Long-format data with explicit pivotColors mapping",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
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

export const barPivotWithoutColors = example({
    keywords: ["Chart", "Bar", "pivot", "default color"],
    description: "Long-format data using default color for all series",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
                [
                    { month: "Jan", category: "A", value: 100 },
                    { month: "Jan", category: "B", value: 80 },
                    { month: "Jan", category: "C", value: 60 },
                    { month: "Feb", category: "A", value: 120 },
                    { month: "Feb", category: "B", value: 90 },
                    { month: "Feb", category: "C", value: 70 },
                ],
                {
                    value: { },
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

export const barMultiPivotWithColors = example({
    keywords: ["Chart", "BarMulti", "pivot", "pivotColors"],
    description: "Multi-series with pivot within each record",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarMulti(
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

export const barMultiPivotWithoutColors = example({
    keywords: ["Chart", "BarMulti", "pivot", "default"],
    description: "Multi-series pivot using default colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarMulti(
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
                        forecast: {  },
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

export const barIntegerXAxis = example({
    keywords: ["Chart", "Bar", "xAxis", "integer", "numeric"],
    description: "Numeric integer x-axis — gaps at hours 1-2, 13-17 show proportional spacing",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
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

export const barFloatXAxis = example({
    keywords: ["Chart", "Bar", "xAxis", "float", "continuous"],
    description: "Continuous float x-axis — non-uniform dose spacing shows proportional gaps",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
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

export const barStringXAxis = example({
    keywords: ["Chart", "Bar", "xAxis", "string", "categorical"],
    description: "Categorical string x-axis — all categories equally spaced",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
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

export const barAxisFormatting = example({
    keywords: ["Chart", "Bar", "TickFormat", "Date", "Currency"],
    description: "Custom tick formats for date (x-axis) and currency (y-axis)",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Bar(
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

export const barInteractive = example({
    keywords: ["Chart", "Bar", "Reactive", "State", "interactive", "counter"],
    description: "Bar chart whose Friday bar is driven by a reactive counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "bar_counter", 0n));
            const value = $.let(counter.read());
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Box.Root([
                    Chart.Bar(
                        [
                            { day: "Mon", visits: 120 },
                            { day: "Tue", visits: 200 },
                            { day: "Wed", visits: 150 },
                            { day: "Thu", visits: 180 },
                            { day: "Fri", visits: value.multiply(15).add(240) },
                        ],
                        { visits: { color: "blue.solid" } },
                        { xAxis: { dataKey: "day" }, grid: { show: true } },
                    ),
                ], { height: "200px", width: "100%" }),
                Button.Root("Bump Friday", { onClick: inc }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
