/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Code, Stack, UIComponentType } from "../../src/index.js";

export const codeBasic = example({
    keywords: ["Code", "Root", "basic", "inline"],
    description: "Plain inline code snippet",
    fn: East.function([], UIComponentType, (_$) => {
        return Code.Root("const x = 1");
    }),
    inputs: [],
});

export const codeSubtle = example({
    keywords: ["Code", "Root", "variant", "subtle"],
    description: "Code with subtle background",
    fn: East.function([], UIComponentType, (_$) => {
        return Code.Root("npm install", { variant: "subtle" });
    }),
    inputs: [],
});

export const codeSurface = example({
    keywords: ["Code", "Root", "variant", "surface"],
    description: "Code with surface styling",
    fn: East.function([], UIComponentType, (_$) => {
        return Code.Root("npm run build", { variant: "surface" });
    }),
    inputs: [],
});

export const codeOutline = example({
    keywords: ["Code", "Root", "variant", "outline"],
    description: "Code with outline border",
    fn: East.function([], UIComponentType, (_$) => {
        return Code.Root("npm test", { variant: "outline" });
    }),
    inputs: [],
});

export const codeSizes = example({
    keywords: ["Code", "Root", "size", "xs", "sm", "md", "lg"],
    description: "Different code sizes",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Code.Root("xs", { size: "xs" }),
            Code.Root("sm", { size: "sm" }),
            Code.Root("md", { size: "md" }),
            Code.Root("lg", { size: "lg" }),
        ], { gap: "4" });
    }),
    inputs: [],
});

export const codeColors = example({
    keywords: ["Code", "Root", "colorPalette", "gray", "blue", "green", "red"],
    description: "Code with different color schemes",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Code.Root("gray", { variant: "subtle", colorPalette: "gray" }),
            Code.Root("blue", { variant: "subtle", colorPalette: "blue" }),
            Code.Root("green", { variant: "subtle", colorPalette: "green" }),
            Code.Root("red", { variant: "subtle", colorPalette: "red" }),
        ], { gap: "3" });
    }),
    inputs: [],
});

export const codeCombined = example({
    keywords: ["Code", "Root", "combined", "variant", "colorPalette", "size"],
    description: "Code with multiple style options",
    fn: East.function([], UIComponentType, (_$) => {
        return Code.Root("console.log('Hello')", {
            variant: "surface",
            colorPalette: "purple",
            size: "md",
        });
    }),
    inputs: [],
});
