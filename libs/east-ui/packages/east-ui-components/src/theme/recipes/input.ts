/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Input recipe — enforces the canonical input shape.
 *
 *  - 6 px radius, 9×12 padding, 1px gray-300 border.
 *  - Focus: brand-500 border + 3 px brand-tinted box-shadow.
 *  - Error: red-500 border. Helper text becomes red.
 *  - Always paired with a static `<label>` above. No floating labels.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const inputRecipe = defineRecipe({
    className: "elara-input",
    base: {
        fontFamily: "body",
        fontSize: "{fontSizes.lg}",  // 14px
        background: "bg.surface",
        color: "fg",
        borderRadius: "md",           // 6px
        borderWidth: "1px",
        borderColor: "border.strong",
        paddingX: "3",                // 12px
        paddingY: "2.5",              // ~10px → 36px tall hit-target
        outline: "none",
        transitionProperty: "border-color, box-shadow",
        transitionDuration: "{durations.fast}",
        transitionTimingFunction: "{easings.out}",
        _placeholder: { color: "fg.subtle" },
        _hover: { borderColor: "{colors.gray.400}" },
        _focusVisible: {
            borderColor: "{colors.brand.500}",
            boxShadow: "{shadows.focus}",
        },
        _invalid: {
            borderColor: "{colors.status.danger}",
            _focusVisible: {
                borderColor: "{colors.status.danger}",
                boxShadow: "0 0 0 3px rgba(239, 68, 68, 0.25)",
            },
        },
        _disabled: {
            background: "bg.muted",
            color: "fg.muted",
            cursor: "not-allowed",
        },
    },
    variants: {
        size: {
            sm: { fontSize: "{fontSizes.md}" /* 13 */, paddingX: "2.5", paddingY: "2" },
            md: { fontSize: "{fontSizes.lg}" /* 14 */, paddingX: "3",   paddingY: "2.5" },
            lg: { fontSize: "{fontSizes.xl}" /* 16 */, paddingX: "4",   paddingY: "3" },
        },
    },
    defaultVariants: {
        size: "md",
    },
});
