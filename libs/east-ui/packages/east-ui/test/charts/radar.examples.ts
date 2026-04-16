/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, example } from "@elaraai/east";
import { Chart, Box, UIComponentType } from "../../src/index.js";

export const radarBasic = example({
    keywords: ["Chart", "Radar", "single series", "basic"],
    description: "Single series radar",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Radar(
                [
                    { month: "January", windows: 130 },
                    { month: "February", windows: 120 },
                    { month: "March", windows: 75 },
                    { month: "April", windows: 90 },
                    { month: "May", windows: 110 },
                ],
                { windows: { color: "teal.solid" } },
                {
                    dataKey: "month",
                    grid: { show: true },
                    fillOpacity: 0.5,
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});

export const radarMultiSeries = example({
    keywords: ["Chart", "Radar", "multi-series", "compare", "legend"],
    description: "Compare two data series",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Radar(
                [
                    { month: "January", windows: 30, mac: 100 },
                    { month: "February", windows: 50, mac: 80 },
                    { month: "March", windows: 70, mac: 60 },
                    { month: "April", windows: 90, mac: 70 },
                    { month: "May", windows: 60, mac: 90 },
                ],
                {
                    windows: { color: "teal.solid" },
                    mac: { color: "orange.solid" },
                },
                {
                    dataKey: "month",
                    grid: { show: true },
                    legend: { show: true },
                    fillOpacity: 0.2,
                }
            ),
        ], { height: "280px", width: "100%" });
    }),
    inputs: [],
});

export const radarSkillsComparison = example({
    keywords: ["Chart", "Radar", "skills", "comparison", "tooltip"],
    description: "Current vs target skills",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Radar(
                [
                    { subject: "Math", current: 80, target: 90 },
                    { subject: "Science", current: 95, target: 85 },
                    { subject: "English", current: 70, target: 80 },
                    { subject: "History", current: 85, target: 75 },
                    { subject: "Art", current: 60, target: 70 },
                ],
                {
                    current: { color: "blue.solid" },
                    target: { color: "green.solid" },
                },
                {
                    dataKey: "subject",
                    grid: { show: true },
                    legend: { show: true },
                    tooltip: { show: true },
                    fillOpacity: 0.3,
                }
            ),
        ], { height: "280px", width: "100%" });
    }),
    inputs: [],
});

export const radarHighOpacity = example({
    keywords: ["Chart", "Radar", "fillOpacity", "solid"],
    description: "More solid fill appearance",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.Radar(
                [
                    { skill: "Speed", value: 85 },
                    { skill: "Power", value: 90 },
                    { skill: "Defense", value: 70 },
                    { skill: "Stamina", value: 80 },
                    { skill: "Technique", value: 95 },
                ],
                { value: { color: "purple.solid" } },
                {
                    dataKey: "skill",
                    grid: { show: true },
                    fillOpacity: 0.7,
                }
            ),
        ], { height: "250px", width: "100%" });
    }),
    inputs: [],
});
