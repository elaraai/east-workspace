/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Separator, Text, VStack, HStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const boxBasic = example({
    keywords: ["Box", "Root", "basic", "container"],
    description: "Simple container with no styling",
    fn: East.function([], UIComponentType, (_$) => {
        return <Box><Text>Content inside a basic box</Text></Box>;
    }),
    inputs: [],
});

// ============================================================================
// Box — surface styling, tokens, animation, position (variant panel)
// ============================================================================

export const boxVariants = example({
    keywords: ["Box", "Root", "padding", "background", "borderRadius", "color", "border", "borderColor", "borderWidth", "solid", "dashed", "boxShadow", "elevated", "card", "animation", "pulse", "status", "live", "recomputing", "fontFamily", "mono", "fontVariantNumeric", "tabular-nums", "KPI", "position", "sticky", "scroll", "header", "Reactive", "State", "interactive", "toggle"],
    description: "Box variant panel — styled (background, padding, and border radius), borders (border, borderColor, and borderWidth), elevated (boxShadow card surface), animated (pulse status dot), tabular numeric (mono + tabular-nums KPI digits), sticky (a pinned header while its parent scrolls), interactive (background colour alternates each click)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="STYLED" align="start" />
                <Box padding="4" background="blue.50" color="blue.800" borderRadius="md">
                    <Text>Styled container content</Text>
                </Box>
                <Separator label="BORDERS" align="start" />
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
                <Separator label="ELEVATED" align="start" />
                <Box padding="4" background="white" borderRadius="md" boxShadow="md">
                    <Text>Elevated card — BoxShadow.md</Text>
                </Box>
                <Separator label="ANIMATED" align="start" />
                <HStack gap="2" align="center">
                    <Box width="10px" height="10px" borderRadius="full" background="orange.500" animation="pulse" />
                    <Text>Recomputing…</Text>
                </HStack>
                <Separator label="TABULAR NUMERIC" align="start" />
                <Box fontFamily="mono" fontVariantNumeric="tabular-nums" padding="3" background="gray.50" borderRadius="md">
                    <VStack gap="1" align="flex-end">
                        <Text>{"  1,234.56"}</Text>
                        <Text>{"    56.07"}</Text>
                        <Text>{"789,012.30"}</Text>
                    </VStack>
                </Box>
                <Separator label="STICKY" align="start" />
                <Box overflowY="auto" height="240px" borderColor="gray.300" borderWidth="thin">
                    <Box position="sticky" top="0" zIndex="sticky" padding="3" background="white" borderColor="gray.200" borderWidth="thin">
                        <Text>Sticky header</Text>
                    </Box>
                    <VStack gap="2" padding="3">
                        {Array.from({ length: 10 }, (_, i) => <Text>{`Row ${i + 1}`}</Text>)}
                    </VStack>
                </Box>
                <Separator label="INTERACTIVE" align="start" />
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
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Box — flex layout, dimensions, nesting (layout panel)
// ============================================================================

export const boxLayout = example({
    keywords: ["Box", "Root", "flex", "row", "justifyContent", "alignItems", "column", "vertical", "width", "height", "fixed", "dimensions", "nested", "container", "flex-start", "center", "flex-end"],
    description: "Box layout panel — flex row (horizontal flex container with gap), flex column (vertical flex container with items centered), fixed (explicit width and height), nested (box containing another styled box), justify (different justify-content values)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="FLEX ROW" align="start" />
                <Box display="flex" flexDirection="row" justifyContent="space-between" alignItems="center" gap="4" padding="4" background="gray.100" borderRadius="md">
                    <Text>Item 1</Text>
                    <Text>Item 2</Text>
                    <Text>Item 3</Text>
                </Box>
                <Separator label="FLEX COLUMN" align="start" />
                <Box display="flex" flexDirection="column" justifyContent="space-around" alignItems="center" height="150px" padding="4" background="purple.50" color="purple.800" borderRadius="lg">
                    <Text>Top</Text>
                    <Text>Middle</Text>
                    <Text>Bottom</Text>
                </Box>
                <Separator label="FIXED" align="start" />
                <Box display="flex" width="200px" height="100px" justifyContent="center" alignItems="center" background="teal.100" color="teal.800" borderRadius="sm">
                    <Text>200x100 box</Text>
                </Box>
                <Separator label="NESTED" align="start" />
                <Box padding="4" background="gray.100" borderRadius="md">
                    <Box padding="2" background="blue.100" borderRadius="sm">
                        <Text>Inner box</Text>
                    </Box>
                </Box>
                <Separator label="JUSTIFY" align="start" />
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
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Behavioral isolates — the #320 bounded-column contract
// ============================================================================

export const boxFillScroll = example({
    keywords: ["Box", "fill", "scroll", "scrollY", "flexShrink", "bounded", "sizing", "height"],
    description: "Bounded column (#320) — a fixed-height Box whose pinned header does not shrink (definite size ⇒ flexShrink:0) above a `fill scrollY` region that takes the remaining height and scrolls, replacing the hand-written `flex:1 + min-height:0 + overflow` chain with one prop each",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box display="flex" flexDirection="column" height="220px" width="260px" border="1px solid" borderColor="gray.200" borderRadius="md" overflow="hidden">
                <Box padding="3" background="gray.50"><Text>Pinned header</Text></Box>
                <Box fill scrollY padding="3">
                    <VStack align="stretch" gap="2">
                        {Array.from({ length: 20 }, (_, i) => <Text>{`Scrolling row ${i + 1}`}</Text>)}
                    </VStack>
                </Box>
            </Box>
        );
    }),
    inputs: [],
});
