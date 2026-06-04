/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Format, State, UIComponentType } from "@elaraai/east-ui";
import { Button, Stat, HStack, VStack, Reactive } from "@elaraai/east-ui/jsx";

export const statBasic = example({
    keywords: ["Stat", "Root", "basic", "metrics"],
    description: "Key metrics display — scalar values with formats",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="8">
                <Stat label="Revenue" value={45231} format={Format.Currency({ currency: "USD", maximumFractionDigits: 0n })} />
                <Stat label="Users" value={1234} format={Format.Number()} />
                <Stat label="Orders" value={567} format={Format.Number()} />
            </HStack>
        );
    }),
    inputs: [],
});

export const statHelpText = example({
    keywords: ["Stat", "Root", "helpText", "context"],
    description: "Additional context",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="8">
                <Stat label="Total Sales" value={12345} format={Format.Currency({ currency: "USD", maximumFractionDigits: 0n })} helpText="Last 30 days" />
                <Stat label="New Users" value={89} format={Format.Number()} helpText="This week" />
            </HStack>
        );
    }),
    inputs: [],
});

export const statIndicators = example({
    keywords: ["Stat", "Root", "indicator", "up", "down", "trend"],
    description: "Trend direction",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="8">
                <Stat label="Growth" value={0.2336} format={Format.Percent({ maximumFractionDigits: 2n, signDisplay: "exceptZero" })} helpText="vs last month" indicator="up" />
                <Stat label="Bounce Rate" value={-0.125} format={Format.Percent({ maximumFractionDigits: 1n, signDisplay: "exceptZero" })} helpText="vs yesterday" indicator="down" />
            </HStack>
        );
    }),
    inputs: [],
});

export const statFormatted = example({
    keywords: ["Stat", "Root", "Format", "currency", "compact", "unit", "datetime"],
    description: "Numeric values formatted via Format — currency, compact, unit, datetime",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="8">
                <Stat label="ARR" value={1842500} format={Format.Currency({ currency: "AUD", compact: "short" })} />
                <Stat label="Requests" value={1240000} format={Format.Compact({ display: "short" })} />
                <Stat label="Throughput" value={42.5} format={Format.Unit({ unit: "kilometerPerHour", display: "short" })} />
                <Stat label="Last sync" value={1716249600000} format={Format.DateTime("YYYY-MM-DD HH:mm")} />
            </HStack>
        );
    }),
    inputs: [],
});

export const statInteractive = example({
    keywords: ["Stat", "Reactive", "State", "interactive", "counter"],
    description: "Stat whose value increments from a counter",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const counter = $.let(State.bind([IntegerType], "stat_counter", 0n));
            const value = $.let(counter.read());
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Stat label="Clicks" value={value} format={Format.Number()} />
                    <Button onClick={inc}>Click me</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
