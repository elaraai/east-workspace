/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, variant, example } from "@elaraai/east";
import { Button, Reactive, Stack, State, Style, Tag, UIComponentType } from "@elaraai/east-ui";

export const tagBasic = example({
    keywords: ["Tag", "Root", "basic", "categorization"],
    description: "Categorization labels",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Tag.Root("React"),
            Tag.Root("TypeScript", { colorPalette: "blue" }),
            Tag.Root("Chakra UI", { colorPalette: "teal" }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const tagClosable = example({
    keywords: ["Tag", "Root", "closable", "removable"],
    description: "Tags with close button",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Tag.Root("Removable", { closable: true, colorPalette: "red" }),
            Tag.Root("Delete me", { closable: true, colorPalette: "orange" }),
            Tag.Root("Click X", { closable: true, colorPalette: "blue" }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const tagVariants = example({
    keywords: ["Tag", "Root", "variant", "solid", "subtle", "outline"],
    description: "Solid, subtle, and outline",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Tag.Root("Solid", { variant: "solid", colorPalette: "cyan" }),
            Tag.Root("Subtle", { variant: "subtle", colorPalette: "cyan" }),
            Tag.Root("Outline", { variant: "outline", colorPalette: "cyan" }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const tagCustom = example({
    keywords: ["Tag", "Root", "opacity", "background", "color", "custom"],
    description: "Opacity and custom colors",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Stack.HStack([
                Tag.Root("100%", { colorPalette: "green", variant: "solid" }),
                Tag.Root("75%", { colorPalette: "green", variant: "solid", opacity: 0.75 }),
                Tag.Root("50%", { colorPalette: "green", variant: "solid", opacity: 0.5 }),
                Tag.Root("25%", { colorPalette: "green", variant: "solid", opacity: 0.25 }),
            ], { gap: "2" }),
            Stack.HStack([
                Tag.Root("Custom", { background: "#e74c3c", color: "white" }),
                Tag.Root("Brand", { background: "#3498db", color: "white" }),
                Tag.Root("Dark Mode", { background: "#2c3e50", color: "#ecf0f1" }),
            ], { gap: "2" }),
        ], { gap: "3", align: "flex-start" });
    }),
    inputs: [],
});

export const tagDynamic = example({
    keywords: ["Tag", "Root", "ifElse", "dynamic", "variant", "Style"],
    description: "Variant changing based on condition",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Stack.HStack([
                Tag.Root("True -> solid", {
                    variant: East.value(true).ifElse(
                        () => variant("solid", null),
                        () => variant("outline", null)
                    ),
                    colorPalette: "blue",
                }),
                Tag.Root("False -> outline", {
                    variant: East.value(false).ifElse(
                        () => variant("solid", null),
                        () => variant("outline", null)
                    ),
                    colorPalette: "blue",
                }),
            ], { gap: "2" }),
            Stack.HStack([
                Tag.Root("Style.StyleVariant solid", {
                    variant: Style.StyleVariant("solid"),
                    colorPalette: "green",
                }),
                Tag.Root("Style.StyleVariant outline", {
                    variant: Style.StyleVariant("outline"),
                    colorPalette: "green",
                }),
            ], { gap: "2" }),
        ], { gap: "3", align: "flex-start" });
    }),
    inputs: [],
});

export const tagBorder = example({
    keywords: ["Tag", "Root", "borderWidth", "borderStyle", "borderRadius"],
    description: "Custom borders and border radius",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Tag.Root("Bordered", {
                borderWidth: "thin",
                borderStyle: "solid",
                borderColor: "purple.400",
                colorPalette: "purple",
            }),
            Tag.Root("Pill", {
                borderRadius: "full",
                colorPalette: "cyan",
                variant: "solid",
                padding: "2",
            }),
            Tag.Root("Dashed", {
                borderWidth: "medium",
                borderStyle: "dashed",
                borderColor: "orange.400",
                colorPalette: "orange",
                variant: "subtle",
            }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const tagBoxModel = example({
    keywords: ["Tag", "Root", "padding", "width", "overflow"],
    description: "Padding, width, and overflow",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Tag.Root("Extra Padding", {
                padding: "3",
                colorPalette: "blue",
                variant: "subtle",
            }),
            Tag.Root("Fixed Width Tag With Longer Text", {
                width: "120px",
                overflow: "hidden",
                colorPalette: "red",
                variant: "outline",
            }),
            Tag.Root("Rounded Tag", {
                borderRadius: "full",
                padding: "2",
                background: "#667eea",
                color: "white",
            }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const tagOnCloseInteractive = example({
    keywords: ["Tag", "Reactive", "State", "interactive", "onClose", "closable"],
    description: "Closable Tag whose onClose increments a reactive counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([IntegerType], "tag_close_count", 0n));
            const value = $.let(bind.read());
            const onClose = $.const(East.function([], NullType, $ => {
                const cur = $.let(bind.read());
                $(bind.write(cur.add(1n)));
            }));
            return Stack.HStack([
                Tag.Root("Click X to close", { closable: true, colorPalette: "red", variant: "solid", onClose }),
                Tag.Root(East.str`Closed ${East.print(value)} times`, { colorPalette: "gray" }),
            ], { gap: "3", align: "center" });
        }));
    }),
    inputs: [],
});
