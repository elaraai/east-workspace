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
            /* bsys §Radio (L1998-2018): 14×14 outlined circle, paper bg,
             * brand-d border + brand-d 6px inner dot on checked. Defeat
             * Chakra's `solid` default by setting `bg: transparent` so
             * the inner Radiomark dot reads against paper, not against
             * a brand-coloured fill. The `.dot` is Chakra's inner mark;
             * `currentColor` resolves through `color: brand.600` set on
             * `_checked` below. */
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "16px",
            height: "16px",
            borderRadius: "{radii.full}",
            borderWidth: "1.5px",
            borderColor: "border.strong",
            background: "bg.surface",
            transitionProperty: "background, border-color, color",
            transitionDuration: "{durations.fast}",
            color: "transparent",
            "& .dot": {
                width: "100%",
                height: "100%",
                borderRadius: "{radii.full}",
                background: "currentColor",
                scale: "0.5",
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
            fontSize: "{fontSizes.sm}",
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
