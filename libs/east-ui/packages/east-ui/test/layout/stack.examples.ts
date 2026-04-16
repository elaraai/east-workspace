/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Stack, Style, Text, UIComponentType } from "../../src/index.js";

export const stackBasicVStack = example({
    keywords: ["Stack", "VStack", "vertical", "gap"],
    description: "Vertical stack with gap",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Text.Root("First item"),
            Text.Root("Second item"),
            Text.Root("Third item"),
        ], { gap: "3" });
    }),
    inputs: [],
});

export const stackBasicHStack = example({
    keywords: ["Stack", "HStack", "horizontal", "gap"],
    description: "Horizontal stack with gap",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("Left"),
            Text.Root("Center"),
            Text.Root("Right"),
        ], { gap: "4" });
    }),
    inputs: [],
});

export const stackJustifiedHStack = example({
    keywords: ["Stack", "HStack", "justify", "space-between"],
    description: "Items spread across container",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("Start"),
            Text.Root("End"),
        ], {
            gap: "4",
            justify: Style.JustifyContent("space-between"),
            padding: "4",
            background: "gray.100",
            width: "100%",
        });
    }),
    inputs: [],
});

export const stackCentered = example({
    keywords: ["Stack", "VStack", "align", "justify", "center"],
    description: "Items centered horizontally and vertically",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Text.Root("Centered content"),
            Text.Root("Also centered"),
        ], {
            gap: "2",
            align: Style.AlignItems("center"),
            justify: Style.JustifyContent("center"),
            padding: "6",
            background: "blue.50",
            height: "120px",
        });
    }),
    inputs: [],
});

export const stackWrapping = example({
    keywords: ["Stack", "HStack", "wrap", "FlexWrap"],
    description: "Items wrap to next line when needed",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("Tag 1"),
            Text.Root("Tag 2"),
            Text.Root("Tag 3"),
            Text.Root("Tag 4"),
            Text.Root("Tag 5"),
        ], {
            gap: "2",
            wrap: Style.FlexWrap("wrap"),
            padding: "3",
            background: "orange.50",
            width: "200px",
        });
    }),
    inputs: [],
});

export const stackStretched = example({
    keywords: ["Stack", "VStack", "align", "stretch"],
    description: "Items stretched to fill container width",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Text.Root("Full width item 1"),
            Text.Root("Full width item 2"),
        ], {
            gap: "3",
            align: Style.AlignItems("stretch"),
            padding: "4",
            background: "green.50",
        });
    }),
    inputs: [],
});

export const stackNested = example({
    keywords: ["Stack", "VStack", "HStack", "nested"],
    description: "VStack containing HStack",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Stack.HStack([
                Text.Root("Inner 1"),
                Text.Root("Inner 2"),
            ], { gap: "2" }),
            Text.Root("Outer Item"),
        ], {
            gap: "4",
            padding: "4",
            background: "gray.100",
        });
    }),
    inputs: [],
});

export const stackNavbar = example({
    keywords: ["Stack", "HStack", "navbar", "navigation", "logo"],
    description: "Typical nav layout with HStack",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("Logo"),
            Stack.HStack([
                Text.Root("Home"),
                Text.Root("About"),
                Text.Root("Contact"),
            ], { gap: "4" }),
        ], {
            gap: "4",
            justify: Style.JustifyContent("space-between"),
            align: Style.AlignItems("center"),
            padding: "4",
            background: "white",
            width: "100%",
        });
    }),
    inputs: [],
});
