/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Mark, Reactive, VStack, HStack, Text } from "@elaraai/east-ui";

export const markBasic = example({
    keywords: ["Mark", "Root", "basic"],
    description: "Simple text mark",
    fn: East.function([], UIComponentType, (_$) => {
        return <Mark>Important</Mark>;
    }),
    inputs: [],
});

export const markSubtle = example({
    keywords: ["Mark", "Root", "variant", "subtle"],
    description: "Soft background highlight",
    fn: East.function([], UIComponentType, (_$) => {
        return <Mark variant="subtle">Note</Mark>;
    }),
    inputs: [],
});

export const markSolid = example({
    keywords: ["Mark", "Root", "variant", "solid"],
    description: "Strong background fill",
    fn: East.function([], UIComponentType, (_$) => {
        return <Mark variant="solid">NEW</Mark>;
    }),
    inputs: [],
});

export const markText = example({
    keywords: ["Mark", "Root", "variant", "text"],
    description: "Colored text only",
    fn: East.function([], UIComponentType, (_$) => {
        return <Mark variant="text">Updated</Mark>;
    }),
    inputs: [],
});

export const markPlain = example({
    keywords: ["Mark", "Root", "variant", "plain"],
    description: "Minimal styling",
    fn: East.function([], UIComponentType, (_$) => {
        return <Mark variant="plain">Plain</Mark>;
    }),
    inputs: [],
});

export const markColors = example({
    keywords: ["Mark", "Root", "colorPalette", "yellow", "green", "blue", "red", "purple"],
    description: "Different color schemes",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="3">
                <Mark variant="subtle" colorPalette="yellow">Yellow</Mark>
                <Mark variant="subtle" colorPalette="green">Green</Mark>
                <Mark variant="subtle" colorPalette="blue">Blue</Mark>
                <Mark variant="subtle" colorPalette="red">Red</Mark>
                <Mark variant="subtle" colorPalette="purple">Purple</Mark>
            </HStack>
        );
    }),
    inputs: [],
});

export const markSolidColors = example({
    keywords: ["Mark", "Root", "variant", "solid", "success", "warning", "error", "info"],
    description: "Bold color variants",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="3">
                <Mark variant="solid" colorPalette="green">Success</Mark>
                <Mark variant="solid" colorPalette="orange">Warning</Mark>
                <Mark variant="solid" colorPalette="red">Error</Mark>
                <Mark variant="solid" colorPalette="blue">Info</Mark>
            </HStack>
        );
    }),
    inputs: [],
});

export const markInContext = example({
    keywords: ["Mark", "Root", "inline", "context", "text"],
    description: "Mark within text flow",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="1">
                <Text>{"This feature is "}</Text>
                <Mark variant="subtle" colorPalette="orange">deprecated</Mark>
                <Text>{" and will be removed."}</Text>
            </HStack>
        );
    }),
    inputs: [],
});

export const markInteractive = example({
    keywords: ["Mark", "Reactive", "State", "interactive", "counter"],
    description: "Reactive marked text whose label updates from a counter",
    fn: East.function([], UIComponentType, (_$) => (
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
    )),
    inputs: [],
});
