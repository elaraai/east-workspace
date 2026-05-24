/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Badge, Button, Reactive, Stack, State, UIComponentType } from "@elaraai/east-ui";

export const badgeBasic = example({
    keywords: ["Badge", "Root", "basic", "label"],
    description: "Outlined micro-labels for taxonomic markers (NEW, BETA, PRO)",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Badge.Root("New"),
            Badge.Root("Beta"),
            Badge.Root("Pro"),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const badgeVariants = example({
    keywords: ["Badge", "Root", "variant", "brand", "outline", "ok", "warn", "danger"],
    description: "Spec variants — outline (default), brand-tinted, and status hues",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Badge.Root("Outline", { variant: "outline" }),
            Badge.Root("Brand", { variant: "brand" }),
            Badge.Root("OK", { variant: "ok" }),
            Badge.Root("Warn", { variant: "warn" }),
            Badge.Root("Danger", { variant: "danger" }),
        ], { gap: "2", wrap: "wrap" });
    }),
    inputs: [],
});

export const badgeCountCallout = example({
    keywords: ["Badge", "Root", "count", "callout", "pill"],
    description: "Spec pills — count (paper-3) and callout (brand-d), radius-full",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Badge.Root("17", { variant: "count" }),
            Badge.Root("128", { variant: "count" }),
            Badge.Root("NEW", { variant: "callout" }),
        ], { gap: "2", wrap: "wrap" });
    }),
    inputs: [],
});

export const badgeColors = example({
    keywords: ["Badge", "Root", "colorPalette", "escape", "custom"],
    description: "Colour escape hatches — bypass recipe defaults for one-off taxonomy",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Badge.Root("Custom BG", { background: "#ff6b6b", color: "white" }),
            Badge.Root("Dark", { background: "#1a1a2e", color: "#eee" }),
            Badge.Root("Gradient", {
                background: "linear-gradient(90deg, #667eea 0%, #764ba2 100%)",
                color: "white",
            }),
        ], { gap: "2", wrap: "wrap" });
    }),
    inputs: [],
});

export const badgeCustom = example({
    keywords: ["Badge", "Root", "opacity", "background", "color", "custom"],
    description: "Opacity ramp on a brand badge",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Badge.Root("100%", { variant: "brand" }),
            Badge.Root("75%", { variant: "brand", opacity: 0.75 }),
            Badge.Root("50%", { variant: "brand", opacity: 0.5 }),
            Badge.Root("25%", { variant: "brand", opacity: 0.25 }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const badgeFixedWidth = example({
    keywords: ["Badge", "Root", "width", "justifyContent", "count"],
    description: "Equal-width count badges with centred mono numerals",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Badge.Root("3", { width: "48px", justifyContent: "center" }),
            Badge.Root("12", { width: "48px", justifyContent: "center" }),
            Badge.Root("128", { width: "48px", justifyContent: "center" }),
            Badge.Root("4.2K", { width: "48px", justifyContent: "center" }),
        ], { gap: "1" });
    }),
    inputs: [],
});

export const badgeBorder = example({
    keywords: ["Badge", "Root", "borderWidth", "borderStyle", "borderRadius"],
    description: "Custom border styles — solid, dashed, fully rounded",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Badge.Root("Solid", { variant: "outline" }),
            Badge.Root("Dashed", { variant: "outline", borderStyle: "dashed" }),
            Badge.Root("Pill", { variant: "brand", borderRadius: "full" }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const badgeBoxModel = example({
    keywords: ["Badge", "Root", "padding", "width", "borderRadius"],
    description: "Padding, fixed-width, and large-radius escape hatches",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Badge.Root("Padded", { variant: "brand", padding: "3" }),
            Badge.Root("Wide", {
                variant: "outline",
                width: "120px",
                justifyContent: "flex-start",
            }),
            Badge.Root("Rounded", {
                variant: "brand",
                padding: "2",
                borderRadius: "lg",
            }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const badgeInteractive = example({
    keywords: ["Badge", "Reactive", "State", "interactive", "counter"],
    description: "Reactive count badge — increments via Button.onClick",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "badge_counter", 0n));
            const value = $.let(counter.read());
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Badge.Root(East.str`${East.print(value)}`),
                Button.Root("Increment", { onClick: inc }),
            ], { gap: "3", align: "center" });
        }));
    }),
    inputs: [],
});
