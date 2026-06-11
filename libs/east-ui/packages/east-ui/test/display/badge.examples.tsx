/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Button, HStack, VStack, Stack, Reactive } from "@elaraai/east-ui";

export const badgeBasic = example({
    keywords: ["Badge", "Root", "basic", "label"],
    description: "Outlined micro-labels for taxonomic markers (NEW, BETA, PRO)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2">
                <Badge>New</Badge>
                <Badge>Beta</Badge>
                <Badge>Pro</Badge>
            </HStack>
        );
    }),
    inputs: [],
});

export const badgeVariants = example({
    keywords: ["Badge", "Root", "variant", "brand", "outline", "ok", "warn", "danger"],
    description: "Spec variants — outline (default), brand-tinted, and status hues",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2" wrap="wrap">
                <Badge variant="outline">Outline</Badge>
                <Badge variant="brand">Brand</Badge>
                <Badge variant="ok">OK</Badge>
                <Badge variant="warn">Warn</Badge>
                <Badge variant="danger">Danger</Badge>
            </HStack>
        );
    }),
    inputs: [],
});

export const badgeCountCallout = example({
    keywords: ["Badge", "Root", "count", "callout", "pill"],
    description: "Spec pills — count (paper-3) and callout (brand-d), radius-full",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2" wrap="wrap">
                <Badge variant="count">17</Badge>
                <Badge variant="count">128</Badge>
                <Badge variant="callout">NEW</Badge>
            </HStack>
        );
    }),
    inputs: [],
});

export const badgeColors = example({
    keywords: ["Badge", "Root", "colorPalette", "escape", "custom"],
    description: "Colour escape hatches — bypass recipe defaults for one-off taxonomy",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2" wrap="wrap">
                <Badge background="#ff6b6b" color="white">Custom BG</Badge>
                <Badge background="#1a1a2e" color="#eee">Dark</Badge>
                <Badge background="linear-gradient(90deg, #667eea 0%, #764ba2 100%)" color="white">Gradient</Badge>
            </HStack>
        );
    }),
    inputs: [],
});

export const badgeCustom = example({
    keywords: ["Badge", "Root", "opacity", "background", "color", "custom"],
    description: "Opacity ramp on a brand badge",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2">
                <Badge variant="brand">100%</Badge>
                <Badge variant="brand" opacity={0.75}>75%</Badge>
                <Badge variant="brand" opacity={0.5}>50%</Badge>
                <Badge variant="brand" opacity={0.25}>25%</Badge>
            </HStack>
        );
    }),
    inputs: [],
});

export const badgeFixedWidth = example({
    keywords: ["Badge", "Root", "width", "justifyContent", "count"],
    description: "Equal-width count badges with centred mono numerals",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="1">
                <Badge width="48px" justifyContent="center">3</Badge>
                <Badge width="48px" justifyContent="center">12</Badge>
                <Badge width="48px" justifyContent="center">128</Badge>
                <Badge width="48px" justifyContent="center">4.2K</Badge>
            </HStack>
        );
    }),
    inputs: [],
});

export const badgeBorder = example({
    keywords: ["Badge", "Root", "borderWidth", "borderStyle", "borderRadius"],
    description: "Custom border styles — solid, dashed, fully rounded",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2">
                <Badge variant="outline">Solid</Badge>
                <Badge variant="outline" borderStyle="dashed">Dashed</Badge>
                <Badge variant="brand" borderRadius="full">Pill</Badge>
            </HStack>
        );
    }),
    inputs: [],
});

export const badgeBoxModel = example({
    keywords: ["Badge", "Root", "padding", "width", "borderRadius"],
    description: "Padding, fixed-width, and large-radius escape hatches",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2">
                <Badge variant="brand" padding="3">Padded</Badge>
                <Badge variant="outline" width="120px" justifyContent="flex-start">Wide</Badge>
                <Badge variant="brand" padding="2" borderRadius="lg">Rounded</Badge>
            </HStack>
        );
    }),
    inputs: [],
});

export const badgeDensities = example({
    keywords: ["Badge", "density", "condensed", "compact", "comfortable", "sizes"],
    description: "The three densities stacked — badges scale condensed → compact → comfortable but stay a micro-label tier below tags at the same density",
    fn: East.function([], UIComponentType, ($) => {
        const condensed = $.const(
            <HStack gap="2">
                <Badge density="condensed">Open</Badge>
                <Badge density="condensed" variant="brand">Beta</Badge>
                <Badge density="condensed" variant="count">17</Badge>
            </HStack>,
        );
        const compact = $.const(
            <HStack gap="2">
                <Badge density="compact">Open</Badge>
                <Badge density="compact" variant="brand">Beta</Badge>
                <Badge density="compact" variant="count">17</Badge>
            </HStack>,
        );
        const comfortable = $.const(
            <HStack gap="2">
                <Badge density="comfortable">Open</Badge>
                <Badge density="comfortable" variant="brand">Beta</Badge>
                <Badge density="comfortable" variant="count">17</Badge>
            </HStack>,
        );
        return (
            <Stack direction="column" gap="6">
                {condensed}
                {compact}
                {comfortable}
            </Stack>
        );
    }),
    inputs: [],
});

export const badgeInteractive = example({
    keywords: ["Badge", "Reactive", "State", "interactive", "counter"],
    description: "Reactive count badge — increments via Button.onClick",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const counter = $.let(State.bind([IntegerType], "badge_counter", 0n));
            const value = $.let(counter.read());
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="center">
                    <Badge>{East.str`${East.print(value)}`}</Badge>
                    <Button onClick={inc}>Increment</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
