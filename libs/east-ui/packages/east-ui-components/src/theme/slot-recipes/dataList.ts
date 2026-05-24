/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * DataList slot recipe — label/value pairs in a key-aligned column.
 *
 * Label uses `caption.eyebrow` per spec data-rail rule. Value reads as
 * body content.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const dataListSlotRecipe = defineSlotRecipe({
    className: "elara-data-list",
    slots: ["root", "item", "itemLabel", "itemValue"],
    base: {
        root: { display: "flex", flexDirection: "column", gap: "{spacing.3}" },
        item: { display: "flex", flexDirection: "column", gap: "{spacing.1}" },
        itemLabel: { textStyle: "caption.eyebrow" },
        itemValue: { fontSize: "13.5px", color: "fg", lineHeight: "{lineHeights.normal}" },
    },
    variants: {
        orientation: {
            vertical:   {},
            horizontal: {
                item: { flexDirection: "row", alignItems: "baseline", gap: "{spacing.4}" },
                itemLabel: { minWidth: "120px", flexShrink: 0 },
            },
        },
        size: {
            sm: { item: { fontSize: "{fontSizes.xs}" } },
            md: {},
            lg: { itemValue: { fontSize: "{fontSizes.md}" } },
        },
    },
    defaultVariants: { orientation: "vertical", size: "md" },
});
