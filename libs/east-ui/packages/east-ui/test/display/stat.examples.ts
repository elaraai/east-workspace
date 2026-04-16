/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Badge, Highlight, HoverCard, Stack, Stat, Text, UIComponentType } from "../../src/index.js";

export const statBasic = example({
    keywords: ["Stat", "Root", "basic", "metrics"],
    description: "Key metrics display",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Stat.Root("Revenue", Text.Root("$45,231")),
            Stat.Root("Users", Text.Root("1,234")),
            Stat.Root("Orders", Text.Root("567")),
        ], { gap: "8" });
    }),
    inputs: [],
});

export const statHelpText = example({
    keywords: ["Stat", "Root", "helpText", "context"],
    description: "Additional context",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Stat.Root("Total Sales", Text.Root("$12,345"), { helpText: "Last 30 days" }),
            Stat.Root("New Users", Text.Root("89"), { helpText: "This week" }),
        ], { gap: "8" });
    }),
    inputs: [],
});

export const statIndicators = example({
    keywords: ["Stat", "Root", "indicator", "up", "down", "trend"],
    description: "Trend direction",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Stat.Root("Growth", Text.Root("+23.36%"), { helpText: "vs last month", indicator: "up" }),
            Stat.Root("Bounce Rate", Text.Root("-12.5%"), { helpText: "vs yesterday", indicator: "down" }),
        ], { gap: "8" });
    }),
    inputs: [],
});

export const statRichValues = example({
    keywords: ["Stat", "Root", "Badge", "HoverCard", "Highlight", "rich"],
    description: "Values can be any UI component — badges, hover cards, highlighted text",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Stat.Root("Status", Badge.Root("Operational", { variant: "solid", colorPalette: "green" })),
            Stat.Root("Owner", HoverCard.Root(
                Text.Root("@jane", { color: "blue.500" }),
                [
                    Stack.VStack([
                        Text.Root("Jane Smith", { fontWeight: "bold" }),
                        Text.Root("Senior Engineer — Platform Team", { fontSize: "sm" }),
                    ], { gap: "1" }),
                ],
            )),
            Stat.Root("Query", Highlight.Root("SELECT * FROM users", ["SELECT", "FROM"])),
        ], { gap: "8" });
    }),
    inputs: [],
});
