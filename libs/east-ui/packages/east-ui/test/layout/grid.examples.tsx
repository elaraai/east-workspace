/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Grid, Separator, Text, VStack, Reactive } from "@elaraai/east-ui";

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
                    Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>1</Text></Box>),
                    Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>2</Text></Box>),
                    Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>3</Text></Box>),
                    Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>4</Text></Box>),
                    Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>5</Text></Box>),
                    Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>6</Text></Box>),
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
                <Separator label="COL SPAN" align="start" />
                <Grid
                    items={[
                        Grid.Item(<Box padding="2" background="bg.success.subtle" borderRadius="sm"><Text>Spans 2 columns</Text></Box>, { colSpan: "2" }),
                        Grid.Item(<Box padding="2" background="bg.success.subtle" borderRadius="sm"><Text>One</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.success.subtle" borderRadius="sm"><Text>Two</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.success.subtle" borderRadius="sm"><Text>Three</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.success.subtle" borderRadius="sm"><Text>Four</Text></Box>),
                    ]}
                    templateColumns="repeat(3, 1fr)"
                    gap="3"
                />
                <Separator label="GAPS" align="start" />
                <Grid
                    items={[
                        Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>A</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>B</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>C</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>D</Text></Box>),
                    ]}
                    templateColumns="repeat(2, 1fr)"
                    columnGap="8"
                    rowGap="2"
                />
                <Separator label="FIXED WIDTHS" align="start" />
                <Grid
                    items={[
                        Grid.Item(<Box padding="2" background="bg.warning.subtle" borderRadius="sm"><Text>100px</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.warning.subtle" borderRadius="sm"><Text>200px</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.warning.subtle" borderRadius="sm"><Text>100px</Text></Box>),
                    ]}
                    templateColumns="100px 200px 100px"
                    gap="4"
                />
                <Separator label="CENTERED" align="start" />
                <Grid
                    items={[
                        Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>1</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>2</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>3</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>4</Text></Box>),
                    ]}
                    templateColumns="repeat(2, 100px)"
                    templateRows="repeat(2, 60px)"
                    gap="4"
                    justifyItems="center"
                    alignItems="center"
                />
                <Separator label="RESPONSIVE" align="start" />
                <Grid
                    items={[
                        Grid.Item(<Box padding="3" background="bg.brand.subtle" borderRadius="sm"><Text>Item 1</Text></Box>),
                        Grid.Item(<Box padding="3" background="bg.brand.subtle" borderRadius="sm"><Text>Item 2</Text></Box>),
                        Grid.Item(<Box padding="3" background="bg.brand.subtle" borderRadius="sm"><Text>Item 3</Text></Box>),
                        Grid.Item(<Box padding="3" background="bg.brand.subtle" borderRadius="sm"><Text>Item 4</Text></Box>),
                    ]}
                    templateColumns="repeat(auto-fit, minmax(80px, 1fr))"
                    gap="3"
                />
                <Separator label="DENSE" align="start" />
                <Grid
                    items={[
                        Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>Wide</Text></Box>, { colSpan: "2" }),
                        Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>A</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>B</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>C</Text></Box>),
                    ]}
                    templateColumns="repeat(3, 1fr)"
                    gap="2"
                    autoFlow="row dense"
                />
                <Separator label="FULL WIDTH" align="start" />
                <Grid
                    items={[
                        Grid.Item(<Box padding="3" background="bg.subtle" borderRadius="sm"><Text>Full Width Header</Text></Box>, { colSpan: "3" }),
                        Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>Col 1</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>Col 2</Text></Box>),
                        Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>Col 3</Text></Box>),
                    ]}
                    templateColumns="repeat(3, 1fr)"
                    gap="3"
                />
                <Separator label="NAMED AREAS" align="start" />
                <Grid
                    items={[
                        Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>Head</Text></Box>, { area: "head" }),
                        Grid.Item(<Box padding="2" background="bg.success.subtle" borderRadius="sm"><Text>Nav</Text></Box>, { area: "nav" }),
                        Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>Main</Text></Box>, { area: "main" }),
                    ]}
                    templateAreas='"head head" "nav main"'
                    templateColumns="120px 1fr"
                    templateRows="auto 1fr"
                    gap="3"
                />
                <Separator label="INTERACTIVE" align="start" />
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
                                    Grid.Item(<Box padding="2" background="bg.brand.subtle" borderRadius="sm"><Text>{East.str`Cell A — ${East.print(value)}`}</Text></Box>),
                                    Grid.Item(<Box padding="2" background="bg.success.subtle" borderRadius="sm"><Text>{East.str`Cell B — ${East.print(value)}`}</Text></Box>),
                                    Grid.Item(<Box padding="2" background="bg.subtle" borderRadius="sm"><Text>{East.str`Cell C — ${East.print(value)}`}</Text></Box>),
                                ]}
                                templateColumns="repeat(3, 1fr)"
                                gap="3"
                            />
                            <Button onClick={inc}>Bump</Button>
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
