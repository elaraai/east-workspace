/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Switch slot recipe — brand-tinted track when checked.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

export const switchSlotRecipe = defineSlotRecipe({
    className: "elara-switch",
    slots: ["root", "label", "control", "thumb", "indicator"],
    base: {
        root: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
            cursor: "pointer",
            /* Touch hit target (#346). */
            ...coarseHitArea({ position: true }),
        },
        control: {
            display: "inline-flex",
            alignItems: "center",
            background: "border.strong",
            borderRadius: "{radii.full}",
            padding: "2px",
            transitionProperty: "background",
            transitionDuration: "{durations.fast}",
            _checked: {
                background: "{colors.brand.600}",
            },
            _disabled: {
                opacity: 0.5,
                cursor: "not-allowed",
            },
        },
        thumb: {
            background: "bg.surface",
            borderRadius: "{radii.full}",
            boxShadow: "sm",
            scale: "1",
            transitionProperty: "transform",
            transitionDuration: "{durations.fast}",
        },
        label: {
            fontSize: "{fontSizes.control}",
            color: "fg",
        },
    },
    variants: {
        size: {
            sm: {
                root: { "--switch-width": "28px", "--switch-height": "16px" },
                control: { width: "28px", height: "16px" },
                thumb: { width: "12px", height: "12px" },
            },
            md: {
                root: { "--switch-width": "36px", "--switch-height": "20px" },
                control: { width: "36px", height: "20px" },
                thumb: { width: "16px", height: "16px" },
            },
            lg: {
                root: { "--switch-width": "44px", "--switch-height": "24px" },
                control: { width: "44px", height: "24px" },
                thumb: { width: "20px", height: "20px" },
            },
        },
    },
    defaultVariants: {
        size: "md",
    },
});
