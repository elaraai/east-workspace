/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Reactive, Separator, Sparkline, VStack, HStack, Text } from "@elaraai/east-ui";

// Module-scope fixtures — one per merged example (consolidation epic #455).
const SPARKLINE_AREA_DATA = [10.0, 20.0, 15.0, 25.0, 18.0, 30.0, 22.0];
const SPARKLINE_COLORS_DATA = [1.0, 2.0, 1.5, 3.0, 2.5];
const SPARKLINE_SIZES_DATA = [1.0, 2.0, 1.5, 3.0, 2.5];
const SPARKLINE_STOCK_DATA = [142.5, 143.2, 141.8, 144.0, 143.5, 145.2, 144.8, 146.0];
const SPARKLINE_METRIC_DATA = [100.0, 120.0, 115.0, 130.0, 125.0, 140.0, 155.0];
const SPARKLINE_TABLE_CELL_DATA = [10.0, 12.0, 8.0, 15.0, 11.0, 14.0];
const SPARKLINE_DOWNTREND_DATA = [50.0, 48.0, 45.0, 42.0, 44.0, 40.0, 38.0];

export const sparklineBasic = example({
    keywords: ["Sparkline", "line", "basic"],
    description: "Default line chart type",
    fn: East.function([], UIComponentType, (_$) => {
        return <Sparkline data={[1.0, 3.0, 2.0, 4.0, 3.5, 5.0, 4.2]} type="line" color="blue.500" width="150px" height="40px" />;
    }),
    inputs: [],
});

export const sparklineVariants = example({
    keywords: ["Sparkline", "area", "filled", "color", "red", "teal", "purple", "width", "height", "sizes", "stock", "uptrend", "dashboard", "metric", "inline", "table", "compact", "downtrend", "declining"],
    description: "Sparkline variant panel — area (filled), colors (red/teal/purple), sizes (different dimensions), stock (uptrend), metric (inline dashboard), table cell (compact), downtrend (declining)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="AREA" align="start" />
                <Sparkline data={SPARKLINE_AREA_DATA} type="area" color="green.500" width="150px" height="40px" />
                <Separator label="COLORS" align="start" />
                <VStack gap="2">
                    <HStack gap="2" align="center">
                        <Sparkline data={SPARKLINE_COLORS_DATA} type="line" color="red.400" width="100px" height="32px" />
                        <Text>Red</Text>
                    </HStack>
                    <HStack gap="2" align="center">
                        <Sparkline data={SPARKLINE_COLORS_DATA} type="line" color="teal.400" width="100px" height="32px" />
                        <Text>Teal</Text>
                    </HStack>
                    <HStack gap="2" align="center">
                        <Sparkline data={SPARKLINE_COLORS_DATA} type="line" color="purple.400" width="100px" height="32px" />
                        <Text>Purple</Text>
                    </HStack>
                </VStack>
                <Separator label="SIZES" align="start" />
                <VStack gap="3" align="stretch">
                    <Sparkline data={SPARKLINE_SIZES_DATA} type="line" color="blue.500" width="80px" height="24px" />
                    <Sparkline data={SPARKLINE_SIZES_DATA} type="line" color="blue.500" width="120px" height="32px" />
                    <Sparkline data={SPARKLINE_SIZES_DATA} type="line" color="blue.500" width="200px" height="48px" />
                </VStack>
                <Separator label="STOCK" align="start" />
                <Sparkline data={SPARKLINE_STOCK_DATA} type="area" color="green.500" width="150px" height="48px" />
                <Separator label="METRIC" align="start" />
                <HStack gap="4" align="center">
                    <VStack gap="1">
                        <Text>Revenue</Text>
                        <Text fontWeight="bold">$45,231</Text>
                    </VStack>
                    <Sparkline data={SPARKLINE_METRIC_DATA} type="area" color="teal.400" width="100px" height="40px" />
                </HStack>
                <Separator label="TABLE CELL" align="start" />
                <HStack gap="4" align="center">
                    <Text>Product A</Text>
                    <Sparkline data={SPARKLINE_TABLE_CELL_DATA} type="line" color="gray.400" width="80px" height="24px" />
                    <Text color="green.500">+14%</Text>
                </HStack>
                <Separator label="DOWNTREND" align="start" />
                <Sparkline data={SPARKLINE_DOWNTREND_DATA} type="area" color="red.400" width="150px" height="48px" />
            </VStack>
        );
    }),
    inputs: [],
});

export const sparklineInteractive = example({
    keywords: ["Sparkline", "Reactive", "State", "interactive", "counter"],
    description: "Sparkline whose last point is driven by a reactive counter",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const counter = $.let(State.bind([IntegerType], "sparkline_counter", 0n));
            const value = $.let(counter.read());
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Sparkline
                        data={[10.0, 12.0, 8.0, 15.0, 18.0, 14.0, 22.0, value.toFloat().multiply(2.0).add(19.0)]}
                        color="blue.solid"
                        height="40px"
                        width="200px"
                        type="area"
                    />
                    <Button onClick={inc}>Bump last point</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
