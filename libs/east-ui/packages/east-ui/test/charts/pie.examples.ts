/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, example, some } from "@elaraai/east";
import { Chart, Box, UIComponentType } from "../../src/index.js";

export const pieBasic = example({
    keywords: ["Chart", "Pie", "basic", "colors"],
    description: "Simple pie chart with colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Pie([
                { name: "Windows", value: 400, color: some("blue.solid") },
                { name: "Mac", value: 300, color: some("orange.solid") },
                { name: "Linux", value: 300, color: some("pink.solid") },
                { name: "Other", value: 200, color: some("green.solid") },
            ]),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const pieDonut = example({
    keywords: ["Chart", "Pie", "donut", "innerRadius", "outerRadius", "tooltip"],
    description: "Pie with inner radius",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Pie(
                [
                    { name: "Windows", value: 400, color: some("blue.solid") },
                    { name: "Mac", value: 300, color: some("orange.solid") },
                    { name: "Linux", value: 300, color: some("pink.solid") },
                    { name: "Other", value: 200, color: some("green.solid") },
                ],
                {
                    innerRadius: 60,
                    outerRadius: 80,
                    tooltip: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const pieWithLegend = example({
    keywords: ["Chart", "Pie", "legend"],
    description: "Pie chart with legend",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Pie(
                [
                    { name: "Desktop", value: 450, color: some("teal.solid") },
                    { name: "Mobile", value: 350, color: some("purple.solid") },
                    { name: "Tablet", value: 200, color: some("orange.solid") },
                ],
                {
                    legend: { show: true },
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});

export const pieSemiCircle = example({
    keywords: ["Chart", "Pie", "semi-circle", "startAngle", "endAngle"],
    description: "Half pie chart",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Pie(
                [
                    { name: "Complete", value: 75, color: some("green.solid") },
                    { name: "Remaining", value: 25, color: some("gray.solid") },
                ],
                {
                    startAngle: 180,
                    endAngle: 0,
                    innerRadius: 60,
                    outerRadius: 80,
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const pieWithPadding = example({
    keywords: ["Chart", "Pie", "paddingAngle", "gaps"],
    description: "Gaps between slices",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Pie(
                [
                    { name: "Q1", value: 100, color: some("blue.solid") },
                    { name: "Q2", value: 120, color: some("green.solid") },
                    { name: "Q3", value: 80, color: some("orange.solid") },
                    { name: "Q4", value: 150, color: some("purple.solid") },
                ],
                {
                    paddingAngle: 5,
                    innerRadius: 40,
                    outerRadius: 80,
                }
            ),
        ], { height: "200px", width: "100%" });
    }),
    inputs: [],
});

export const pieWithLabels = example({
    keywords: ["Chart", "Pie", "showLabels", "outerRadius"],
    description: "Labels on each slice",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Pie(
                [
                    { name: "Chrome", value: 65, color: some("blue.solid") },
                    { name: "Safari", value: 20, color: some("orange.solid") },
                    { name: "Firefox", value: 10, color: some("pink.solid") },
                    { name: "Other", value: 5, color: some("gray.solid") },
                ],
                {
                    showLabels: true,
                    outerRadius: 70,
                }
            ),
        ], { height: "220px", width: "100%" });
    }),
    inputs: [],
});
