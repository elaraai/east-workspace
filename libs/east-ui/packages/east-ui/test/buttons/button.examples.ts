/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Button, Text, Stack, Stat, Reactive, State, UIComponentType } from "@elaraai/east-ui";

export const buttonBasic = example({
    keywords: ["Button", "Root", "label", "basic", "create"],
    description: "Create a simple button with a text label",
    fn: East.function([], UIComponentType, (_$) => {
        return Button.Root("Click me");
    }),
    inputs: [],
});

export const buttonSolidVariant = example({
    keywords: ["Button", "Root", "variant", "solid", "colorPalette", "blue", "size"],
    description: "Create a solid blue primary action button with size",
    fn: East.function([], UIComponentType, (_$) => {
        return Button.Root("Save Changes", {
            style: { variant: "solid", colorPalette: "blue", size: "md" },
        });
    }),
    inputs: [],
});

export const buttonDangerOutline = example({
    keywords: ["Button", "Root", "variant", "outline", "ghost", "colorPalette", "red", "danger"],
    description: "Create danger and secondary action buttons with outline and ghost variants",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Button.Root("Delete", { style: { variant: "solid", colorPalette: "red" } }),
            Button.Root("Cancel", { style: { variant: "outline", colorPalette: "gray" } }),
            Button.Root("More",   { style: { variant: "ghost", size: "sm" } }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const buttonReactiveCounter = example({
    keywords: ["Button", "Root", "onClick", "Reactive", "State", "callback", "interactive", "counter"],
    description: "Reactive counter with increment/decrement buttons using onClick callbacks and State",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "counter", 0n));
            const count = $.let(counter.read());

            const increment = $.const(East.function([], NullType, $ => {
                const current = $.let(counter.read());
                $(counter.write(current.add(1n)));
            }));

            const decrement = $.const(East.function([], NullType, $ => {
                const current = $.let(counter.read());
                $(counter.write(current.subtract(1n)));
            }));

            return Stack.VStack([
                Stat.Root("Count", Text.Root(East.print(count))),
                Stack.HStack([
                    Button.Root("-", { onClick: decrement, style: { variant: "solid", colorPalette: "red" } }),
                    Button.Root("+", { onClick: increment, style: { variant: "solid", colorPalette: "blue" } }),
                ], { gap: "2" }),
            ], { gap: "4" });
        }));
    }),
    inputs: [],
});

// -----------------------------------------------------------------------------
// Plan 1.4 new examples
// -----------------------------------------------------------------------------

export const buttonWithIcons = example({
    keywords: ["Button", "Root", "startIcon", "endIcon", "icon"],
    description: "Button with start + end icons (Save · ⏎)",
    fn: East.function([], UIComponentType, (_$) => {
        return Button.Root("Save", {
            startIcon: { prefix: "fas", name: "save" },
            endIcon: { prefix: "fas", name: "arrow-right" },
            style: { variant: "solid", colorPalette: "blue" },
        });
    }),
    inputs: [],
});

export const buttonLoading = example({
    keywords: ["Button", "Root", "loading", "loadingText", "loadingIcon", "spinner"],
    description: "Loading button with custom loadingText + loadingIcon swap",
    fn: East.function([], UIComponentType, (_$) => {
        return Button.Root("Submit", {
            loading: true,
            loadingText: "Submitting…",
            loadingIcon: { prefix: "fas", name: "spinner" },
            style: { variant: "solid", colorPalette: "blue" },
        });
    }),
    inputs: [],
});

export const buttonRichLabel = example({
    keywords: ["Button", "Root", "label", "rich", "UIComp", "HStack"],
    description: "Button whose label is an HStack of Text children (primary + muted caption)",
    fn: East.function([], UIComponentType, (_$) => {
        return Button.Root(
            Stack.HStack([
                Text.Root("Accept"),
                Text.Root("→ log to MES", { color: "fg.muted" }),
            ], { gap: "1", align: "center" }),
            { style: { variant: "solid", colorPalette: "green" } },
        );
    }),
    inputs: [],
});

export const buttonGhost = example({
    keywords: ["Button", "Root", "variant", "ghost", "escape-hatch", "color", "hoverBackground"],
    description: "Ghost button with full colour escape hatches (color + hoverBackground)",
    fn: East.function([], UIComponentType, (_$) => {
        return Button.Root("View details", {
            style: {
                variant: "ghost",
                color: "#3d5cff",
                hoverBackground: "#eef2ff",
            },
        });
    }),
    inputs: [],
});

export const buttonPlain = example({
    keywords: ["Button", "Root", "variant", "plain", "unadorned"],
    description: "Plain variant — unadorned pressable text",
    fn: East.function([], UIComponentType, (_$) => {
        return Button.Root("Learn more", { style: { variant: "plain", colorPalette: "blue" } });
    }),
    inputs: [],
});

export const buttonBrandedColours = example({
    keywords: ["Button", "Root", "style", "color", "background", "borderColor", "branded"],
    description: "Branded button with hex colour escape hatches on style",
    fn: East.function([], UIComponentType, (_$) => {
        return Button.Root("Deploy", {
            startIcon: { prefix: "fas", name: "rocket" },
            style: {
                color: "#ffffff",
                background: "#1a2234",
                borderColor: "#3d5cff",
                hoverBackground: "#25345a",
            },
        });
    }),
    inputs: [],
});
