/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Heading, Reactive, VStack } from "@elaraai/east-ui/jsx";

export const headingBasic = example({
    keywords: ["Heading", "Root", "basic"],
    description: "Simple heading with no styling",
    fn: East.function([], UIComponentType, (_$) => {
        return <Heading>Hello World</Heading>;
    }),
    inputs: [],
});

export const headingStandardSizes = example({
    keywords: ["Heading", "Root", "textStyle", "heading-xs", "heading-sm", "heading-md", "heading-lg"],
    description: "Heading textStyles xs through lg",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="2" align="flex-start">
                <Heading textStyle="heading-xs">Extra Small (heading-xs)</Heading>
                <Heading textStyle="heading-sm">Small (heading-sm)</Heading>
                <Heading textStyle="heading-md">Medium (heading-md)</Heading>
                <Heading textStyle="heading-lg">Large (heading-lg)</Heading>
            </VStack>
        );
    }),
    inputs: [],
});

export const headingExtendedSizes = example({
    keywords: ["Heading", "Root", "textStyle", "display-sm", "display-md", "display-lg", "display-xl"],
    description: "Display textStyles for large page titles",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="2" align="flex-start">
                <Heading textStyle="display-sm">Display Small</Heading>
                <Heading textStyle="display-md">Display Medium</Heading>
                <Heading textStyle="display-lg">Display Large</Heading>
                <Heading textStyle="display-xl">Display Extra Large</Heading>
            </VStack>
        );
    }),
    inputs: [],
});

export const headingSemanticLevels = example({
    keywords: ["Heading", "Root", "as", "h1", "h2", "h3", "h4", "semantic"],
    description: "HTML heading elements h1-h6",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="2" align="flex-start">
                <Heading as="h1" textStyle="display-xl">H1 - Main Title</Heading>
                <Heading as="h2" textStyle="heading-lg">H2 - Section</Heading>
                <Heading as="h3" textStyle="heading-md">H3 - Subsection</Heading>
                <Heading as="h4" textStyle="heading-sm">H4 - Minor</Heading>
            </VStack>
        );
    }),
    inputs: [],
});

export const headingColored = example({
    keywords: ["Heading", "Root", "color", "blue", "green", "purple"],
    description: "Headings with different colors",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="2" align="flex-start">
                <Heading textStyle="heading-lg" color="blue.600">Blue Heading</Heading>
                <Heading textStyle="heading-lg" color="green.600">Green Heading</Heading>
                <Heading textStyle="heading-lg" color="purple.600">Purple Heading</Heading>
            </VStack>
        );
    }),
    inputs: [],
});

export const headingAlignment = example({
    keywords: ["Heading", "Root", "textAlign", "left", "center", "right"],
    description: "Left, center, and right aligned",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="2" align="stretch">
                <Heading textStyle="heading-md" textAlign="left">Left Aligned</Heading>
                <Heading textStyle="heading-md" textAlign="center">Center Aligned</Heading>
                <Heading textStyle="heading-md" textAlign="right">Right Aligned</Heading>
            </VStack>
        );
    }),
    inputs: [],
});

export const headingCombined = example({
    keywords: ["Heading", "Root", "combined", "textStyle", "as", "color", "textAlign"],
    description: "Page title with all options",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Heading as="h1" textStyle="display-md" color="gray.800" textAlign="center">
                Welcome to East UI
            </Heading>
        );
    }),
    inputs: [],
});

export const headingBackground = example({
    keywords: ["Heading", "Root", "background", "hero", "coloured-band"],
    description: "Hero heading with a coloured background band",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Heading as="h2" textStyle="display-sm" color="blue.900" background="blue.50" textAlign="center" padding="4">
                Platform Overview
            </Heading>
        );
    }),
    inputs: [],
});

export const headingInteractive = example({
    keywords: ["Heading", "Reactive", "State", "interactive", "counter"],
    description: "Reactive heading whose text updates from a counter",
    fn: East.function([], UIComponentType, (_$) => (
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
    )),
    inputs: [],
});
