/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Button, Meter, Separator, Stack, Tag, Text, VStack, HStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door (V and H side by side)
// ============================================================================

export const stackBasic = example({
    keywords: ["Stack", "VStack", "vertical", "gap", "HStack", "horizontal"],
    description: "Basic pair — basic v stack (vertical stack with gap) and basic h stack (horizontal stack with gap)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="BASIC V STACK" align="start" />
                <VStack gap="3">
                    <Text>First item</Text>
                    <Text>Second item</Text>
                    <Text>Third item</Text>
                </VStack>
                <Separator label="BASIC H STACK" align="start" />
                <HStack gap="4">
                    <Text>Left</Text>
                    <Text>Center</Text>
                    <Text>Right</Text>
                </HStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Stack — justify, align, wrap, nesting, density (variant panel)
// ============================================================================

export const stackVariants = example({
    keywords: ["Stack", "HStack", "justify", "space-between", "VStack", "align", "center", "wrap", "FlexWrap", "stretch", "nested", "navbar", "navigation", "logo", "density", "cascade", "condensed", "compact", "comfortable", "Reactive", "State", "interactive", "gap", "toggle"],
    description: "Stack variant panel — justified h stack (items spread across the container), centered (items centered horizontally and vertically), wrapping (items wrap to the next line when needed), stretched (items stretched to fill the container width), nested (VStack containing HStack), navbar (typical nav layout with HStack), density cascade (three HStack rows with different densities, the same Tag / Badge / Meter children inherit each row's density), interactive (gap toggles between tight and wide on each click)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="JUSTIFIED H STACK" align="start" />
                <HStack gap="4" justify="space-between" padding="4" background="bg.subtle" width="100%">
                    <Text>Start</Text>
                    <Text>End</Text>
                </HStack>
                <Separator label="CENTERED" align="start" />
                <VStack gap="2" align="center" justify="center" padding="6" background="bg.brand.subtle" height="120px">
                    <Text>Centered content</Text>
                    <Text>Also centered</Text>
                </VStack>
                <Separator label="WRAPPING" align="start" />
                <HStack gap="2" wrap="wrap" padding="3" background="bg.warning.subtle" width="200px">
                    <Text>Tag 1</Text>
                    <Text>Tag 2</Text>
                    <Text>Tag 3</Text>
                    <Text>Tag 4</Text>
                    <Text>Tag 5</Text>
                </HStack>
                <Separator label="STRETCHED" align="start" />
                <VStack gap="3" align="stretch" padding="4" background="bg.success.subtle">
                    <Text>Full width item 1</Text>
                    <Text>Full width item 2</Text>
                </VStack>
                <Separator label="NESTED" align="start" />
                <VStack gap="4" padding="4" background="bg.subtle">
                    <HStack gap="2">
                        <Text>Inner 1</Text>
                        <Text>Inner 2</Text>
                    </HStack>
                    <Text>Outer Item</Text>
                </VStack>
                <Separator label="NAVBAR" align="start" />
                <HStack gap="4" justify="space-between" align="center" padding="4" background="bg.surface" width="100%">
                    <Text>Logo</Text>
                    <HStack gap="4">
                        <Text>Home</Text>
                        <Text>About</Text>
                        <Text>Contact</Text>
                    </HStack>
                </HStack>
                <Separator label="DENSITY CASCADE" align="start" />
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
                <Separator label="INTERACTIVE" align="start" />
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
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Behavioral isolates — the #320 bounded-column contract
// ============================================================================

export const stackFillScroll = example({
    keywords: ["Stack", "VStack", "fill", "scroll", "scrollY", "bounded", "sizing", "height"],
    description: "A height-bounded VStack (#320): a pinned header above a `fill scrollY` VStack that takes the remaining height and scrolls, so the region bounds and scrolls inside its box without pixel arithmetic",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack height="220px" width="260px" align="stretch" gap="0">
                <Box background="bg.subtle" padding="3"><Text>Header</Text></Box>
                <VStack fill scrollY align="stretch" gap="2" padding="3">
                    {Array.from({ length: 20 }, (_, i) => <Text>{`Item ${i + 1}`}</Text>)}
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
