/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Button, HStack, Separator, VStack, Stack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

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

// ============================================================================
// Badge — variants, pills, colours, box model, densities, interactive (panel)
// ============================================================================

export const badgeStyles = example({
    keywords: ["Badge", "Root", "variant", "brand", "outline", "ok", "warn", "danger", "count", "callout", "pill", "colorPalette", "escape", "custom", "opacity", "background", "color", "width", "justifyContent", "borderWidth", "borderStyle", "borderRadius", "padding", "density", "condensed", "compact", "comfortable", "sizes", "Reactive", "State", "interactive", "counter"],
    description: "Badge styles panel — variants (spec variants — outline, brand-tinted, and status hues), count callout (spec pills — count and callout, radius-full), colors (colour escape hatches — bypass recipe defaults), custom (opacity ramp on a brand badge), fixed width (equal-width count badges with centred mono numerals), border (custom border styles — solid, dashed, fully rounded), box model (padding, fixed-width, and large-radius escape hatches), densities (the three densities stacked), interactive (reactive count badge — increments via Button.onClick)",
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
            <VStack gap="4" align="stretch">
                <Separator label="VARIANTS" align="start" />
                <HStack gap="2" wrap="wrap">
                    <Badge variant="outline">Outline</Badge>
                    <Badge variant="brand">Brand</Badge>
                    <Badge variant="ok">OK</Badge>
                    <Badge variant="warn">Warn</Badge>
                    <Badge variant="danger">Danger</Badge>
                </HStack>
                <Separator label="COUNT CALLOUT" align="start" />
                <HStack gap="2" wrap="wrap">
                    <Badge variant="count">17</Badge>
                    <Badge variant="count">128</Badge>
                    <Badge variant="callout">NEW</Badge>
                </HStack>
                <Separator label="COLORS" align="start" />
                <HStack gap="2" wrap="wrap">
                    <Badge background="#ff6b6b" color="white">Custom BG</Badge>
                    <Badge background="#1a1a2e" color="#eee">Dark</Badge>
                    <Badge background="linear-gradient(90deg, #667eea 0%, #764ba2 100%)" color="white">Gradient</Badge>
                </HStack>
                <Separator label="CUSTOM" align="start" />
                <HStack gap="2">
                    <Badge variant="brand">100%</Badge>
                    <Badge variant="brand" opacity={0.75}>75%</Badge>
                    <Badge variant="brand" opacity={0.5}>50%</Badge>
                    <Badge variant="brand" opacity={0.25}>25%</Badge>
                </HStack>
                <Separator label="FIXED WIDTH" align="start" />
                <HStack gap="1">
                    <Badge width="48px" justifyContent="center">3</Badge>
                    <Badge width="48px" justifyContent="center">12</Badge>
                    <Badge width="48px" justifyContent="center">128</Badge>
                    <Badge width="48px" justifyContent="center">4.2K</Badge>
                </HStack>
                <Separator label="BORDER" align="start" />
                <HStack gap="2">
                    <Badge variant="outline">Solid</Badge>
                    <Badge variant="outline" borderStyle="dashed">Dashed</Badge>
                    <Badge variant="brand" borderRadius="full">Pill</Badge>
                </HStack>
                <Separator label="BOX MODEL" align="start" />
                <HStack gap="2">
                    <Badge variant="brand" padding="3">Padded</Badge>
                    <Badge variant="outline" width="120px" justifyContent="flex-start">Wide</Badge>
                    <Badge variant="brand" padding="2" borderRadius="lg">Rounded</Badge>
                </HStack>
                <Separator label="DENSITIES" align="start" />
                <Stack direction="column" gap="6">
                    {condensed}
                    {compact}
                    {comfortable}
                </Stack>
                <Separator label="INTERACTIVE" align="start" />
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
            </VStack>
        );
    }),
    inputs: [],
});
