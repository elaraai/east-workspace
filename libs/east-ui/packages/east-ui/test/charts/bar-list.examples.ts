/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, example, some, none } from "@elaraai/east";
import { Chart, Box, UIComponentType } from "../../src/index.js";

export const barListBasic = example({
    keywords: ["Chart", "BarList", "ranking", "sort", "showValue"],
    description: "Traffic sources ranking",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarList([
                { name: "Google", value: 1200000, color: none },
                { name: "Direct", value: 100000, color: none },
                { name: "Bing", value: 200000, color: none },
                { name: "Yahoo", value: 20000, color: none },
                { name: "ChatGPT", value: 1345000, color: none },
                { name: "Github", value: 100000, color: none },
                { name: "Yandex", value: 100000, color: none },
            ], {
                sort: { by: "value", direction: "desc" },
                showValue: true,
                color: "teal.subtle",
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const barListCompact = example({
    keywords: ["Chart", "BarList", "valueFormat", "compact", "abbreviated"],
    description: "Large numbers abbreviated",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarList([
                { name: "ChatGPT", value: 1345000, color: none },
                { name: "Google", value: 1200000, color: none },
                { name: "Bing", value: 200000, color: none },
                { name: "Direct", value: 100000, color: none },
            ], {
                sort: { by: "value", direction: "desc" },
                showValue: true,
                valueFormat: "compact",
                color: "blue.subtle",
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const barListFunnel = example({
    keywords: ["Chart", "BarList", "funnel", "percent", "valueFormat"],
    description: "Sales funnel with percentages",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarList([
                { name: "Created", value: 120, color: none },
                { name: "Initial Contact", value: 90, color: none },
                { name: "Booked Demo", value: 45, color: none },
                { name: "Closed", value: 10, color: none },
            ], {
                sort: { by: "value", direction: "desc" },
                showValue: true,
                valueFormat: "percent",
                color: "pink.subtle",
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const barListCurrency = example({
    keywords: ["Chart", "BarList", "currency", "USD", "TickFormat"],
    description: "Sales by product",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarList([
                { name: "Product A", value: 50000, color: none },
                { name: "Product B", value: 35000, color: none },
                { name: "Product C", value: 28000, color: none },
                { name: "Product D", value: 15000, color: none },
            ], {
                sort: { by: "value", direction: "desc" },
                showValue: true,
                valueFormat: Chart.TickFormat.Currency({ currency: "USD" }),
                color: "green.subtle",
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const barListCustomColors = example({
    keywords: ["Chart", "BarList", "color", "individual", "custom"],
    description: "Individual bar colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarList([
                { name: "Google", value: 1200000, color: some("teal.solid") },
                { name: "Facebook", value: 800000, color: some("blue.solid") },
                { name: "Twitter", value: 500000, color: some("cyan.solid") },
                { name: "LinkedIn", value: 300000, color: some("purple.solid") },
            ], {
                sort: { by: "value", direction: "desc" },
                showValue: true,
                valueFormat: "compact",
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});

export const barListNoValues = example({
    keywords: ["Chart", "BarList", "showValue", "labels only"],
    description: "Labels only",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Chart.BarList([
                { name: "Very High", value: 95, color: none },
                { name: "High", value: 75, color: none },
                { name: "Medium", value: 50, color: none },
                { name: "Low", value: 25, color: none },
            ], {
                sort: { by: "value", direction: "desc" },
                showValue: false,
                color: "orange.subtle",
            }),
        ], { width: "100%" });
    }),
    inputs: [],
});
