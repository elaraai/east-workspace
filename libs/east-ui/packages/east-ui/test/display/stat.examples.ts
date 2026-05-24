/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Button, Format, Reactive, Stack, State, Stat, UIComponentType } from "@elaraai/east-ui";

export const statBasic = example({
    keywords: ["Stat", "Root", "basic", "metrics"],
    description: "Key metrics display — scalar values with formats",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Stat.Root("Revenue", 45231, { format: Format.Currency({ currency: "USD", maximumFractionDigits: 0n }) }),
            Stat.Root("Users", 1234, { format: Format.Number() }),
            Stat.Root("Orders", 567, { format: Format.Number() }),
        ], { gap: "8" });
    }),
    inputs: [],
});

export const statHelpText = example({
    keywords: ["Stat", "Root", "helpText", "context"],
    description: "Additional context",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Stat.Root("Total Sales", 12345, { format: Format.Currency({ currency: "USD", maximumFractionDigits: 0n }), helpText: "Last 30 days" }),
            Stat.Root("New Users", 89, { format: Format.Number(), helpText: "This week" }),
        ], { gap: "8" });
    }),
    inputs: [],
});

export const statIndicators = example({
    keywords: ["Stat", "Root", "indicator", "up", "down", "trend"],
    description: "Trend direction",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Stat.Root("Growth", 0.2336, { format: Format.Percent({ maximumFractionDigits: 2n, signDisplay: "exceptZero" }), helpText: "vs last month", indicator: "up" }),
            Stat.Root("Bounce Rate", -0.125, { format: Format.Percent({ maximumFractionDigits: 1n, signDisplay: "exceptZero" }), helpText: "vs yesterday", indicator: "down" }),
        ], { gap: "8" });
    }),
    inputs: [],
});

export const statFormatted = example({
    keywords: ["Stat", "Root", "Format", "currency", "compact", "unit", "datetime"],
    description: "Numeric values formatted via Format — currency, compact, unit, datetime",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Stat.Root("ARR", 1842500, { format: Format.Currency({ currency: "AUD", compact: "short" }) }),
            Stat.Root("Requests", 1240000, { format: Format.Compact({ display: "short" }) }),
            Stat.Root("Throughput", 42.5, { format: Format.Unit({ unit: "kilometerPerHour", display: "short" }) }),
            Stat.Root("Last sync", 1716249600000, { format: Format.DateTime("YYYY-MM-DD HH:mm") }),
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
                Stat.Root("Clicks", value, { format: Format.Number() }),
                Button.Root("Click me", { onClick: inc }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
