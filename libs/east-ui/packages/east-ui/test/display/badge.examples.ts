/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Badge, Button, Reactive, Stack, State, UIComponentType } from "@elaraai/east-ui";

export const badgeBasic = example({
    keywords: ["Badge", "Root", "basic", "label"],
    description: "Status labels and counts",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Badge.Root("New"),
            Badge.Root("Beta", { colorPalette: "purple" }),
            Badge.Root("Pro", { colorPalette: "blue" }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const badgeVariants = example({
    keywords: ["Badge", "Root", "variant", "solid", "subtle", "outline"],
    description: "Solid, subtle, and outline",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Badge.Root("Solid", { variant: "solid", colorPalette: "green" }),
            Badge.Root("Subtle", { variant: "subtle", colorPalette: "green" }),
            Badge.Root("Outline", { variant: "outline", colorPalette: "green" }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const badgeColors = example({
    keywords: ["Badge", "Root", "colorPalette", "red", "orange", "yellow", "green", "blue", "purple"],
    description: "Various color palettes",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Badge.Root("Red", { colorPalette: "red", variant: "solid" }),
            Badge.Root("Orange", { colorPalette: "orange", variant: "solid" }),
            Badge.Root("Yellow", { colorPalette: "yellow", variant: "solid" }),
            Badge.Root("Green", { colorPalette: "green", variant: "solid" }),
            Badge.Root("Blue", { colorPalette: "blue", variant: "solid" }),
            Badge.Root("Purple", { colorPalette: "purple", variant: "solid" }),
        ], { gap: "2", wrap: "wrap" });
    }),
    inputs: [],
});

export const badgeCustom = example({
    keywords: ["Badge", "Root", "opacity", "background", "color", "custom"],
    description: "Opacity and custom colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Stack.HStack([
                Badge.Root("100%", { colorPalette: "blue", variant: "solid" }),
                Badge.Root("75%", { colorPalette: "blue", variant: "solid", opacity: 0.75 }),
                Badge.Root("50%", { colorPalette: "blue", variant: "solid", opacity: 0.5 }),
                Badge.Root("25%", { colorPalette: "blue", variant: "solid", opacity: 0.25 }),
            ], { gap: "2" }),
            Stack.HStack([
                Badge.Root("Custom BG", { background: "#ff6b6b", color: "white" }),
                Badge.Root("Gradient", { background: "linear-gradient(90deg, #667eea 0%, #764ba2 100%)", color: "white" }),
                Badge.Root("Dark", { background: "#1a1a2e", color: "#eee" }),
            ], { gap: "2" }),
        ], { gap: "3", align: "flex-start" });
    }),
    inputs: [],
});

export const badgeFixedWidth = example({
    keywords: ["Badge", "Root", "width", "justifyContent", "fixed"],
    description: "Equal-width badges with centered text using justifyContent",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Stack.HStack([
                Badge.Root("3", { width: "48px", justifyContent: "center", variant: "solid", colorPalette: "blue" }),
                Badge.Root("12", { width: "48px", justifyContent: "center", variant: "solid", colorPalette: "blue" }),
                Badge.Root("0.9", { width: "48px", justifyContent: "center", variant: "solid", colorPalette: "blue" }),
                Badge.Root("128", { width: "48px", justifyContent: "center", variant: "solid", colorPalette: "blue" }),
            ], { gap: "1" }),
            Stack.HStack([
                Badge.Root("3", { width: "48px", justifyContent: "center", variant: "outline", colorPalette: "green" }),
                Badge.Root("12", { width: "48px", justifyContent: "center", variant: "outline", colorPalette: "green" }),
                Badge.Root("0.9", { width: "48px", justifyContent: "center", variant: "outline", colorPalette: "green" }),
                Badge.Root("128", { width: "48px", justifyContent: "center", variant: "outline", colorPalette: "green" }),
            ], { gap: "1" }),
        ], { gap: "2", align: "flex-start" });
    }),
    inputs: [],
});

export const badgeBorder = example({
    keywords: ["Badge", "Root", "borderWidth", "borderStyle", "borderColor"],
    description: "Custom borders with width, style, and color",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Badge.Root("Outlined", {
                borderWidth: "thin",
                borderStyle: "solid",
                borderColor: "blue.400",
                colorPalette: "blue",
            }),
            Badge.Root("Dashed", {
                borderWidth: "medium",
                borderStyle: "dashed",
                borderColor: "red.400",
                variant: "subtle",
                colorPalette: "red",
            }),
            Badge.Root("Rounded", {
                borderWidth: "thin",
                borderStyle: "solid",
                borderColor: "green.400",
                borderRadius: "full",
                colorPalette: "green",
                variant: "solid",
            }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const badgeBoxModel = example({
    keywords: ["Badge", "Root", "padding", "width", "borderRadius"],
    description: "Padding, margin, and dimension controls",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Badge.Root("Padded", {
                padding: "3",
                colorPalette: "purple",
                variant: "subtle",
            }),
            Badge.Root("Wide", {
                width: "120px",
                colorPalette: "teal",
                variant: "solid",
                justifyContent: "flex-start",
                alignItems: "flex-start",
            }),
            Badge.Root("Custom", {
                padding: "2",
                borderRadius: "lg",
                background: "#2d3748",
                color: "white",
            }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const badgeInteractive = example({
    keywords: ["Badge", "Reactive", "State", "interactive", "counter"],
    description: "Badge whose value increments from a counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "badge_counter", 0n));
            const value = $.let(counter.read());
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Badge.Root(East.str`${East.print(value)}`, { colorPalette: "blue", variant: "solid" }),
                Button.Root("Increment", { onClick: inc }),
            ], { gap: "3", align: "center" });
        }));
    }),
    inputs: [],
});
