/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, IntegerType, NullType, example, some } from "@elaraai/east";
import { Box, Button, Chart, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const barSegmentBasic = example({
    keywords: ["Chart", "BarSegment", "distribution", "showLabel"],
    description: "Traffic source distribution",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarSegment([
                { name: "Google", value: 500000, color: some("teal.solid") },
                { name: "Direct", value: 100000, color: some("blue.solid") },
                { name: "Bing", value: 200000, color: some("orange.solid") },
                { name: "Yandex", value: 100000, color: some("purple.solid") },
            ], {
                sort: { by: "value", direction: "desc" },
                showLabel: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const barSegmentWithValues = example({
    keywords: ["Chart", "BarSegment", "showValue", "percentages"],
    description: "Show percentages in legend",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarSegment([
                { name: "Google", value: 500000, color: some("teal.solid") },
                { name: "Direct", value: 100000, color: some("blue.solid") },
                { name: "Bing", value: 200000, color: some("orange.solid") },
                { name: "Yandex", value: 100000, color: some("purple.solid") },
            ], {
                sort: { by: "value", direction: "desc" },
                showValue: true,
                showLabel: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const barSegmentTraffic = example({
    keywords: ["Chart", "BarSegment", "traffic", "breakdown"],
    description: "Website traffic breakdown",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarSegment([
                { name: "Search", value: 450000, color: some("green.solid") },
                { name: "Social", value: 250000, color: some("blue.solid") },
                { name: "Email", value: 150000, color: some("orange.solid") },
                { name: "Direct", value: 100000, color: some("gray.solid") },
                { name: "Referral", value: 50000, color: some("purple.solid") },
            ], {
                sort: { by: "value", direction: "desc" },
                showValue: true,
                showLabel: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const barSegmentBudget = example({
    keywords: ["Chart", "BarSegment", "budget", "allocation"],
    description: "Department budget split",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarSegment([
                { name: "Development", value: 40, color: some("blue.solid") },
                { name: "Marketing", value: 35, color: some("teal.solid") },
                { name: "Operations", value: 15, color: some("orange.solid") },
                { name: "Other", value: 10, color: some("gray.solid") },
            ], {
                showLabel: true,
                showValue: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const barSegmentNoLabels = example({
    keywords: ["Chart", "BarSegment", "minimal", "no legend"],
    description: "Bar only, no legend",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarSegment([
                { name: "A", value: 40, color: some("teal.solid") },
                { name: "B", value: 30, color: some("blue.solid") },
                { name: "C", value: 20, color: some("orange.solid") },
                { name: "D", value: 10, color: some("purple.solid") },
            ], {
                showLabel: false,
                showValue: false,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const barSegmentAscending = example({
    keywords: ["Chart", "BarSegment", "sort", "asc", "ascending"],
    description: "Smallest to largest",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarSegment([
                { name: "Tiny", value: 5, color: some("pink.solid") },
                { name: "Small", value: 15, color: some("orange.solid") },
                { name: "Medium", value: 30, color: some("yellow.solid") },
                { name: "Large", value: 50, color: some("green.solid") },
            ], {
                sort: { by: "value", direction: "asc" },
                showLabel: true,
                showValue: true,
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const barSegmentInteractive = example({
    keywords: ["Chart", "BarSegment", "Reactive", "State", "interactive", "counter"],
    description: "BarSegment whose Active segment grows with a reactive counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "barseg_counter", 0n));
            const value = $.let(counter.read());
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Box.Root([
                    Chart.BarSegment([
                        { name: "Active", value: value.toFloat().multiply(5.0).add(60.0), color: some("green.solid") },
                        { name: "Idle", value: 25, color: some("yellow.solid") },
                        { name: "Offline", value: 15, color: some("red.solid") },
                    ], { showValue: true, showLabel: true }),
                ], { width: "100%" }),
                Button.Root("Grow Active", { onClick: inc }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
