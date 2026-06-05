/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Text, VStack, HStack, Reactive } from "@elaraai/east-ui";

export const boxBasic = example({
    keywords: ["Box", "Root", "basic", "container"],
    description: "Simple container with no styling",
    fn: East.function([], UIComponentType, (_$) => {
        return <Box><Text>Content inside a basic box</Text></Box>;
    }),
    inputs: [],
});

export const boxStyled = example({
    keywords: ["Box", "Root", "padding", "background", "borderRadius", "color"],
    description: "Box with background, padding, and border radius",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box padding="4" background="blue.50" color="blue.800" borderRadius="md">
                <Text>Styled container content</Text>
            </Box>
        );
    }),
    inputs: [],
});

export const boxFlexRow = example({
    keywords: ["Box", "Root", "flex", "row", "justifyContent", "alignItems"],
    description: "Horizontal flex container with gap",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box display="flex" flexDirection="row" justifyContent="space-between" alignItems="center" gap="4" padding="4" background="gray.100" borderRadius="md">
                <Text>Item 1</Text>
                <Text>Item 2</Text>
                <Text>Item 3</Text>
            </Box>
        );
    }),
    inputs: [],
});

export const boxFlexColumn = example({
    keywords: ["Box", "Root", "flex", "column", "vertical"],
    description: "Vertical flex container with items centered",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box display="flex" flexDirection="column" justifyContent="space-around" alignItems="center" height="150px" padding="4" background="purple.50" color="purple.800" borderRadius="lg">
                <Text>Top</Text>
                <Text>Middle</Text>
                <Text>Bottom</Text>
            </Box>
        );
    }),
    inputs: [],
});

export const boxFixed = example({
    keywords: ["Box", "Root", "width", "height", "fixed", "dimensions"],
    description: "Box with explicit width and height",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box display="flex" width="200px" height="100px" justifyContent="center" alignItems="center" background="teal.100" color="teal.800" borderRadius="sm">
                <Text>200x100 box</Text>
            </Box>
        );
    }),
    inputs: [],
});

export const boxNested = example({
    keywords: ["Box", "Root", "nested", "container"],
    description: "Box containing another styled box",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box padding="4" background="gray.100" borderRadius="md">
                <Box padding="2" background="blue.100" borderRadius="sm">
                    <Text>Inner box</Text>
                </Box>
            </Box>
        );
    }),
    inputs: [],
});

export const boxBorders = example({
    keywords: ["Box", "Root", "border", "borderColor", "borderWidth", "solid", "dashed"],
    description: "Box with border, borderColor, and borderWidth",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box display="flex" gap="4">
                <Box padding="4" border="2px solid" borderColor="blue.500" borderRadius="md">
                    <Text>Solid border</Text>
                </Box>
                <Box padding="4" border="2px dashed" borderColor="green.500" borderRadius="md">
                    <Text>Dashed border</Text>
                </Box>
                <Box padding="4" borderWidth="4px" borderColor="red.500" background="red.50" borderRadius="lg">
                    <Text>Custom width</Text>
                </Box>
            </Box>
        );
    }),
    inputs: [],
});

export const boxJustify = example({
    keywords: ["Box", "Root", "justifyContent", "flex-start", "center", "flex-end"],
    description: "Different justify-content values",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box display="flex" flexDirection="column" gap="2">
                <Box display="flex" justifyContent="flex-start" padding="2" background="green.100" borderRadius="sm">
                    <Text>start</Text>
                </Box>
                <Box display="flex" justifyContent="center" padding="2" background="green.100" borderRadius="sm">
                    <Text>center</Text>
                </Box>
                <Box display="flex" justifyContent="flex-end" padding="2" background="green.100" borderRadius="sm">
                    <Text>end</Text>
                </Box>
            </Box>
        );
    }),
    inputs: [],
});

export const boxInteractive = example({
    keywords: ["Box", "Reactive", "State", "interactive", "background", "toggle"],
    description: "Box whose background colour alternates each click",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const counter = $.let(State.bind([IntegerType], "box_counter", 0n));
            const value = $.let(counter.read());
            const isEven = $.let(value.remainder(2n).equal(0n));
            const bg = $.let(isEven.ifElse(() => "blue.100", () => "green.100"));
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Box padding="4" background={bg} borderRadius="md">
                        <Text>Box background toggles between blue and green</Text>
                    </Box>
                    <Button onClick={inc}>Toggle background</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const boxSticky = example({
    keywords: ["Box", "position", "sticky", "scroll", "header"],
    description: "Box with position=\"sticky\" — a header row that stays pinned while its parent scrolls",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box overflowY="auto" height="240px" borderColor="gray.300" borderWidth="thin">
                <Box position="sticky" top="0" zIndex="sticky" padding="3" background="white" borderColor="gray.200" borderWidth="thin">
                    <Text>Sticky header</Text>
                </Box>
                <VStack gap="2" padding="3">
                    {Array.from({ length: 10 }, (_, i) => <Text>{`Row ${i + 1}`}</Text>)}
                </VStack>
            </Box>
        );
    }),
    inputs: [],
});

export const boxElevated = example({
    keywords: ["Box", "boxShadow", "borderRadius", "elevated", "card"],
    description: "Box with boxShadow=\"md\" + borderRadius=\"md\" to produce a card surface",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box padding="4" background="white" borderRadius="md" boxShadow="md">
                <Text>Elevated card — BoxShadow.md</Text>
            </Box>
        );
    }),
    inputs: [],
});

export const boxAnimated = example({
    keywords: ["Box", "animation", "pulse", "status", "live", "recomputing"],
    description: "Box with animation=\"pulse\" — a \"recomputing\" status dot inside a chip",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2" align="center">
                <Box width="10px" height="10px" borderRadius="full" background="orange.500" animation="pulse" />
                <Text>Recomputing…</Text>
            </HStack>
        );
    }),
    inputs: [],
});

export const boxTabularNumeric = example({
    keywords: ["Box", "fontFamily", "mono", "fontVariantNumeric", "tabular-nums", "KPI"],
    description: "Box with fontFamily=\"mono\" + fontVariantNumeric=\"tabular-nums\" — KPI digits align across rows",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box fontFamily="mono" fontVariantNumeric="tabular-nums" padding="3" background="gray.50" borderRadius="md">
                <VStack gap="1" align="flex-end">
                    <Text>{"  1,234.56"}</Text>
                    <Text>{"    56.07"}</Text>
                    <Text>{"789,012.30"}</Text>
                </VStack>
            </Box>
        );
    }),
    inputs: [],
});
