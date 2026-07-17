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
import { coarseHitArea } from "../../style/hit-area.js";

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
            /* Touch hit target (#346). */
            ...coarseHitArea({ position: true }),
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
                // Chakra's radiomark shrinks the dot with `scale: 0.4`; reset it
                // so the fixed mark renders full-size, not ~2.4px.
                width: "6px",
                height: "6px",
                scale: "1",
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
    variants: {
        // Chakra's radiomark sizes the control from its size variant (md =
        // boxSize 5 = 20px), which outranks a base width/height — pin each to
        // the spec scale; md is the canonical 14px circle.
        size: {
            sm: { itemControl: { boxSize: "12px" } },
            md: { itemControl: { boxSize: "14px" } },
            lg: { itemControl: { boxSize: "16px" } },
        },
        // The default `solid` variant fills the checked circle with
        // colorPalette.solid and tints the dot with `contrast`. Keep it outlined
        // — surface circle, brand ring, brand dot — so the mark reads on paper.
        variant: {
            solid: {
                itemControl: {
                    "&:is([data-state=checked])": {
                        background: "bg.surface",
                        borderColor: "{colors.brand.600}",
                        color: "{colors.brand.600}",
                    },
                },
            },
        },
    },
    defaultVariants: {
        colorPalette: "brand",
    },
});
