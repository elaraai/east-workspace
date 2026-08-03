/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Separator, Text, VStack, HStack, Stat, Reactive } from "@elaraai/east-ui";

export const buttonBasic = example({
    keywords: ["Button", "Root", "label", "basic", "create"],
    description: "Create a simple button with a text label",
    fn: East.function([], UIComponentType, (_$) => {
        return <Button>Click me</Button>;
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
                        <Button onClick={decrement} variant="solid" colorPalette="danger">-</Button>
                        <Button onClick={increment} variant="solid" colorPalette="brand">+</Button>
                    </HStack>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Variants — static enumeration panel (consolidation epic #455).
// ============================================================================

export const buttonVariants = example({
    keywords: ["Button", "Root", "variant", "solid", "colorPalette", "blue", "size", "outline", "ghost", "red", "danger", "escape-hatch", "color", "hoverBackground", "plain", "unadorned", "style", "background", "borderColor", "branded", "startIcon", "endIcon", "icon", "loading", "loadingText", "loadingIcon", "spinner", "label", "rich", "UIComp", "HStack"],
    description: "Button variant panel — solid variant (solid blue primary action with size), danger outline (danger + secondary actions with outline and ghost variants), ghost (full colour escape hatches: color + hoverBackground), plain (unadorned pressable text), branded colours (hex colour escape hatches on style), with icons (Save · ⏎), loading (custom loadingText + loadingIcon swap), rich label (an HStack of Text children — primary + muted caption)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="SOLID VARIANT" align="start" />
                <Button variant="solid" colorPalette="brand" size="md">Save Changes</Button>
                <Separator label="DANGER OUTLINE" align="start" />
                <HStack gap="2">
                    <Button variant="solid" colorPalette="danger">Delete</Button>
                    <Button variant="outline" colorPalette="gray">Cancel</Button>
                    <Button variant="ghost" size="sm">More</Button>
                </HStack>
                <Separator label="GHOST" align="start" />
                <Button variant="ghost" color="link" hoverBackground="bg.brand.subtle">View details</Button>
                <Separator label="PLAIN" align="start" />
                <Button variant="plain" colorPalette="brand">Learn more</Button>
                <Separator label="BRANDED COLOURS" align="start" />
                <Button
                    startIcon={{ prefix: "fas", name: "rocket" }}
                    color="fg.inverse"
                    background="bg.inverse"
                    borderColor="border.brand"
                    hoverBackground="bg.inverse"
                >
                    Deploy
                </Button>
                <Separator label="WITH ICONS" align="start" />
                <Button
                    startIcon={{ prefix: "fas", name: "save" }}
                    endIcon={{ prefix: "fas", name: "arrow-right" }}
                    variant="solid"
                    colorPalette="brand"
                >
                    Save
                </Button>
                <Separator label="LOADING" align="start" />
                <Button
                    loading
                    loadingText="Submitting…"
                    loadingIcon={{ prefix: "fas", name: "spinner" }}
                    variant="solid"
                    colorPalette="brand"
                >
                    Submit
                </Button>
                <Separator label="RICH LABEL" align="start" />
                <Button variant="solid" colorPalette="success">
                    <HStack gap="1" align="center">
                        <Text>Accept</Text>
                        <Text color="fg.inverse">→ log to MES</Text>
                    </HStack>
                </Button>
            </VStack>
        );
    }),
    inputs: [],
});
