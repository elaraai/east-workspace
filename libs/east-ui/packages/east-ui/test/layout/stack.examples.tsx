/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Button, Meter, Stack, Tag, Text, VStack, HStack, Reactive } from "@elaraai/east-ui";

export const stackBasicVStack = example({
    keywords: ["Stack", "VStack", "vertical", "gap"],
    description: "Vertical stack with gap",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3">
                <Text>First item</Text>
                <Text>Second item</Text>
                <Text>Third item</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const stackBasicHStack = example({
    keywords: ["Stack", "HStack", "horizontal", "gap"],
    description: "Horizontal stack with gap",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4">
                <Text>Left</Text>
                <Text>Center</Text>
                <Text>Right</Text>
            </HStack>
        );
    }),
    inputs: [],
});

export const stackJustifiedHStack = example({
    keywords: ["Stack", "HStack", "justify", "space-between"],
    description: "Items spread across container",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4" justify="space-between" padding="4" background="gray.100" width="100%">
                <Text>Start</Text>
                <Text>End</Text>
            </HStack>
        );
    }),
    inputs: [],
});

export const stackCentered = example({
    keywords: ["Stack", "VStack", "align", "justify", "center"],
    description: "Items centered horizontally and vertically",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="2" align="center" justify="center" padding="6" background="blue.50" height="120px">
                <Text>Centered content</Text>
                <Text>Also centered</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const stackWrapping = example({
    keywords: ["Stack", "HStack", "wrap", "FlexWrap"],
    description: "Items wrap to next line when needed",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2" wrap="wrap" padding="3" background="orange.50" width="200px">
                <Text>Tag 1</Text>
                <Text>Tag 2</Text>
                <Text>Tag 3</Text>
                <Text>Tag 4</Text>
                <Text>Tag 5</Text>
            </HStack>
        );
    }),
    inputs: [],
});

export const stackStretched = example({
    keywords: ["Stack", "VStack", "align", "stretch"],
    description: "Items stretched to fill container width",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" align="stretch" padding="4" background="green.50">
                <Text>Full width item 1</Text>
                <Text>Full width item 2</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const stackNested = example({
    keywords: ["Stack", "VStack", "HStack", "nested"],
    description: "VStack containing HStack",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" padding="4" background="gray.100">
                <HStack gap="2">
                    <Text>Inner 1</Text>
                    <Text>Inner 2</Text>
                </HStack>
                <Text>Outer Item</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const stackNavbar = example({
    keywords: ["Stack", "HStack", "navbar", "navigation", "logo"],
    description: "Typical nav layout with HStack",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4" justify="space-between" align="center" padding="4" background="white" width="100%">
                <Text>Logo</Text>
                <HStack gap="4">
                    <Text>Home</Text>
                    <Text>About</Text>
                    <Text>Contact</Text>
                </HStack>
            </HStack>
        );
    }),
    inputs: [],
});

export const stackDensityCascade = example({
    keywords: ["Stack", "HStack", "density", "cascade", "condensed", "compact", "comfortable"],
    description: "Three HStack rows with different densities — the same Tag / Badge / Meter children inherit each row's density",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Stack direction="column" gap="6">
                <HStack density="condensed" gap="2">
                    <Tag>Line A</Tag>
                    <Badge>WK 12</Badge>
                    <Box width="160px"><Meter value={72.0} tone="success" /></Box>
                </HStack>
                <HStack density="compact" gap="2">
                    <Tag>Line A</Tag>
                    <Badge>WK 12</Badge>
                    <Box width="160px"><Meter value={72.0} tone="success" /></Box>
                </HStack>
                <HStack density="comfortable" gap="2">
                    <Tag>Line A</Tag>
                    <Badge>WK 12</Badge>
                    <Box width="160px"><Meter value={72.0} tone="success" /></Box>
                </HStack>
            </Stack>
        );
    }),
    inputs: [],
});

export const stackInteractive = example({
    keywords: ["Stack", "Reactive", "State", "interactive", "gap", "toggle"],
    description: "Stack gap toggles between tight and wide on each click",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const counter = $.let(State.bind([IntegerType], "stack_counter", 0n));
            const value = $.let(counter.read());
            const isTight = $.let(value.remainder(2n).equal(0n));
            const gap = $.let(isTight.ifElse(() => "1", () => "8"));
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <VStack gap={gap} align="stretch">
                        <Text>First</Text>
                        <Text>Second</Text>
                        <Text>Third</Text>
                    </VStack>
                    <Button onClick={inc}>Toggle gap</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const stackFillScroll = example({
    keywords: ["Stack", "VStack", "fill", "scroll", "scrollY", "bounded", "sizing", "height"],
    description: "A height-bounded VStack (#320): a pinned header above a `fill scrollY` VStack that takes the remaining height and scrolls, so the region bounds and scrolls inside its box without pixel arithmetic",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack height="220px" width="260px" align="stretch" gap="0">
                <Box background="gray.50" padding="3"><Text>Header</Text></Box>
                <VStack fill scrollY align="stretch" gap="2" padding="3">
                    {Array.from({ length: 20 }, (_, i) => <Text>{`Item ${i + 1}`}</Text>)}
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
