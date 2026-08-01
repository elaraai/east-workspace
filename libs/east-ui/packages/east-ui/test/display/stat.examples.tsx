/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Format, State, UIComponentType } from "@elaraai/east-ui";
import { Button, Stat, Text, HStack, VStack, Stack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

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

// ============================================================================
// Stat — help text, indicators, formats, densities, interactive (variant panel)
// ============================================================================

export const statVariants = example({
    keywords: ["Stat", "Root", "helpText", "context", "indicator", "up", "down", "trend", "Format", "currency", "compact", "unit", "datetime", "density", "condensed", "comfortable", "sizes", "Reactive", "State", "interactive", "counter"],
    description: "Stat variant panel — help text (additional context), indicators (trend direction), formatted (numeric values formatted via Format — currency, compact, unit, datetime), densities (the three densities stacked — condensed → compact → comfortable, matching ChipRail / Trace), interactive (stat whose value increments from a counter)",
    fn: East.function([], UIComponentType, ($) => {
        const condensed = $.const(<Stat label="Revenue" value={45231} format={Format.Currency({ currency: "USD", maximumFractionDigits: 0n })} indicator="up" density="condensed" />);
        const compact = $.const(<Stat label="Revenue" value={45231} format={Format.Currency({ currency: "USD", maximumFractionDigits: 0n })} indicator="up" density="compact" />);
        const comfortable = $.const(<Stat label="Revenue" value={45231} format={Format.Currency({ currency: "USD", maximumFractionDigits: 0n })} indicator="up" density="comfortable" />);
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">HELP TEXT</Text>
                    <HStack gap="8">
                        <Stat label="Total Sales" value={12345} format={Format.Currency({ currency: "USD", maximumFractionDigits: 0n })} helpText="Last 30 days" />
                        <Stat label="New Users" value={89} format={Format.Number()} helpText="This week" />
                    </HStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">INDICATORS</Text>
                    <HStack gap="8">
                        <Stat label="Growth" value={0.2336} format={Format.Percent({ maximumFractionDigits: 2n, signDisplay: "exceptZero" })} helpText="vs last month" indicator="up" />
                        <Stat label="Bounce Rate" value={-0.125} format={Format.Percent({ maximumFractionDigits: 1n, signDisplay: "exceptZero" })} helpText="vs yesterday" indicator="down" />
                    </HStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FORMATTED</Text>
                    <HStack gap="8">
                        <Stat label="ARR" value={1842500} format={Format.Currency({ currency: "AUD", compact: "short" })} />
                        <Stat label="Requests" value={1240000} format={Format.Compact({ display: "short" })} />
                        <Stat label="Throughput" value={42.5} format={Format.Unit({ unit: "kilometerPerHour", display: "short" })} />
                        <Stat label="Last sync" value={1716249600000} format={Format.DateTime("YYYY-MM-DD HH:mm")} />
                    </HStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">DENSITIES</Text>
                    <Stack direction="column" gap="6">
                        {condensed}
                        {compact}
                        {comfortable}
                    </Stack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">INTERACTIVE</Text>
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
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
