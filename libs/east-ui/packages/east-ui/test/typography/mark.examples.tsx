/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Mark, Reactive, Separator, VStack, HStack, Text } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const markBasic = example({
    keywords: ["Mark", "Root", "basic"],
    description: "Simple text mark",
    fn: East.function([], UIComponentType, (_$) => {
        return <Mark>Important</Mark>;
    }),
    inputs: [],
});

// ============================================================================
// Mark — variants, palettes, context (variant panel)
// ============================================================================

export const markVariants = example({
    keywords: ["Mark", "Root", "variant", "subtle", "solid", "text", "plain", "colorPalette", "yellow", "green", "blue", "red", "purple", "success", "warning", "error", "info", "inline", "context", "Reactive", "State", "interactive", "counter"],
    description: "Mark variant panel — subtle (soft background highlight), solid (strong background fill), text (colored text only), plain (minimal styling), colors (different color schemes), solid colors (bold color variants), in context (mark within text flow), interactive (reactive marked text whose label updates from a counter)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="SUBTLE" align="start" />
                <Mark variant="subtle">Note</Mark>
                <Separator label="SOLID" align="start" />
                <Mark variant="solid">NEW</Mark>
                <Separator label="TEXT" align="start" />
                <Mark variant="text">Updated</Mark>
                <Separator label="PLAIN" align="start" />
                <Mark variant="plain">Plain</Mark>
                <Separator label="COLORS" align="start" />
                <HStack gap="3">
                    <Mark variant="subtle" colorPalette="yellow">Yellow</Mark>
                    <Mark variant="subtle" colorPalette="green">Green</Mark>
                    <Mark variant="subtle" colorPalette="blue">Blue</Mark>
                    <Mark variant="subtle" colorPalette="red">Red</Mark>
                    <Mark variant="subtle" colorPalette="purple">Purple</Mark>
                </HStack>
                <Separator label="SOLID COLORS" align="start" />
                <HStack gap="3">
                    <Mark variant="solid" colorPalette="green">Success</Mark>
                    <Mark variant="solid" colorPalette="orange">Warning</Mark>
                    <Mark variant="solid" colorPalette="red">Error</Mark>
                    <Mark variant="solid" colorPalette="blue">Info</Mark>
                </HStack>
                <Separator label="IN CONTEXT" align="start" />
                <HStack gap="1">
                    <Text>{"This feature is "}</Text>
                    <Mark variant="subtle" colorPalette="orange">deprecated</Mark>
                    <Text>{" and will be removed."}</Text>
                </HStack>
                <Separator label="INTERACTIVE" align="start" />
                <Reactive>{$ => {
                    const counter = $.let(State.bind([IntegerType], "mark_counter", 0n));
                    const value = $.let(counter.read());
                    const increment = $.const(East.function([], NullType, $ => {
                        const cur = $.let(counter.read());
                        $(counter.write(cur.add(1n)));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <Text>Marked content updates as you click:</Text>
                            <Mark variant="subtle" colorPalette="yellow">{East.str`Mark #${East.print(value)}`}</Mark>
                            <Button onClick={increment}>Bump</Button>
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
