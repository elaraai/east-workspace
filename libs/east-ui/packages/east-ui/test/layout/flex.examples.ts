/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Flex, Text, UIComponentType } from "../../src/index.js";

export const flexBasic = example({
    keywords: ["Flex", "Root", "basic", "row", "gap"],
    description: "Simple flex container (row by default)",
    fn: East.function([], UIComponentType, (_$) => {
        return Flex.Root([
            Text.Root("Item 1"),
            Text.Root("Item 2"),
            Text.Root("Item 3"),
        ], {
            gap: "4",
        });
    }),
    inputs: [],
});

export const flexRowJustify = example({
    keywords: ["Flex", "Root", "direction", "row", "justifyContent", "space-between"],
    description: "Horizontal flex with space-between justification",
    fn: East.function([], UIComponentType, (_$) => {
        return Flex.Root([
            Text.Root("Left"),
            Text.Root("Center"),
            Text.Root("Right"),
        ], {
            direction: "row",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "4",
            background: "blue.50",
            borderRadius: "md",
        });
    }),
    inputs: [],
});

export const flexColumn = example({
    keywords: ["Flex", "Root", "direction", "column", "alignItems"],
    description: "Vertical flex container with centered items",
    fn: East.function([], UIComponentType, (_$) => {
        return Flex.Root([
            Text.Root("Top"),
            Text.Root("Middle"),
            Text.Root("Bottom"),
        ], {
            direction: "column",
            alignItems: "center",
            gap: "2",
            padding: "4",
            background: "purple.50",
            borderRadius: "md",
        });
    }),
    inputs: [],
});

export const flexWrap = example({
    keywords: ["Flex", "Root", "wrap", "responsive"],
    description: "Items wrap to next line when container is too narrow",
    fn: East.function([], UIComponentType, (_$) => {
        return Flex.Root([
            Text.Root("Item 1"),
            Text.Root("Item 2"),
            Text.Root("Item 3"),
            Text.Root("Item 4"),
            Text.Root("Item 5"),
            Text.Root("Item 6"),
        ], {
            wrap: "wrap",
            gap: "2",
            padding: "4",
            background: "green.50",
            borderRadius: "md",
            width: "200px",
        });
    }),
    inputs: [],
});

export const flexCentered = example({
    keywords: ["Flex", "Root", "justifyContent", "alignItems", "center"],
    description: "Both horizontally and vertically centered",
    fn: East.function([], UIComponentType, (_$) => {
        return Flex.Root([
            Text.Root("Centered!"),
        ], {
            justifyContent: "center",
            alignItems: "center",
            height: "100px",
            background: "teal.100",
            borderRadius: "md",
        });
    }),
    inputs: [],
});

export const flexNested = example({
    keywords: ["Flex", "Root", "nested"],
    description: "Flex containers inside flex containers",
    fn: East.function([], UIComponentType, (_$) => {
        return Flex.Root([
            Flex.Root([
                Text.Root("A"),
                Text.Root("B"),
            ], {
                direction: "column",
                gap: "1",
                padding: "2",
                background: "orange.100",
                borderRadius: "sm",
            }),
            Flex.Root([
                Text.Root("C"),
                Text.Root("D"),
            ], {
                direction: "column",
                gap: "1",
                padding: "2",
                background: "orange.100",
                borderRadius: "sm",
            }),
        ], {
            direction: "row",
            gap: "4",
            padding: "4",
            background: "gray.100",
            borderRadius: "md",
        });
    }),
    inputs: [],
});

export const flexAlignItems = example({
    keywords: ["Flex", "Root", "alignItems", "flex-start", "center", "flex-end"],
    description: "Different alignItems values",
    fn: East.function([], UIComponentType, (_$) => {
        return Flex.Root([
            Flex.Root([Text.Root("flex-start")], {
                alignItems: "flex-start",
                height: "60px",
                padding: "2",
                background: "pink.100",
                borderRadius: "sm",
            }),
            Flex.Root([Text.Root("center")], {
                alignItems: "center",
                height: "60px",
                padding: "2",
                background: "pink.100",
                borderRadius: "sm",
            }),
            Flex.Root([Text.Root("flex-end")], {
                alignItems: "flex-end",
                height: "60px",
                padding: "2",
                background: "pink.100",
                borderRadius: "sm",
            }),
        ], {
            direction: "row",
            gap: "2",
        });
    }),
    inputs: [],
});

export const flexReverse = example({
    keywords: ["Flex", "Root", "direction", "row-reverse"],
    description: "Items displayed in reverse order",
    fn: East.function([], UIComponentType, (_$) => {
        return Flex.Root([
            Text.Root("1"),
            Text.Root("2"),
            Text.Root("3"),
        ], {
            direction: "row-reverse",
            gap: "4",
            padding: "4",
            background: "cyan.50",
            borderRadius: "md",
        });
    }),
    inputs: [],
});
