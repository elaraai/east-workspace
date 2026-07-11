/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Button, Flex, Text, VStack, Reactive } from "@elaraai/east-ui";

export const flexBasic = example({
    keywords: ["Flex", "Root", "basic", "row", "gap"],
    description: "Simple flex container (row by default)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Flex gap="4">
                <Text>Item 1</Text>
                <Text>Item 2</Text>
                <Text>Item 3</Text>
            </Flex>
        );
    }),
    inputs: [],
});

export const flexRowJustify = example({
    keywords: ["Flex", "Root", "direction", "row", "justifyContent", "space-between"],
    description: "Horizontal flex with space-between justification",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Flex direction="row" justifyContent="space-between" alignItems="center" padding="4" background="blue.50" borderRadius="md">
                <Text>Left</Text>
                <Text>Center</Text>
                <Text>Right</Text>
            </Flex>
        );
    }),
    inputs: [],
});

export const flexColumn = example({
    keywords: ["Flex", "Root", "direction", "column", "alignItems"],
    description: "Vertical flex container with centered items",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Flex direction="column" alignItems="center" gap="2" padding="4" background="purple.50" borderRadius="md">
                <Text>Top</Text>
                <Text>Middle</Text>
                <Text>Bottom</Text>
            </Flex>
        );
    }),
    inputs: [],
});

export const flexWrap = example({
    keywords: ["Flex", "Root", "wrap", "responsive"],
    description: "Items wrap to next line when container is too narrow",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Flex wrap="wrap" gap="2" padding="4" background="green.50" borderRadius="md" width="200px">
                <Text>Item 1</Text>
                <Text>Item 2</Text>
                <Text>Item 3</Text>
                <Text>Item 4</Text>
                <Text>Item 5</Text>
                <Text>Item 6</Text>
            </Flex>
        );
    }),
    inputs: [],
});

export const flexCentered = example({
    keywords: ["Flex", "Root", "justifyContent", "alignItems", "center"],
    description: "Both horizontally and vertically centered",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Flex justifyContent="center" alignItems="center" height="100px" background="teal.100" borderRadius="md">
                <Text>Centered!</Text>
            </Flex>
        );
    }),
    inputs: [],
});

export const flexNested = example({
    keywords: ["Flex", "Root", "nested"],
    description: "Flex containers inside flex containers",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Flex direction="row" gap="4" padding="4" background="gray.100" borderRadius="md">
                <Flex direction="column" gap="1" padding="2" background="orange.100" borderRadius="sm">
                    <Text>A</Text>
                    <Text>B</Text>
                </Flex>
                <Flex direction="column" gap="1" padding="2" background="orange.100" borderRadius="sm">
                    <Text>C</Text>
                    <Text>D</Text>
                </Flex>
            </Flex>
        );
    }),
    inputs: [],
});

export const flexAlignItems = example({
    keywords: ["Flex", "Root", "alignItems", "flex-start", "center", "flex-end"],
    description: "Different alignItems values",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Flex direction="row" gap="2">
                <Flex alignItems="flex-start" height="60px" padding="2" background="pink.100" borderRadius="sm">
                    <Text>flex-start</Text>
                </Flex>
                <Flex alignItems="center" height="60px" padding="2" background="pink.100" borderRadius="sm">
                    <Text>center</Text>
                </Flex>
                <Flex alignItems="flex-end" height="60px" padding="2" background="pink.100" borderRadius="sm">
                    <Text>flex-end</Text>
                </Flex>
            </Flex>
        );
    }),
    inputs: [],
});

export const flexReverse = example({
    keywords: ["Flex", "Root", "direction", "row-reverse"],
    description: "Items displayed in reverse order",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Flex direction="row-reverse" gap="4" padding="4" background="cyan.50" borderRadius="md">
                <Text>1</Text>
                <Text>2</Text>
                <Text>3</Text>
            </Flex>
        );
    }),
    inputs: [],
});

export const flexInteractive = example({
    keywords: ["Flex", "Reactive", "State", "interactive", "direction", "toggle"],
    description: "Flex direction toggles between row and column on each click",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const counter = $.let(State.bind([IntegerType], "flex_counter", 0n));
            const value = $.let(counter.read());
            const isRow = $.let(value.remainder(2n).equal(0n));
            const direction = $.let(isRow.ifElse(() => Style.FlexDirection("row"), () => Style.FlexDirection("column")));
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Flex direction={direction} gap="4" padding="4" background="gray.100" borderRadius="md">
                        <Text>A</Text>
                        <Text>B</Text>
                        <Text>C</Text>
                    </Flex>
                    <Button onClick={inc}>Toggle direction</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const flexFillScroll = example({
    keywords: ["Flex", "fill", "scroll", "scrollY", "column", "bounded", "sizing", "height"],
    description: "A column Flex bounded to a fixed height (#320): a non-shrinking toolbar row above a `fill scrollY` body that consumes the remainder and scrolls — the `flex:1 + min-height:0 + overflow` incantation as declarative props",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Flex direction="column" height="220px" width="260px">
                <Flex background="gray.50" padding="3"><Text>Toolbar</Text></Flex>
                <Flex fill scrollY direction="column" gap="2" padding="3">
                    {Array.from({ length: 20 }, (_, i) => <Text>{`Row ${i + 1}`}</Text>)}
                </Flex>
            </Flex>
        );
    }),
    inputs: [],
});
