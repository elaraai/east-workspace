/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Mark, Stack, Text, UIComponentType } from "../../src/index.js";

export const markBasic = example({
    keywords: ["Mark", "Root", "basic"],
    description: "Simple text mark",
    fn: East.function([], UIComponentType, (_$) => {
        return Mark.Root("Important");
    }),
    inputs: [],
});

export const markSubtle = example({
    keywords: ["Mark", "Root", "variant", "subtle"],
    description: "Soft background highlight",
    fn: East.function([], UIComponentType, (_$) => {
        return Mark.Root("Note", { variant: "subtle" });
    }),
    inputs: [],
});

export const markSolid = example({
    keywords: ["Mark", "Root", "variant", "solid"],
    description: "Strong background fill",
    fn: East.function([], UIComponentType, (_$) => {
        return Mark.Root("NEW", { variant: "solid" });
    }),
    inputs: [],
});

export const markText = example({
    keywords: ["Mark", "Root", "variant", "text"],
    description: "Colored text only",
    fn: East.function([], UIComponentType, (_$) => {
        return Mark.Root("Updated", { variant: "text" });
    }),
    inputs: [],
});

export const markPlain = example({
    keywords: ["Mark", "Root", "variant", "plain"],
    description: "Minimal styling",
    fn: East.function([], UIComponentType, (_$) => {
        return Mark.Root("Plain", { variant: "plain" });
    }),
    inputs: [],
});

export const markColors = example({
    keywords: ["Mark", "Root", "colorPalette", "yellow", "green", "blue", "red", "purple"],
    description: "Different color schemes",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Mark.Root("Yellow", { variant: "subtle", colorPalette: "yellow" }),
            Mark.Root("Green", { variant: "subtle", colorPalette: "green" }),
            Mark.Root("Blue", { variant: "subtle", colorPalette: "blue" }),
            Mark.Root("Red", { variant: "subtle", colorPalette: "red" }),
            Mark.Root("Purple", { variant: "subtle", colorPalette: "purple" }),
        ], { gap: "3" });
    }),
    inputs: [],
});

export const markSolidColors = example({
    keywords: ["Mark", "Root", "variant", "solid", "success", "warning", "error", "info"],
    description: "Bold color variants",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Mark.Root("Success", { variant: "solid", colorPalette: "green" }),
            Mark.Root("Warning", { variant: "solid", colorPalette: "orange" }),
            Mark.Root("Error", { variant: "solid", colorPalette: "red" }),
            Mark.Root("Info", { variant: "solid", colorPalette: "blue" }),
        ], { gap: "3" });
    }),
    inputs: [],
});

export const markInContext = example({
    keywords: ["Mark", "Root", "inline", "context", "text"],
    description: "Mark within text flow",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("This feature is "),
            Mark.Root("deprecated", { variant: "subtle", colorPalette: "orange" }),
            Text.Root(" and will be removed."),
        ], { gap: "1" });
    }),
    inputs: [],
});
