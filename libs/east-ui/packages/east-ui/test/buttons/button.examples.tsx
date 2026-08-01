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

// ============================================================================
// Variants — static enumeration panel (consolidation epic #455).
// ============================================================================

export const buttonVariants = example({
    keywords: ["Button", "Root", "variant", "solid", "colorPalette", "blue", "size", "outline", "ghost", "red", "danger", "escape-hatch", "color", "hoverBackground", "plain", "unadorned", "style", "background", "borderColor", "branded", "startIcon", "endIcon", "icon", "loading", "loadingText", "loadingIcon", "spinner", "label", "rich", "UIComp", "HStack"],
    description: "Button variant panel — solid variant (solid blue primary action with size), danger outline (danger + secondary actions with outline and ghost variants), ghost (full colour escape hatches: color + hoverBackground), plain (unadorned pressable text), branded colours (hex colour escape hatches on style), with icons (Save · ⏎), loading (custom loadingText + loadingIcon swap), rich label (an HStack of Text children — primary + muted caption)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SOLID VARIANT</Text>
                    <Button variant="solid" colorPalette="blue" size="md">Save Changes</Button>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">DANGER OUTLINE</Text>
                    <HStack gap="2">
                        <Button variant="solid" colorPalette="red">Delete</Button>
                        <Button variant="outline" colorPalette="gray">Cancel</Button>
                        <Button variant="ghost" size="sm">More</Button>
                    </HStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">GHOST</Text>
                    <Button variant="ghost" color="#3d5cff" hoverBackground="#eef2ff">View details</Button>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">PLAIN</Text>
                    <Button variant="plain" colorPalette="blue">Learn more</Button>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">BRANDED COLOURS</Text>
                    <Button
                        startIcon={{ prefix: "fas", name: "rocket" }}
                        color="#ffffff"
                        background="#1a2234"
                        borderColor="#3d5cff"
                        hoverBackground="#25345a"
                    >
                        Deploy
                    </Button>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">WITH ICONS</Text>
                    <Button
                        startIcon={{ prefix: "fas", name: "save" }}
                        endIcon={{ prefix: "fas", name: "arrow-right" }}
                        variant="solid"
                        colorPalette="blue"
                    >
                        Save
                    </Button>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">LOADING</Text>
                    <Button
                        loading
                        loadingText="Submitting…"
                        loadingIcon={{ prefix: "fas", name: "spinner" }}
                        variant="solid"
                        colorPalette="blue"
                    >
                        Submit
                    </Button>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RICH LABEL</Text>
                    <Button variant="solid" colorPalette="green">
                        <HStack gap="1" align="center">
                            <Text>Accept</Text>
                            <Text color="whiteAlpha.700">→ log to MES</Text>
                        </HStack>
                    </Button>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
