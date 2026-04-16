/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, example } from "@elaraai/east";
import { Chart, Box, UIComponentType } from "../../src/index.js";

export const scatterBasic = example({
    keywords: ["Chart", "Scatter", "basic", "correlation"],
    description: "Temperature vs sales correlation",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Scatter(
                [
                    { temp: 10, sales: 30 },
                    { temp: 15, sales: 50 },
                    { temp: 20, sales: 80 },
                    { temp: 25, sales: 95 },
                    { temp: 30, sales: 110 },
                ],
                { temp: { color: "teal.solid" } },
                {
                    xAxis: { dataKey: "temp" },
                    yAxis: { dataKey: "sales" },
                    grid: { show: true },
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const scatterWithLabels = example({
    keywords: ["Chart", "Scatter", "label", "axes"],
    description: "Labeled axes for clarity",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Scatter(
                [
                    { temp: 10, sales: 30 },
                    { temp: 15, sales: 50 },
                    { temp: 20, sales: 80 },
                    { temp: 25, sales: 95 },
                    { temp: 30, sales: 110 },
                ],
                { temp: { color: "blue.solid" } },
                {
                    xAxis: { dataKey: "temp", label: "Temperature" },
                    yAxis: { dataKey: "sales", label: "Sales" },
                    grid: { show: true },
                    tooltip: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const scatterCustomDomain = example({
    keywords: ["Chart", "Scatter", "domain", "axis range"],
    description: "Fixed axis range",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Scatter(
                [
                    { x: 10, y: 30 },
                    { x: 20, y: 40 },
                    { x: 30, y: 60 },
                    { x: 40, y: 80 },
                ],
                { x: { color: "purple.solid" } },
                {
                    xAxis: { dataKey: "x", domain: [0, 50] },
                    yAxis: { dataKey: "y", domain: [0, 100] },
                    grid: { show: true },
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const scatterWithTooltip = example({
    keywords: ["Chart", "Scatter", "tooltip"],
    description: "Hover to see data values",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Scatter(
                [
                    { hours: 2, score: 55 },
                    { hours: 4, score: 65 },
                    { hours: 6, score: 75 },
                    { hours: 8, score: 85 },
                    { hours: 10, score: 90 },
                ],
                { hours: { color: "green.solid", label: "Study Hours" } },
                {
                    xAxis: { dataKey: "hours" },
                    yAxis: { dataKey: "score" },
                    tooltip: { show: true },
                    grid: { show: true },
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const scatterSparseMultiSeries = example({
    keywords: ["Chart", "ScatterMulti", "sparse", "multi-series"],
    description: "Separate arrays for each series (avoids null values)",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.ScatterMulti(
                {
                    groupA: [
                        { x: 10n, value: 30n },
                        { x: 20n, value: 50n },
                        { x: 30n, value: 45n },
                        { x: 40n, value: 60n },
                    ],
                    groupB: [
                        { x: 15n, value: 25n },
                        { x: 35n, value: 55n },
                        { x: 45n, value: 70n },
                    ],
                },
                {
                    xAxis: { dataKey: "x" },
                    valueKey: "value",
                    series: {
                        groupA: { color: "purple.solid" },
                        groupB: { color: "teal.solid" },
                    },
                    tooltip: { show: true },
                    legend: { show: true },
                    grid: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const scatterWithLegend = example({
    keywords: ["Chart", "Scatter", "legend", "multi-series"],
    description: "Multiple series with legend",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Scatter(
                [
                    { temp: 10, sales: 30, traffic: 50 },
                    { temp: 15, sales: 50, traffic: 70 },
                    { temp: 20, sales: 80, traffic: 90 },
                    { temp: 25, sales: 95, traffic: 85 },
                    { temp: 30, sales: 110, traffic: 100 },
                ],
                {
                    sales: { color: "teal.solid", label: "Sales" },
                    traffic: { color: "purple.solid", label: "Traffic" },
                },
                {
                    xAxis: { dataKey: "temp", label: "Temperature" },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "240px", width: "100%" });
    }),
    inputs: [],
});

export const scatterWithReferenceLines = example({
    keywords: ["Chart", "Scatter", "referenceLines", "quadrant"],
    description: "Quadrant dividers at x=50 and y=50",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Scatter(
                [
                    { x: 20, y: 30 },
                    { x: 40, y: 70 },
                    { x: 60, y: 45 },
                    { x: 80, y: 85 },
                    { x: 30, y: 55 },
                    { x: 70, y: 35 },
                ],
                ["y"],
                {
                    xAxis: { dataKey: "x" },
                    yAxis: { dataKey: "y" },
                    grid: { show: true },
                    tooltip: { show: true },
                    referenceLines: [
                        { x: 50, stroke: "gray", strokeDasharray: "3 3" },
                        { y: 50, stroke: "gray", strokeDasharray: "3 3" }
                    ],
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const scatterWithReferenceArea = example({
    keywords: ["Chart", "Scatter", "referenceAreas", "optimal region"],
    description: "Highlight optimal region",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Scatter(
                [
                    { x: 20, y: 30 },
                    { x: 40, y: 70 },
                    { x: 60, y: 45 },
                    { x: 80, y: 85 },
                    { x: 55, y: 65 },
                    { x: 70, y: 75 },
                ],
                ["y"],
                {
                    xAxis: { dataKey: "x" },
                    yAxis: { dataKey: "y" },
                    grid: { show: true },
                    tooltip: { show: true },
                    referenceAreas: [
                        { x1: 50, x2: 80, y1: 60, y2: 90, fill: "green", fillOpacity: 0.15, label: "Optimal", labelPosition: "insideTopRight" }
                    ],
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const scatterDualYAxis = example({
    keywords: ["Chart", "Scatter", "yAxis2", "yAxisId", "dual"],
    description: "Price (left) vs Volume (right) correlation",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Scatter(
                [
                    { day: 1, price: 100, volume: 5000 },
                    { day: 2, price: 105, volume: 7500 },
                    { day: 3, price: 102, volume: 4200 },
                    { day: 4, price: 110, volume: 9000 },
                    { day: 5, price: 108, volume: 6800 },
                ],
                {
                    price: { color: "teal.solid", label: "Price", yAxisId: "left" },
                    volume: { color: "purple.solid", label: "Volume", yAxisId: "right" },
                },
                {
                    xAxis: { dataKey: "day", label: "Day" },
                    yAxis: { label: "Price ($)" },
                    yAxis2: { label: "Volume" },
                    grid: { show: true },
                    tooltip: { show: true },
                    legend: { show: true },
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const scatterWithReferenceDot = example({
    keywords: ["Chart", "Scatter", "referenceDots", "outlier"],
    description: "Highlight an outlier point",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Scatter(
                [
                    { x: 20, y: 30 },
                    { x: 40, y: 45 },
                    { x: 60, y: 50 },
                    { x: 80, y: 55 },
                    { x: 50, y: 95 },
                ],
                ["y"],
                {
                    xAxis: { dataKey: "x" },
                    yAxis: { dataKey: "y" },
                    grid: { show: true },
                    tooltip: { show: true },
                    referenceDots: [
                        { x: 50, y: 95, fill: "red", r: 10n, stroke: "darkred", strokeWidth: 2n, label: "Outlier", labelPosition: "top" }
                    ],
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const scatterPivotWithColors = example({
    keywords: ["Chart", "Scatter", "pivot", "pivotColors", "pivotKey"],
    description: "Long-format data with explicit pivotColors mapping",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Scatter(
                [
                    { x: 10, region: "North", value: 30 },
                    { x: 10, region: "South", value: 25 },
                    { x: 20, region: "North", value: 50 },
                    { x: 20, region: "South", value: 40 },
                    { x: 30, region: "North", value: 70 },
                    { x: 30, region: "South", value: 55 },
                ],
                {
                    value: {
                        color: "blue.500",
                        pivotColors: new Map([
                            ["North", "blue.700"],
                            ["South", "teal.500"],
                        ]),
                    },
                },
                {
                    xAxis: { dataKey: "x" },
                    pivotKey: "region",
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

export const scatterPivotWithoutColors = example({
    keywords: ["Chart", "Scatter", "pivot", "default color"],
    description: "Long-format data using default color for all series",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Scatter(
                [
                    { x: 10, category: "A", value: 30 },
                    { x: 10, category: "B", value: 25 },
                    { x: 10, category: "C", value: 20 },
                    { x: 20, category: "A", value: 50 },
                    { x: 20, category: "B", value: 40 },
                    { x: 20, category: "C", value: 35 },
                ],
                {
                    value: { color: "purple.solid" },
                },
                {
                    xAxis: { dataKey: "x" },
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

export const scatterMultiPivotWithColors = example({
    keywords: ["Chart", "ScatterMulti", "pivot", "pivotColors"],
    description: "Multi-series with pivot within each record",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.ScatterMulti(
                {
                    q1: [
                        { x: 10n, region: "North", value: 30n },
                        { x: 10n, region: "South", value: 25n },
                        { x: 20n, region: "North", value: 50n },
                        { x: 20n, region: "South", value: 40n },
                    ],
                    q2: [
                        { x: 10n, region: "North", value: 35n },
                        { x: 10n, region: "South", value: 30n },
                        { x: 20n, region: "North", value: 55n },
                        { x: 20n, region: "South", value: 45n },
                    ],
                },
                {
                    xAxis: { dataKey: "x" },
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

export const scatterIntegerXAxis = example({
    keywords: ["Chart", "Scatter", "xAxis", "integer", "numeric"],
    description: "Numeric integer x-axis — gaps at hours 1-2, 13-17 show proportional spacing",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Scatter(
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

export const scatterFloatXAxis = example({
    keywords: ["Chart", "Scatter", "xAxis", "float", "continuous"],
    description: "Continuous float x-axis — non-uniform dose spacing shows proportional gaps",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Scatter(
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

export const scatterMultiPivotWithoutColors = example({
    keywords: ["Chart", "ScatterMulti", "pivot", "default"],
    description: "Multi-series pivot using default colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.ScatterMulti(
                {
                    actual: [
                        { x: 10n, type: "Online", value: 50n },
                        { x: 10n, type: "Store", value: 30n },
                        { x: 20n, type: "Online", value: 60n },
                        { x: 20n, type: "Store", value: 40n },
                    ],
                    forecast: [
                        { x: 10n, type: "Online", value: 55n },
                        { x: 10n, type: "Store", value: 35n },
                        { x: 20n, type: "Online", value: 65n },
                        { x: 20n, type: "Store", value: 45n },
                    ],
                },
                {
                    xAxis: { dataKey: "x" },
                    valueKey: "value",
                    pivotKey: "type",
                    series: {
                        actual: { },
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
