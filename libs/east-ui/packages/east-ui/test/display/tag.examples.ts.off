/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, variant, example } from "@elaraai/east";
import { Reactive, Stack, State, Style, Tag, Text, UIComponentType } from "@elaraai/east-ui";

export const tagBasic = example({
    keywords: ["Tag", "Root", "basic", "filter", "chip"],
    description: "Filter / category chips — outline default, brand when active, dashed for empty",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Tag.Root("region · SE"),
            Tag.Root("cohort · selected", { variant: "brand" }),
            Tag.Root("+ add filter", { variant: "dashed" }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const tagVariants = example({
    keywords: ["Tag", "Root", "variant", "outline", "brand", "subtle", "solid", "dashed"],
    description: "Spec variants — outline (default), brand, subtle, solid, dashed",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Tag.Root("Outline", { variant: "outline" }),
            Tag.Root("Brand", { variant: "brand" }),
            Tag.Root("Subtle", { variant: "subtle" }),
            Tag.Root("Solid", { variant: "solid" }),
            Tag.Root("Dashed", { variant: "dashed" }),
        ], { gap: "2", wrap: "wrap" });
    }),
    inputs: [],
});

export const tagClosable = example({
    keywords: ["Tag", "Root", "closable", "removable"],
    description: "Filter chips set by the operator — always carry a removable ×",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Tag.Root("region · SE", { closable: true, variant: "brand" }),
            Tag.Root("status · active", { closable: true, variant: "brand" }),
            Tag.Root("after 2026-04-01", { closable: true, variant: "brand" }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const tagDynamic = example({
    keywords: ["Tag", "Root", "ifElse", "dynamic", "variant", "Style"],
    description: "Variant resolved dynamically — true → brand, false → outline",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Stack.HStack([
                Tag.Root("True → brand", {
                    variant: East.value(true).ifElse(
                        () => variant("brand", null),
                        () => variant("outline", null)
                    ),
                }),
                Tag.Root("False → outline", {
                    variant: East.value(false).ifElse(
                        () => variant("brand", null),
                        () => variant("outline", null)
                    ),
                }),
            ], { gap: "2" }),
            Stack.HStack([
                Tag.Root("Style.StyleVariant solid", { variant: Style.StyleVariant("solid") }),
                Tag.Root("Style.StyleVariant outline", { variant: Style.StyleVariant("outline") }),
            ], { gap: "2" }),
        ], { gap: "3", align: "flex-start" });
    }),
    inputs: [],
});

export const tagCustom = example({
    keywords: ["Tag", "Root", "background", "color", "custom", "escape", "opacity"],
    description: "Opacity ramp on a brand tag, plus colour escape hatches",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Stack.HStack([
                Tag.Root("100%", { variant: "brand" }),
                Tag.Root("75%", { variant: "brand", opacity: 0.75 }),
                Tag.Root("50%", { variant: "brand", opacity: 0.5 }),
                Tag.Root("25%", { variant: "brand", opacity: 0.25 }),
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

export const tagBorder = example({
    keywords: ["Tag", "Root", "borderWidth", "borderStyle", "borderRadius"],
    description: "Border style variations — outlined, pill, dashed",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Tag.Root("Outlined", { variant: "outline" }),
            Tag.Root("Pill", { variant: "brand", borderRadius: "full", padding: "2" }),
            Tag.Root("Dashed", { variant: "dashed" }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const tagBoxModel = example({
    keywords: ["Tag", "Root", "padding", "width", "overflow"],
    description: "Padding, fixed width, full-rounded — all in brand subtle",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Tag.Root("Extra Padding", { padding: "3", variant: "subtle" }),
            Tag.Root("Fixed Width Tag With Longer Text", {
                width: "120px",
                overflow: "hidden",
                variant: "subtle",
            }),
            Tag.Root("Rounded Tag", {
                variant: "brand",
                borderRadius: "full",
                padding: "2",
            }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const tagOnCloseInteractive = example({
    keywords: ["Tag", "Reactive", "State", "interactive", "onClose", "closable"],
    description: "Closable tag whose onClose increments a reactive counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([IntegerType], "tag_close_count", 0n));
            const value = $.let(bind.read());
            const onClose = $.const(East.function([], NullType, $ => {
                const cur = $.let(bind.read());
                $(bind.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Tag.Root("Click × to close", { closable: true, variant: "brand", onClose }),
                Text.Presets.MonoLabel(East.str`CLOSED · ${value}`),
            ], { gap: "3", align: "center" });
        }));
    }),
    inputs: [],
});
