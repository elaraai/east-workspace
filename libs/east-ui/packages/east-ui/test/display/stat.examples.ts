/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Badge, Button, Highlight, HoverCard, Reactive, Stack, State, Stat, Text, UIComponentType } from "@elaraai/east-ui";

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
                        Text.Root("Senior Engineer — Platform Team", { textStyle: "body-sm" }),
                    ], { gap: "1" }),
                ],
            )),
            Stat.Root("Query", Highlight.Root("SELECT * FROM users", ["SELECT", "FROM"])),
        ], { gap: "8" });
    }),
    inputs: [],
});

export const statInteractive = example({
    keywords: ["Stat", "Reactive", "State", "interactive", "counter"],
    description: "Stat whose value increments from a counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "stat_counter", 0n));
            const value = $.let(counter.read());
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Stat.Root("Clicks", Text.Root(East.print(value))),
                Button.Root("Click me", { onClick: inc }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
