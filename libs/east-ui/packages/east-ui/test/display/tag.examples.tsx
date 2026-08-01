/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, variant, example } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Tag, Text, HStack, VStack, Stack, Reactive, Separator } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const tagBasic = example({
    keywords: ["Tag", "Root", "basic", "filter", "chip"],
    description: "Filter / category chips — outline default, brand when active, dashed for empty",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2">
                <Tag>region · SE</Tag>
                <Tag variant="brand">cohort · selected</Tag>
                <Tag variant="dashed">+ add filter</Tag>
            </HStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Tag — variants, colours, box model, densities, dynamic (styles panel)
// ============================================================================

export const tagStyles = example({
    keywords: ["Tag", "Root", "variant", "outline", "brand", "subtle", "solid", "dashed", "background", "color", "custom", "escape", "opacity", "borderWidth", "borderStyle", "borderRadius", "padding", "width", "overflow", "density", "condensed", "compact", "comfortable", "sizes", "ifElse", "dynamic", "Style"],
    description: "Tag styles panel — variants (spec variants — outline, brand, subtle, solid, dashed), custom (opacity ramp on a brand tag, plus colour escape hatches), border (border style variations — outlined, pill, dashed), box model (padding, fixed width, full-rounded — all in brand subtle), densities (the three densities stacked — chip height + font scale condensed → compact → comfortable, matching ChipRail), dynamic (variant resolved dynamically — true → brand, false → outline)",
    fn: East.function([], UIComponentType, ($) => {
        const condensed = $.const(
            <HStack gap="2">
                <Tag density="condensed">region · SE</Tag>
                <Tag density="condensed" variant="brand">cohort · selected</Tag>
                <Tag density="condensed" variant="dashed">+ add filter</Tag>
            </HStack>,
        );
        const compact = $.const(
            <HStack gap="2">
                <Tag density="compact">region · SE</Tag>
                <Tag density="compact" variant="brand">cohort · selected</Tag>
                <Tag density="compact" variant="dashed">+ add filter</Tag>
            </HStack>,
        );
        const comfortable = $.const(
            <HStack gap="2">
                <Tag density="comfortable">region · SE</Tag>
                <Tag density="comfortable" variant="brand">cohort · selected</Tag>
                <Tag density="comfortable" variant="dashed">+ add filter</Tag>
            </HStack>,
        );
        return (
            <VStack gap="4" align="stretch">
                <Separator label="VARIANTS" align="start" />
                <HStack gap="2" wrap="wrap">
                    <Tag variant="outline">Outline</Tag>
                    <Tag variant="brand">Brand</Tag>
                    <Tag variant="subtle">Subtle</Tag>
                    <Tag variant="solid">Solid</Tag>
                    <Tag variant="dashed">Dashed</Tag>
                </HStack>
                <Separator label="CUSTOM" align="start" />
                <VStack gap="3" align="flex-start">
                    <HStack gap="2">
                        <Tag variant="brand">100%</Tag>
                        <Tag variant="brand" opacity={0.75}>75%</Tag>
                        <Tag variant="brand" opacity={0.5}>50%</Tag>
                        <Tag variant="brand" opacity={0.25}>25%</Tag>
                    </HStack>
                    <HStack gap="2">
                        <Tag background="#e74c3c" color="white">Custom</Tag>
                        <Tag background="#3498db" color="white">Brand</Tag>
                        <Tag background="#2c3e50" color="#ecf0f1">Dark Mode</Tag>
                    </HStack>
                </VStack>
                <Separator label="BORDER" align="start" />
                <HStack gap="2">
                    <Tag variant="outline">Outlined</Tag>
                    <Tag variant="brand" borderRadius="full" padding="2">Pill</Tag>
                    <Tag variant="dashed">Dashed</Tag>
                </HStack>
                <Separator label="BOX MODEL" align="start" />
                <HStack gap="2">
                    <Tag padding="3" variant="subtle">Extra Padding</Tag>
                    <Tag width="120px" overflow="hidden" variant="subtle">Fixed Width Tag With Longer Text</Tag>
                    <Tag variant="brand" borderRadius="full" padding="2">Rounded Tag</Tag>
                </HStack>
                <Separator label="DENSITIES" align="start" />
                <Stack direction="column" gap="6">
                    {condensed}
                    {compact}
                    {comfortable}
                </Stack>
                <Separator label="DYNAMIC" align="start" />
                <VStack gap="3" align="flex-start">
                    <HStack gap="2">
                        <Tag variant={East.value(true).ifElse(() => variant("brand", null), () => variant("outline", null))}>True → brand</Tag>
                        <Tag variant={East.value(false).ifElse(() => variant("brand", null), () => variant("outline", null))}>False → outline</Tag>
                    </HStack>
                    <HStack gap="2">
                        <Tag variant={Style.StyleVariant("solid")}>Style.StyleVariant solid</Tag>
                        <Tag variant={Style.StyleVariant("outline")}>Style.StyleVariant outline</Tag>
                    </HStack>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Tag — removable × + reactive onClose counter (closable panel)
// ============================================================================

export const tagClosable = example({
    keywords: ["Tag", "Root", "closable", "removable", "Reactive", "State", "interactive", "onClose"],
    description: "Tag closable panel — closable (filter chips set by the operator — always carry a removable ×), on close interactive (closable tag whose onClose increments a reactive counter)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="CLOSABLE" align="start" />
                <HStack gap="2">
                    <Tag closable={true} variant="brand">region · SE</Tag>
                    <Tag closable={true} variant="brand">status · active</Tag>
                    <Tag closable={true} variant="brand">after 2026-04-01</Tag>
                </HStack>
                <Separator label="ON CLOSE INTERACTIVE" align="start" />
                <Reactive>{$ => {
                    const bind = $.let(State.bind([IntegerType], "tag_close_count", 0n));
                    const value = $.let(bind.read());
                    const onClose = $.const(East.function([], NullType, $ => {
                        const cur = $.let(bind.read());
                        $(bind.write(cur.add(1n)));
                    }));
                    return (
                        <VStack gap="3" align="center">
                            <Tag closable={true} variant="brand" onClose={onClose}>Click × to close</Tag>
                            {<Text.MonoLabel>{East.str`CLOSED · ${value}`}</Text.MonoLabel>}
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
