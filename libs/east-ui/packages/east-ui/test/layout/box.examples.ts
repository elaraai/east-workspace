/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Box, Text, Style, UIComponentType } from "../../src/index.js";

export const boxBasic = example({
    keywords: ["Box", "Root", "basic", "container"],
    description: "Simple container with no styling",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Text.Root("Content inside a basic box"),
        ]);
    }),
    inputs: [],
});

export const boxStyled = example({
    keywords: ["Box", "Root", "padding", "background", "borderRadius", "color"],
    description: "Box with background, padding, and border radius",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Text.Root("Styled container content"),
        ], {
            padding: "4",
            background: "blue.50",
            color: "blue.800",
            borderRadius: "md",
        });
    }),
    inputs: [],
});

export const boxFlexRow = example({
    keywords: ["Box", "Root", "flex", "row", "justifyContent", "alignItems"],
    description: "Horizontal flex container with gap",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Text.Root("Item 1"),
            Text.Root("Item 2"),
            Text.Root("Item 3"),
        ], {
            display: Style.Display("flex"),
            flexDirection: Style.FlexDirection("row"),
            justifyContent: Style.JustifyContent("space-between"),
            alignItems: Style.AlignItems("center"),
            gap: "4",
            padding: "4",
            background: "gray.100",
            borderRadius: "md",
        });
    }),
    inputs: [],
});

export const boxFlexColumn = example({
    keywords: ["Box", "Root", "flex", "column", "vertical"],
    description: "Vertical flex container with items centered",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Text.Root("Top"),
            Text.Root("Middle"),
            Text.Root("Bottom"),
        ], {
            display: Style.Display("flex"),
            flexDirection: Style.FlexDirection("column"),
            justifyContent: Style.JustifyContent("space-around"),
            alignItems: Style.AlignItems("center"),
            height: "150px",
            padding: "4",
            background: "purple.50",
            color: "purple.800",
            borderRadius: "lg",
        });
    }),
    inputs: [],
});

export const boxFixed = example({
    keywords: ["Box", "Root", "width", "height", "fixed", "dimensions"],
    description: "Box with explicit width and height",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Text.Root("200x100 box"),
        ], {
            display: Style.Display("flex"),
            width: "200px",
            height: "100px",
            justifyContent: Style.JustifyContent("center"),
            alignItems: Style.AlignItems("center"),
            background: "teal.100",
            color: "teal.800",
            borderRadius: "sm",
        });
    }),
    inputs: [],
});

export const boxNested = example({
    keywords: ["Box", "Root", "nested", "container"],
    description: "Box containing another styled box",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Box.Root([
                Text.Root("Inner box"),
            ], {
                padding: "2",
                background: "blue.100",
                borderRadius: "sm",
            }),
        ], {
            padding: "4",
            background: "gray.100",
            borderRadius: "md",
        });
    }),
    inputs: [],
});

export const boxBorders = example({
    keywords: ["Box", "Root", "border", "borderColor", "borderWidth", "solid", "dashed"],
    description: "Box with border, borderColor, and borderWidth",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Box.Root([
                Text.Root("Solid border"),
            ], {
                padding: "4",
                border: "2px solid",
                borderColor: "blue.500",
                borderRadius: "md",
            }),
            Box.Root([
                Text.Root("Dashed border"),
            ], {
                padding: "4",
                border: "2px dashed",
                borderColor: "green.500",
                borderRadius: "md",
            }),
            Box.Root([
                Text.Root("Custom width"),
            ], {
                padding: "4",
                borderWidth: "4px",
                borderColor: "red.500",
                background: "red.50",
                borderRadius: "lg",
            }),
        ], {
            display: Style.Display("flex"),
            gap: "4",
        });
    }),
    inputs: [],
});

export const boxJustify = example({
    keywords: ["Box", "Root", "justifyContent", "flex-start", "center", "flex-end"],
    description: "Different justify-content values",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Box.Root([Text.Root("start")], {
                display: Style.Display("flex"),
                justifyContent: Style.JustifyContent("flex-start"),
                padding: "2",
                background: "green.100",
                borderRadius: "sm",
            }),
            Box.Root([Text.Root("center")], {
                display: Style.Display("flex"),
                justifyContent: Style.JustifyContent("center"),
                padding: "2",
                background: "green.100",
                borderRadius: "sm",
            }),
            Box.Root([Text.Root("end")], {
                display: Style.Display("flex"),
                justifyContent: Style.JustifyContent("flex-end"),
                padding: "2",
                background: "green.100",
                borderRadius: "sm",
            }),
        ], {
            display: Style.Display("flex"),
            flexDirection: Style.FlexDirection("column"),
            gap: "2",
        });
    }),
    inputs: [],
});
