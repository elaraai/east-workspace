/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Text, VStack, HStack, Stat, Reactive } from "@elaraai/east-ui";

export const buttonBasic = example({
    keywords: ["Button", "Root", "label", "basic", "create"],
    description: "Create a simple button with a text label",
    fn: East.function([], UIComponentType, (_$) => {
        return <Button>Click me</Button>;
    }),
    inputs: [],
});

export const buttonSolidVariant = example({
    keywords: ["Button", "Root", "variant", "solid", "colorPalette", "blue", "size"],
    description: "Create a solid blue primary action button with size",
    fn: East.function([], UIComponentType, (_$) => {
        return <Button variant="solid" colorPalette="blue" size="md">Save Changes</Button>;
    }),
    inputs: [],
});

export const buttonDangerOutline = example({
    keywords: ["Button", "Root", "variant", "outline", "ghost", "colorPalette", "red", "danger"],
    description: "Create danger and secondary action buttons with outline and ghost variants",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2">
                <Button variant="solid" colorPalette="red">Delete</Button>
                <Button variant="outline" colorPalette="gray">Cancel</Button>
                <Button variant="ghost" size="sm">More</Button>
            </HStack>
        );
    }),
    inputs: [],
});

export const buttonReactiveCounter = example({
    keywords: ["Button", "Root", "onClick", "Reactive", "State", "callback", "interactive", "counter"],
    description: "Reactive counter with increment/decrement buttons using onClick callbacks and State",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
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

            return (
                <VStack gap="4">
                    <Stat label="Count" value={East.print(count)} />
                    <HStack gap="2">
                        <Button onClick={decrement} variant="solid" colorPalette="red">-</Button>
                        <Button onClick={increment} variant="solid" colorPalette="blue">+</Button>
                    </HStack>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// -----------------------------------------------------------------------------
// Plan 1.4 new examples
// -----------------------------------------------------------------------------

export const buttonWithIcons = example({
    keywords: ["Button", "Root", "startIcon", "endIcon", "icon"],
    description: "Button with start + end icons (Save · ⏎)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Button
                startIcon={{ prefix: "fas", name: "save" }}
                endIcon={{ prefix: "fas", name: "arrow-right" }}
                variant="solid"
                colorPalette="blue"
            >
                Save
            </Button>
        );
    }),
    inputs: [],
});

export const buttonLoading = example({
    keywords: ["Button", "Root", "loading", "loadingText", "loadingIcon", "spinner"],
    description: "Loading button with custom loadingText + loadingIcon swap",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Button
                loading
                loadingText="Submitting…"
                loadingIcon={{ prefix: "fas", name: "spinner" }}
                variant="solid"
                colorPalette="blue"
            >
                Submit
            </Button>
        );
    }),
    inputs: [],
});

export const buttonRichLabel = example({
    keywords: ["Button", "Root", "label", "rich", "UIComp", "HStack"],
    description: "Button whose label is an HStack of Text children (primary + muted caption)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Button variant="solid" colorPalette="green">
                <HStack gap="1" align="center">
                    <Text>Accept</Text>
                    <Text color="whiteAlpha.700">→ log to MES</Text>
                </HStack>
            </Button>
        );
    }),
    inputs: [],
});

export const buttonGhost = example({
    keywords: ["Button", "Root", "variant", "ghost", "escape-hatch", "color", "hoverBackground"],
    description: "Ghost button with full colour escape hatches (color + hoverBackground)",
    fn: East.function([], UIComponentType, (_$) => {
        return <Button variant="ghost" color="#3d5cff" hoverBackground="#eef2ff">View details</Button>;
    }),
    inputs: [],
});

export const buttonPlain = example({
    keywords: ["Button", "Root", "variant", "plain", "unadorned"],
    description: "Plain variant — unadorned pressable text",
    fn: East.function([], UIComponentType, (_$) => {
        return <Button variant="plain" colorPalette="blue">Learn more</Button>;
    }),
    inputs: [],
});

export const buttonBrandedColours = example({
    keywords: ["Button", "Root", "style", "color", "background", "borderColor", "branded"],
    description: "Branded button with hex colour escape hatches on style",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Button
                startIcon={{ prefix: "fas", name: "rocket" }}
                color="#ffffff"
                background="#1a2234"
                borderColor="#3d5cff"
                hoverBackground="#25345a"
            >
                Deploy
            </Button>
        );
    }),
    inputs: [],
});
