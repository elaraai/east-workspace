/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Box, Separator, Stack, Text, UIComponentType } from "../../src/index.js";

export const separatorHorizontal = example({
    keywords: ["Separator", "Root", "orientation", "horizontal"],
    description: "Default horizontal divider",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Text.Root("Content above"),
            Separator.Root({ orientation: "horizontal" }),
            Text.Root("Content below"),
        ], { gap: "3", width: "100%" });
    }),
    inputs: [],
});

export const separatorVertical = example({
    keywords: ["Separator", "Root", "orientation", "vertical"],
    description: "Vertical divider between content",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("Left"),
            Box.Root([
                Separator.Root({ orientation: "vertical" }),
            ], { height: "40px" }),
            Text.Root("Right"),
        ], { gap: "4", align: "center" });
    }),
    inputs: [],
});

export const separatorSolid = example({
    keywords: ["Separator", "Root", "variant", "solid"],
    description: "Solid line separator",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Text.Root("Above"),
            Separator.Root({ variant: "solid" }),
            Text.Root("Below"),
        ], { gap: "3", width: "100%" });
    }),
    inputs: [],
});

export const separatorDashed = example({
    keywords: ["Separator", "Root", "variant", "dashed"],
    description: "Dashed line separator",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Text.Root("Above"),
            Separator.Root({ variant: "dashed" }),
            Text.Root("Below"),
        ], { gap: "3", width: "100%" });
    }),
    inputs: [],
});

export const separatorDotted = example({
    keywords: ["Separator", "Root", "variant", "dotted"],
    description: "Dotted line separator",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Text.Root("Above"),
            Separator.Root({ variant: "dotted" }),
            Text.Root("Below"),
        ], { gap: "3", width: "100%" });
    }),
    inputs: [],
});

export const separatorSizes = example({
    keywords: ["Separator", "Root", "size", "sm", "md", "lg"],
    description: "Small, medium, and large sizes",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Stack.HStack([Text.Root("Small:"), Separator.Root({ size: "sm" })], { gap: "2", width: "100%" }),
            Stack.HStack([Text.Root("Medium:"), Separator.Root({ size: "md" })], { gap: "2", width: "100%" }),
            Stack.HStack([Text.Root("Large:"), Separator.Root({ size: "lg" })], { gap: "2", width: "100%" }),
        ], { gap: "3", width: "100%" });
    }),
    inputs: [],
});

export const separatorLabeled = example({
    keywords: ["Separator", "Root", "label"],
    description: "Separator with centered label",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Text.Root("Sign in with email"),
            Separator.Root({ label: "OR" }),
            Text.Root("Continue with social"),
        ], { gap: "3", width: "100%" });
    }),
    inputs: [],
});

export const separatorColored = example({
    keywords: ["Separator", "Root", "color"],
    description: "Custom color separators",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Separator.Root({ color: "blue.400" }),
            Separator.Root({ color: "green.400" }),
            Separator.Root({ color: "red.400" }),
        ], { gap: "4", width: "100%" });
    }),
    inputs: [],
});

export const separatorFormDivider = example({
    keywords: ["Separator", "Root", "label", "color", "form"],
    description: "Labeled divider for form sections",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Text.Root("Personal Information"),
            Separator.Root({
                label: "Contact Details",
                color: "gray.400",
            }),
            Text.Root("Email and Phone fields..."),
        ], { gap: "3", width: "100%" });
    }),
    inputs: [],
});
