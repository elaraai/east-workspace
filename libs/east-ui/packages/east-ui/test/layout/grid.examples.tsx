/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Grid, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const gridBasic = example({
    keywords: ["Grid", "Root", "Item", "templateColumns", "repeat", "basic"],
    description: "Equal-width columns with gap",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Grid
                items={[
                    Grid.Item(<Box padding="2" background="blue.100" borderRadius="sm"><Text>1</Text></Box>),
                    Grid.Item(<Box padding="2" background="blue.100" borderRadius="sm"><Text>2</Text></Box>),
                    Grid.Item(<Box padding="2" background="blue.100" borderRadius="sm"><Text>3</Text></Box>),
                    Grid.Item(<Box padding="2" background="blue.100" borderRadius="sm"><Text>4</Text></Box>),
                    Grid.Item(<Box padding="2" background="blue.100" borderRadius="sm"><Text>5</Text></Box>),
                    Grid.Item(<Box padding="2" background="blue.100" borderRadius="sm"><Text>6</Text></Box>),
                ]}
                templateColumns="repeat(3, 1fr)"
                gap="3"
            />
        );
    }),
    inputs: [],
});

// ============================================================================
// Grid — spans, gaps, templates, flow, named areas (variant panel)
// ============================================================================

export const gridVariants = example({
    keywords: ["Grid", "Root", "Item", "colSpan", "span", "columnGap", "rowGap", "gap", "templateColumns", "fixed", "px", "templateRows", "justifyItems", "alignItems", "centered", "auto-fit", "minmax", "responsive", "autoFlow", "dense", "packing", "header", "area", "templateAreas", "named-areas", "layout", "Reactive", "State", "interactive", "counter"],
    description: "Grid variant panel — col span (item spanning multiple columns), gaps (separate column and row gaps), fixed widths (columns with specific pixel widths), centered (content centered in cells), responsive (auto-fit with minmax), dense (auto-flow with dense algorithm), full width (header spanning all columns), named areas (templateAreas + per-item area names in a classic Head/Nav/Main layout), interactive (cell labels update from a counter)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">COL SPAN</Text>
                    <Grid
                        items={[
                            Grid.Item(<Box padding="2" background="green.100" borderRadius="sm"><Text>Spans 2 columns</Text></Box>, { colSpan: "2" }),
                            Grid.Item(<Box padding="2" background="green.100" borderRadius="sm"><Text>One</Text></Box>),
                            Grid.Item(<Box padding="2" background="green.100" borderRadius="sm"><Text>Two</Text></Box>),
                            Grid.Item(<Box padding="2" background="green.100" borderRadius="sm"><Text>Three</Text></Box>),
                            Grid.Item(<Box padding="2" background="green.100" borderRadius="sm"><Text>Four</Text></Box>),
                        ]}
                        templateColumns="repeat(3, 1fr)"
                        gap="3"
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">GAPS</Text>
                    <Grid
                        items={[
                            Grid.Item(<Box padding="2" background="purple.100" borderRadius="sm"><Text>A</Text></Box>),
                            Grid.Item(<Box padding="2" background="purple.100" borderRadius="sm"><Text>B</Text></Box>),
                            Grid.Item(<Box padding="2" background="purple.100" borderRadius="sm"><Text>C</Text></Box>),
                            Grid.Item(<Box padding="2" background="purple.100" borderRadius="sm"><Text>D</Text></Box>),
                        ]}
                        templateColumns="repeat(2, 1fr)"
                        columnGap="8"
                        rowGap="2"
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FIXED WIDTHS</Text>
                    <Grid
                        items={[
                            Grid.Item(<Box padding="2" background="orange.100" borderRadius="sm"><Text>100px</Text></Box>),
                            Grid.Item(<Box padding="2" background="orange.100" borderRadius="sm"><Text>200px</Text></Box>),
                            Grid.Item(<Box padding="2" background="orange.100" borderRadius="sm"><Text>100px</Text></Box>),
                        ]}
                        templateColumns="100px 200px 100px"
                        gap="4"
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">CENTERED</Text>
                    <Grid
                        items={[
                            Grid.Item(<Box padding="2" background="teal.100" borderRadius="sm"><Text>1</Text></Box>),
                            Grid.Item(<Box padding="2" background="teal.100" borderRadius="sm"><Text>2</Text></Box>),
                            Grid.Item(<Box padding="2" background="teal.100" borderRadius="sm"><Text>3</Text></Box>),
                            Grid.Item(<Box padding="2" background="teal.100" borderRadius="sm"><Text>4</Text></Box>),
                        ]}
                        templateColumns="repeat(2, 100px)"
                        templateRows="repeat(2, 60px)"
                        gap="4"
                        justifyItems="center"
                        alignItems="center"
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RESPONSIVE</Text>
                    <Grid
                        items={[
                            Grid.Item(<Box padding="3" background="cyan.100" borderRadius="sm"><Text>Item 1</Text></Box>),
                            Grid.Item(<Box padding="3" background="cyan.100" borderRadius="sm"><Text>Item 2</Text></Box>),
                            Grid.Item(<Box padding="3" background="cyan.100" borderRadius="sm"><Text>Item 3</Text></Box>),
                            Grid.Item(<Box padding="3" background="cyan.100" borderRadius="sm"><Text>Item 4</Text></Box>),
                        ]}
                        templateColumns="repeat(auto-fit, minmax(80px, 1fr))"
                        gap="3"
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">DENSE</Text>
                    <Grid
                        items={[
                            Grid.Item(<Box padding="2" background="pink.100" borderRadius="sm"><Text>Wide</Text></Box>, { colSpan: "2" }),
                            Grid.Item(<Box padding="2" background="pink.100" borderRadius="sm"><Text>A</Text></Box>),
                            Grid.Item(<Box padding="2" background="pink.100" borderRadius="sm"><Text>B</Text></Box>),
                            Grid.Item(<Box padding="2" background="pink.100" borderRadius="sm"><Text>C</Text></Box>),
                        ]}
                        templateColumns="repeat(3, 1fr)"
                        gap="2"
                        autoFlow="row dense"
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FULL WIDTH</Text>
                    <Grid
                        items={[
                            Grid.Item(<Box padding="3" background="gray.200" borderRadius="sm"><Text>Full Width Header</Text></Box>, { colSpan: "3" }),
                            Grid.Item(<Box padding="2" background="gray.100" borderRadius="sm"><Text>Col 1</Text></Box>),
                            Grid.Item(<Box padding="2" background="gray.100" borderRadius="sm"><Text>Col 2</Text></Box>),
                            Grid.Item(<Box padding="2" background="gray.100" borderRadius="sm"><Text>Col 3</Text></Box>),
                        ]}
                        templateColumns="repeat(3, 1fr)"
                        gap="3"
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">NAMED AREAS</Text>
                    <Grid
                        items={[
                            Grid.Item(<Box padding="2" background="blue.100" borderRadius="sm"><Text>Head</Text></Box>, { area: "head" }),
                            Grid.Item(<Box padding="2" background="green.100" borderRadius="sm"><Text>Nav</Text></Box>, { area: "nav" }),
                            Grid.Item(<Box padding="2" background="purple.100" borderRadius="sm"><Text>Main</Text></Box>, { area: "main" }),
                        ]}
                        templateAreas='"head head" "nav main"'
                        templateColumns="120px 1fr"
                        templateRows="auto 1fr"
                        gap="3"
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">INTERACTIVE</Text>
                    <Reactive>{$ => {
                        const counter = $.let(State.bind([IntegerType], "grid_counter", 0n));
                        const value = $.let(counter.read());
                        const inc = $.const(East.function([], NullType, $ => {
                            const cur = $.let(counter.read());
                            $(counter.write(cur.add(1n)));
                        }));
                        return (
                            <VStack gap="3" align="stretch">
                                <Grid
                                    items={[
                                        Grid.Item(<Box padding="2" background="blue.100" borderRadius="sm"><Text>{East.str`Cell A — ${East.print(value)}`}</Text></Box>),
                                        Grid.Item(<Box padding="2" background="green.100" borderRadius="sm"><Text>{East.str`Cell B — ${East.print(value)}`}</Text></Box>),
                                        Grid.Item(<Box padding="2" background="purple.100" borderRadius="sm"><Text>{East.str`Cell C — ${East.print(value)}`}</Text></Box>),
                                    ]}
                                    templateColumns="repeat(3, 1fr)"
                                    gap="3"
                                />
                                <Button onClick={inc}>Bump</Button>
                            </VStack>
                        );
                    }}</Reactive>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
