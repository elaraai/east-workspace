/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Link, Stack, Text, UIComponentType } from "../../src/index.js";

export const linkBasic = example({
    keywords: ["Link", "Root", "basic", "hyperlink"],
    description: "Simple hyperlink",
    fn: East.function([], UIComponentType, (_$) => {
        return Link.Root("Click here", "/home");
    }),
    inputs: [],
});

export const linkExternal = example({
    keywords: ["Link", "Root", "external", "new tab"],
    description: "Opens in new tab",
    fn: East.function([], UIComponentType, (_$) => {
        return Link.Root("Visit GitHub", "https://github.com", { external: true });
    }),
    inputs: [],
});

export const linkUnderline = example({
    keywords: ["Link", "Root", "variant", "underline"],
    description: "Link with underline decoration",
    fn: East.function([], UIComponentType, (_$) => {
        return Link.Root("Underlined Link", "/about", { variant: "underline" });
    }),
    inputs: [],
});

export const linkPlain = example({
    keywords: ["Link", "Root", "variant", "plain"],
    description: "Link without decoration",
    fn: East.function([], UIComponentType, (_$) => {
        return Link.Root("Plain Link", "/contact", { variant: "plain" });
    }),
    inputs: [],
});

export const linkColors = example({
    keywords: ["Link", "Root", "colorPalette", "blue", "teal", "purple", "red"],
    description: "Links with different colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Link.Root("Blue", "/page", { colorPalette: "blue" }),
            Link.Root("Teal", "/page", { colorPalette: "teal" }),
            Link.Root("Purple", "/page", { colorPalette: "purple" }),
            Link.Root("Red", "/page", { colorPalette: "red" }),
        ], { gap: "4" });
    }),
    inputs: [],
});

export const linkInContext = example({
    keywords: ["Link", "Root", "inline", "context", "text"],
    description: "Link within text flow",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("Read the "),
            Link.Root("documentation", "/docs", { colorPalette: "blue" }),
            Text.Root(" for more info."),
        ], { gap: "1" });
    }),
    inputs: [],
});

export const linkCombined = example({
    keywords: ["Link", "Root", "combined", "external", "variant", "colorPalette"],
    description: "External link with all options",
    fn: East.function([], UIComponentType, (_$) => {
        return Link.Root("View Documentation", "https://docs.example.com", {
            external: true,
            variant: "underline",
            colorPalette: "blue",
        });
    }),
    inputs: [],
});
