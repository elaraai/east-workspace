/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Button, Flex, Separator, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

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

// ============================================================================
// Flex — direction, wrap, alignment, nesting (variant panel)
// ============================================================================

export const flexVariants = example({
    keywords: ["Flex", "Root", "direction", "row", "justifyContent", "space-between", "column", "alignItems", "wrap", "responsive", "center", "nested", "flex-start", "flex-end", "row-reverse", "Reactive", "State", "interactive", "toggle"],
    description: "Flex variant panel — row justify (space-between justification), column (vertical flex container with centered items), wrap (items wrap when the container is too narrow), centered (both horizontally and vertically centered), nested (flex containers inside flex containers), align items (different alignItems values), reverse (items displayed in reverse order), interactive (direction toggles between row and column on each click)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="ROW JUSTIFY" align="start" />
                <Flex direction="row" justifyContent="space-between" alignItems="center" padding="4" background="bg.brand.subtle" borderRadius="md">
                    <Text>Left</Text>
                    <Text>Center</Text>
                    <Text>Right</Text>
                </Flex>
                <Separator label="COLUMN" align="start" />
                <Flex direction="column" alignItems="center" gap="2" padding="4" background="bg.subtle" borderRadius="md">
                    <Text>Top</Text>
                    <Text>Middle</Text>
                    <Text>Bottom</Text>
                </Flex>
                <Separator label="WRAP" align="start" />
                <Flex wrap="wrap" gap="2" padding="4" background="bg.success.subtle" borderRadius="md" width="200px">
                    <Text>Item 1</Text>
                    <Text>Item 2</Text>
                    <Text>Item 3</Text>
                    <Text>Item 4</Text>
                    <Text>Item 5</Text>
                    <Text>Item 6</Text>
                </Flex>
                <Separator label="CENTERED" align="start" />
                <Flex justifyContent="center" alignItems="center" height="100px" background="bg.brand.subtle" borderRadius="md">
                    <Text>Centered!</Text>
                </Flex>
                <Separator label="NESTED" align="start" />
                <Flex direction="row" gap="4" padding="4" background="bg.subtle" borderRadius="md">
                    <Flex direction="column" gap="1" padding="2" background="bg.warning.subtle" borderRadius="sm">
                        <Text>A</Text>
                        <Text>B</Text>
                    </Flex>
                    <Flex direction="column" gap="1" padding="2" background="bg.warning.subtle" borderRadius="sm">
                        <Text>C</Text>
                        <Text>D</Text>
                    </Flex>
                </Flex>
                <Separator label="ALIGN ITEMS" align="start" />
                <Flex direction="row" gap="2">
                    <Flex alignItems="flex-start" height="60px" padding="2" background="bg.subtle" borderRadius="sm">
                        <Text>flex-start</Text>
                    </Flex>
                    <Flex alignItems="center" height="60px" padding="2" background="bg.subtle" borderRadius="sm">
                        <Text>center</Text>
                    </Flex>
                    <Flex alignItems="flex-end" height="60px" padding="2" background="bg.subtle" borderRadius="sm">
                        <Text>flex-end</Text>
                    </Flex>
                </Flex>
                <Separator label="REVERSE" align="start" />
                <Flex direction="row-reverse" gap="4" padding="4" background="bg.brand.subtle" borderRadius="md">
                    <Text>1</Text>
                    <Text>2</Text>
                    <Text>3</Text>
                </Flex>
                <Separator label="INTERACTIVE" align="start" />
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
                            <Flex direction={direction} gap="4" padding="4" background="bg.subtle" borderRadius="md">
                                <Text>A</Text>
                                <Text>B</Text>
                                <Text>C</Text>
                            </Flex>
                            <Button onClick={inc}>Toggle direction</Button>
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

export const flexFillScroll = example({
    keywords: ["Flex", "fill", "scroll", "scrollY", "column", "bounded", "sizing", "height"],
    description: "A column Flex bounded to a fixed height (#320): a non-shrinking toolbar row above a `fill scrollY` body that consumes the remainder and scrolls — the `flex:1 + min-height:0 + overflow` incantation as declarative props",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Flex direction="column" height="220px" width="260px">
                <Flex background="bg.subtle" padding="3"><Text>Toolbar</Text></Flex>
                <Flex fill scrollY direction="column" gap="2" padding="3">
                    {Array.from({ length: 20 }, (_, i) => <Text>{`Row ${i + 1}`}</Text>)}
                </Flex>
            </Flex>
        );
    }),
    inputs: [],
});
