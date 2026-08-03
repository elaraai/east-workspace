/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Heading, Reactive, Separator, VStack } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const headingBasic = example({
    keywords: ["Heading", "Root", "basic"],
    description: "Simple heading with no styling",
    fn: East.function([], UIComponentType, (_$) => {
        return <Heading>Hello World</Heading>;
    }),
    inputs: [],
});

// ============================================================================
// Heading — sizes, levels, styling (variant panel)
// ============================================================================

export const headingVariants = example({
    keywords: ["Heading", "Root", "textStyle", "heading-xs", "heading-sm", "heading-md", "heading-lg", "display-sm", "display-md", "display-lg", "display-xl", "as", "h1", "h2", "h3", "h4", "semantic", "color", "blue", "green", "purple", "textAlign", "left", "center", "right", "combined", "background", "hero", "coloured-band", "Reactive", "State", "interactive", "counter"],
    description: "Heading variant panel — standard sizes (heading textStyles xs through lg), extended sizes (display textStyles for large page titles), semantic levels (HTML heading elements h1-h6), colored (headings with different colors), alignment (left, center, and right aligned), combined (page title with all options), background (hero heading with a coloured background band), interactive (reactive heading whose text updates from a counter)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="STANDARD SIZES" align="start" />
                <VStack gap="2" align="flex-start">
                    <Heading textStyle="heading-xs">Extra Small (heading-xs)</Heading>
                    <Heading textStyle="heading-sm">Small (heading-sm)</Heading>
                    <Heading textStyle="heading-md">Medium (heading-md)</Heading>
                    <Heading textStyle="heading-lg">Large (heading-lg)</Heading>
                </VStack>
                <Separator label="EXTENDED SIZES" align="start" />
                <VStack gap="2" align="flex-start">
                    <Heading textStyle="display-sm">Display Small</Heading>
                    <Heading textStyle="display-md">Display Medium</Heading>
                    <Heading textStyle="display-lg">Display Large</Heading>
                    <Heading textStyle="display-xl">Display Extra Large</Heading>
                </VStack>
                <Separator label="SEMANTIC LEVELS" align="start" />
                <VStack gap="2" align="flex-start">
                    <Heading as="h1" textStyle="display-xl">H1 - Main Title</Heading>
                    <Heading as="h2" textStyle="heading-lg">H2 - Section</Heading>
                    <Heading as="h3" textStyle="heading-md">H3 - Subsection</Heading>
                    <Heading as="h4" textStyle="heading-sm">H4 - Minor</Heading>
                </VStack>
                <Separator label="COLORED" align="start" />
                <VStack gap="2" align="flex-start">
                    <Heading textStyle="heading-lg" color="link">Blue Heading</Heading>
                    <Heading textStyle="heading-lg" color="fg.success">Green Heading</Heading>
                    <Heading textStyle="heading-lg" color="accent.purple">Purple Heading</Heading>
                </VStack>
                <Separator label="ALIGNMENT" align="start" />
                <VStack gap="2" align="stretch">
                    <Heading textStyle="heading-md" textAlign="left">Left Aligned</Heading>
                    <Heading textStyle="heading-md" textAlign="center">Center Aligned</Heading>
                    <Heading textStyle="heading-md" textAlign="right">Right Aligned</Heading>
                </VStack>
                <Separator label="COMBINED" align="start" />
                <Heading as="h1" textStyle="display-md" color="fg.default" textAlign="center">
                    Welcome to East UI
                </Heading>
                <Separator label="BACKGROUND" align="start" />
                <Heading as="h2" textStyle="display-sm" color="link" background="bg.brand.subtle" textAlign="center" padding="4">
                    Platform Overview
                </Heading>
                <Separator label="INTERACTIVE" align="start" />
                <Reactive>{$ => {
                    const counter = $.let(State.bind([IntegerType], "heading_counter", 0n));
                    const value = $.let(counter.read());
                    const increment = $.const(East.function([], NullType, $ => {
                        const cur = $.let(counter.read());
                        $(counter.write(cur.add(1n)));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <Heading textStyle="heading-lg">{East.str`Click count: ${East.print(value)}`}</Heading>
                            <Button onClick={increment}>Click me</Button>
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
