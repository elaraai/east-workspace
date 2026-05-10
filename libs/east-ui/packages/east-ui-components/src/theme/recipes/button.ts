/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Button recipe override — enforces the canonical button vocabulary.
 *
 * Variants are roles, not palettes:
 *  - `solid`   — the one primary action on a screen.
 *  - `ink`     — the dual-CTA partner to solid.
 *  - `outline` — secondary actions.
 *  - `ghost`   — tertiary, low-stakes (Cancel, Dismiss).
 *
 * Sizes match the UX/UI Guide hit-targets:
 *  - `sm` — 28px (compact density)
 *  - `md` — 36px (default)
 *  - `lg` — 44px (mobile / touch)
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const buttonRecipe = defineRecipe({
    className: "elara-btn",
    base: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "2",
        fontFamily: "body",
        fontWeight: "semibold",
        lineHeight: "1",
        borderRadius: "md",   // 6px
        cursor: "pointer",
        userSelect: "none",
        transitionProperty: "background, color, border-color, box-shadow, transform",
        transitionDuration: "{durations.fast}",
        transitionTimingFunction: "{easings.out}",
        _focusVisible: {
            outline: "none",
            boxShadow: "{shadows.focus}",
        },
        _disabled: {
            background: "{colors.gray.200}",
            color: "fg.muted",
            cursor: "not-allowed",
            boxShadow: "none",
            _hover: { background: "{colors.gray.200}" },
        },
        _active: {
            transform: "scale(0.98)",
        },
    },
    variants: {
        variant: {
            solid: {
                background: "{colors.brand.500}",
                color: "white",
                _hover:  { background: "{colors.brand.600}" },
                _active: { background: "{colors.brand.700}", transform: "scale(0.98)" },
            },
            ink: {
                background: "{colors.brand.900}",
                color: "white",
                _hover:  { background: "{colors.brand.800}" },
                _active: { background: "{colors.brand.700}", transform: "scale(0.98)" },
            },
            outline: {
                background: "bg.surface",
                color: "{colors.brand.700}",
                borderWidth: "1px",
                borderColor: "border.strong",
                _hover:  { background: "bg.muted" },
                _active: { background: "{colors.gray.200}", transform: "scale(0.98)" },
            },
            ghost: {
                background: "transparent",
                color: "fg.muted",
                _hover:  { background: "bg.muted", color: "fg" },
                _active: { background: "{colors.gray.200}", transform: "scale(0.98)" },
            },
        },
        size: {
            sm: { height: "28px", paddingX: "3",   fontSize: "{fontSizes.md}" /* 13 */ },
            md: { height: "36px", paddingX: "4",   fontSize: "{fontSizes.lg}" /* 14 */ },
            // Primary commit on a high-stakes card (Decision.Brief).
            // Per UX/UI Guide §07 + Decision.Brief spec — 40px tall, generous
            // horizontal padding so the solid action visually outweighs
            // outline / ghost siblings.
            lg: { height: "40px", paddingX: "5",   fontSize: "{fontSizes.lg}" /* 14 */ },
        },
    },
    defaultVariants: {
        variant: "solid",
        size: "md",
    },
});
