/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, variant, example } from "@elaraai/east";
import { State, Style, UIComponentType } from "@elaraai/east-ui";
import { Tag, Text, HStack, VStack, Reactive } from "@elaraai/east-ui";

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

export const tagVariants = example({
    keywords: ["Tag", "Root", "variant", "outline", "brand", "subtle", "solid", "dashed"],
    description: "Spec variants — outline (default), brand, subtle, solid, dashed",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2" wrap="wrap">
                <Tag variant="outline">Outline</Tag>
                <Tag variant="brand">Brand</Tag>
                <Tag variant="subtle">Subtle</Tag>
                <Tag variant="solid">Solid</Tag>
                <Tag variant="dashed">Dashed</Tag>
            </HStack>
        );
    }),
    inputs: [],
});

export const tagClosable = example({
    keywords: ["Tag", "Root", "closable", "removable"],
    description: "Filter chips set by the operator — always carry a removable ×",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2">
                <Tag closable={true} variant="brand">region · SE</Tag>
                <Tag closable={true} variant="brand">status · active</Tag>
                <Tag closable={true} variant="brand">after 2026-04-01</Tag>
            </HStack>
        );
    }),
    inputs: [],
});

export const tagDynamic = example({
    keywords: ["Tag", "Root", "ifElse", "dynamic", "variant", "Style"],
    description: "Variant resolved dynamically — true → brand, false → outline",
    fn: East.function([], UIComponentType, (_$) => {
        return (
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
        );
    }),
    inputs: [],
});

export const tagCustom = example({
    keywords: ["Tag", "Root", "background", "color", "custom", "escape", "opacity"],
    description: "Opacity ramp on a brand tag, plus colour escape hatches",
    fn: East.function([], UIComponentType, (_$) => {
        return (
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
        );
    }),
    inputs: [],
});

export const tagBorder = example({
    keywords: ["Tag", "Root", "borderWidth", "borderStyle", "borderRadius"],
    description: "Border style variations — outlined, pill, dashed",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2">
                <Tag variant="outline">Outlined</Tag>
                <Tag variant="brand" borderRadius="full" padding="2">Pill</Tag>
                <Tag variant="dashed">Dashed</Tag>
            </HStack>
        );
    }),
    inputs: [],
});

export const tagBoxModel = example({
    keywords: ["Tag", "Root", "padding", "width", "overflow"],
    description: "Padding, fixed width, full-rounded — all in brand subtle",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2">
                <Tag padding="3" variant="subtle">Extra Padding</Tag>
                <Tag width="120px" overflow="hidden" variant="subtle">Fixed Width Tag With Longer Text</Tag>
                <Tag variant="brand" borderRadius="full" padding="2">Rounded Tag</Tag>
            </HStack>
        );
    }),
    inputs: [],
});

export const tagOnCloseInteractive = example({
    keywords: ["Tag", "Reactive", "State", "interactive", "onClose", "closable"],
    description: "Closable tag whose onClose increments a reactive counter",
    fn: East.function([], UIComponentType, (_$) => (
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
                    {Text.Presets.MonoLabel(East.str`CLOSED · ${value}`)}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
