/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Skeleton recipe — shimmering placeholder.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const skeletonRecipe = defineRecipe({
    className: "elara-skeleton",
    base: {
        display: "block",
        background: "linear-gradient(90deg, {colors.bg.subtle} 0%, {colors.bg.emphasized} 50%, {colors.bg.subtle} 100%)",
        backgroundSize: "200% 100%",
        borderRadius: "{radii.sm}",
        animation: "elara-shimmer 1.6s linear infinite",
    },
    variants: {
        variant: {
            line:   { height: "{fontSizes.md}" },
            circle: { borderRadius: "{radii.full}" },
            block:  { minHeight: "120px" },
        },
    },
    defaultVariants: { variant: "line" },
});
