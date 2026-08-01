/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Code, Reactive, Separator, VStack, HStack } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const codeBasic = example({
    keywords: ["Code", "Root", "basic", "inline"],
    description: "Plain inline code snippet",
    fn: East.function([], UIComponentType, (_$) => {
        return <Code>const x = 1</Code>;
    }),
    inputs: [],
});

// ============================================================================
// Code — variants, sizes, palettes (variant panel)
// ============================================================================

export const codeVariants = example({
    keywords: ["Code", "Root", "variant", "subtle", "surface", "outline", "size", "xs", "sm", "md", "lg", "colorPalette", "gray", "blue", "green", "red", "combined", "Reactive", "State", "interactive", "counter"],
    description: "Code variant panel — subtle (subtle background), surface (surface styling), outline (outline border), sizes (different code sizes), colors (different color schemes), combined (multiple style options), interactive (reactive code snippet whose value updates from a counter)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="SUBTLE" align="start" />
                <Code variant="subtle">npm install</Code>
                <Separator label="SURFACE" align="start" />
                <Code variant="surface">npm run build</Code>
                <Separator label="OUTLINE" align="start" />
                <Code variant="outline">npm test</Code>
                <Separator label="SIZES" align="start" />
                <HStack gap="4">
                    <Code size="xs">xs</Code>
                    <Code size="sm">sm</Code>
                    <Code size="md">md</Code>
                    <Code size="lg">lg</Code>
                </HStack>
                <Separator label="COLORS" align="start" />
                <HStack gap="3">
                    <Code variant="subtle" colorPalette="gray">gray</Code>
                    <Code variant="subtle" colorPalette="blue">blue</Code>
                    <Code variant="subtle" colorPalette="green">green</Code>
                    <Code variant="subtle" colorPalette="red">red</Code>
                </HStack>
                <Separator label="COMBINED" align="start" />
                <Code variant="surface" colorPalette="purple" size="md">console.log('Hello')</Code>
                <Separator label="INTERACTIVE" align="start" />
                <Reactive>{$ => {
                    const counter = $.let(State.bind([IntegerType], "code_counter", 0n));
                    const value = $.let(counter.read());
                    const increment = $.const(East.function([], NullType, $ => {
                        const cur = $.let(counter.read());
                        $(counter.write(cur.add(1n)));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <Code>{East.str`const count = ${East.print(value)};`}</Code>
                            <Button onClick={increment}>Increment</Button>
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
