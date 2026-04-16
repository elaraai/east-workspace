/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Box, Grid, Style, Text, UIComponentType } from "../../src/index.js";

export const gridBasic3Col = example({
    keywords: ["Grid", "Root", "Item", "templateColumns", "repeat"],
    description: "Equal-width columns with gap",
    fn: East.function([], UIComponentType, (_$) => {
        return Grid.Root([
            Grid.Item(Box.Root([Text.Root("1")], { padding: "2", background: "blue.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("2")], { padding: "2", background: "blue.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("3")], { padding: "2", background: "blue.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("4")], { padding: "2", background: "blue.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("5")], { padding: "2", background: "blue.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("6")], { padding: "2", background: "blue.100", borderRadius: "sm" })),
        ], {
            templateColumns: "repeat(3, 1fr)",
            gap: "3",
        });
    }),
    inputs: [],
});

export const gridColSpan = example({
    keywords: ["Grid", "Root", "Item", "colSpan", "span"],
    description: "Item spanning multiple columns",
    fn: East.function([], UIComponentType, (_$) => {
        return Grid.Root([
            Grid.Item(Box.Root([Text.Root("Spans 2 columns")], { padding: "2", background: "green.100", borderRadius: "sm" }), { colSpan: "2" }),
            Grid.Item(Box.Root([Text.Root("One")], { padding: "2", background: "green.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("Two")], { padding: "2", background: "green.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("Three")], { padding: "2", background: "green.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("Four")], { padding: "2", background: "green.100", borderRadius: "sm" })),
        ], {
            templateColumns: "repeat(3, 1fr)",
            gap: "3",
        });
    }),
    inputs: [],
});

export const gridGaps = example({
    keywords: ["Grid", "Root", "columnGap", "rowGap", "gap"],
    description: "Separate column and row gaps",
    fn: East.function([], UIComponentType, (_$) => {
        return Grid.Root([
            Grid.Item(Box.Root([Text.Root("A")], { padding: "2", background: "purple.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("B")], { padding: "2", background: "purple.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("C")], { padding: "2", background: "purple.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("D")], { padding: "2", background: "purple.100", borderRadius: "sm" })),
        ], {
            templateColumns: "repeat(2, 1fr)",
            columnGap: "8",
            rowGap: "2",
        });
    }),
    inputs: [],
});

export const gridFixedWidths = example({
    keywords: ["Grid", "Root", "templateColumns", "fixed", "px"],
    description: "Columns with specific pixel widths",
    fn: East.function([], UIComponentType, (_$) => {
        return Grid.Root([
            Grid.Item(Box.Root([Text.Root("100px")], { padding: "2", background: "orange.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("200px")], { padding: "2", background: "orange.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("100px")], { padding: "2", background: "orange.100", borderRadius: "sm" })),
        ], {
            templateColumns: "100px 200px 100px",
            gap: "4",
        });
    }),
    inputs: [],
});

export const gridCentered = example({
    keywords: ["Grid", "Root", "templateRows", "justifyItems", "alignItems", "centered"],
    description: "Content centered in cells",
    fn: East.function([], UIComponentType, (_$) => {
        return Grid.Root([
            Grid.Item(Box.Root([Text.Root("1")], { padding: "2", background: "teal.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("2")], { padding: "2", background: "teal.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("3")], { padding: "2", background: "teal.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("4")], { padding: "2", background: "teal.100", borderRadius: "sm" })),
        ], {
            templateColumns: "repeat(2, 100px)",
            templateRows: "repeat(2, 60px)",
            gap: "4",
            justifyItems: Style.JustifyContent("center"),
            alignItems: Style.AlignItems("center"),
        });
    }),
    inputs: [],
});

export const gridResponsive = example({
    keywords: ["Grid", "Root", "templateColumns", "auto-fit", "minmax", "responsive"],
    description: "Auto-fit with minmax",
    fn: East.function([], UIComponentType, (_$) => {
        return Grid.Root([
            Grid.Item(Box.Root([Text.Root("Item 1")], { padding: "3", background: "cyan.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("Item 2")], { padding: "3", background: "cyan.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("Item 3")], { padding: "3", background: "cyan.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("Item 4")], { padding: "3", background: "cyan.100", borderRadius: "sm" })),
        ], {
            templateColumns: "repeat(auto-fit, minmax(80px, 1fr))",
            gap: "3",
        });
    }),
    inputs: [],
});

export const gridDense = example({
    keywords: ["Grid", "Root", "autoFlow", "dense", "packing"],
    description: "Auto-flow with dense algorithm",
    fn: East.function([], UIComponentType, (_$) => {
        return Grid.Root([
            Grid.Item(Box.Root([Text.Root("Wide")], { padding: "2", background: "pink.100", borderRadius: "sm" }), { colSpan: "2" }),
            Grid.Item(Box.Root([Text.Root("A")], { padding: "2", background: "pink.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("B")], { padding: "2", background: "pink.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("C")], { padding: "2", background: "pink.100", borderRadius: "sm" })),
        ], {
            templateColumns: "repeat(3, 1fr)",
            gap: "2",
            autoFlow: "row dense",
        });
    }),
    inputs: [],
});

export const gridFullWidth = example({
    keywords: ["Grid", "Root", "Item", "colSpan", "header"],
    description: "Header spanning all columns",
    fn: East.function([], UIComponentType, (_$) => {
        return Grid.Root([
            Grid.Item(Box.Root([Text.Root("Full Width Header")], { padding: "3", background: "gray.200", borderRadius: "sm" }), { colSpan: "3" }),
            Grid.Item(Box.Root([Text.Root("Col 1")], { padding: "2", background: "gray.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("Col 2")], { padding: "2", background: "gray.100", borderRadius: "sm" })),
            Grid.Item(Box.Root([Text.Root("Col 3")], { padding: "2", background: "gray.100", borderRadius: "sm" })),
        ], {
            templateColumns: "repeat(3, 1fr)",
            gap: "3",
        });
    }),
    inputs: [],
});
