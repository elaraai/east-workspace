/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * RadioGroup slot recipe — brand-tinted control dot when selected.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const radioGroupSlotRecipe = defineSlotRecipe({
    className: "elara-radio-group",
    slots: ["root", "label", "item", "itemControl", "itemText", "itemIndicator", "itemAddon", "indicator"],
    base: {
        root: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
        },
        item: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
            cursor: "pointer",
        },
        itemControl: {
            /* Outlined circle on paper with a brand inner dot when checked.
             * `bg` stays the surface (not Chakra's `solid` fill) so the inner
             * Radiomark reads against paper; the `.dot` is that mark and its
             * `currentColor` resolves through the `color` set on `_checked`. */
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "14px",
            height: "14px",
            borderRadius: "{radii.full}",
            borderWidth: "1.5px",
            borderColor: "border.strong",
            background: "bg.surface",
            transitionProperty: "background, border-color, color",
            transitionDuration: "{durations.fast}",
            color: "transparent",
            "& .dot": {
                width: "6px",
                height: "6px",
                borderRadius: "{radii.full}",
                background: "currentColor",
            },
            _checked: {
                borderColor: "{colors.brand.600}",
                background: "bg.surface",
                color: "{colors.brand.600}",
            },
            _disabled: {
                background: "bg.subtle",
                borderColor: "border.subtle",
                cursor: "not-allowed",
            },
        },
        itemText: {
            fontSize: "{fontSizes.control}",
            color: "fg",
            userSelect: "none",
        },
    },
    defaultVariants: {
        /* `colorPalette` defaults to brand so the inner dot inherits the
         * brand-d hue via `color: {colors.brand.600}` on the `_checked`
         * base rule above. The base styles enforce the outlined-with-dot
         * pattern directly — no `variants.variant` cascade is needed. */
        colorPalette: "brand",
    },
});
