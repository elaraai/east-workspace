/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Link recipe.
 *
 * Spec `a`: brand-600 ink, no underline at rest, underline 2 px offset on
 * hover. `.btn-link` size is 12.5 px weight 500.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const linkRecipe = defineRecipe({
    className: "elara-link",
    base: {
        display: "inline-flex",
        alignItems: "center",
        gap: "1",
        color: "link",
        textDecoration: "none",
        fontWeight: "medium",
        cursor: "pointer",
        transitionProperty: "color, text-decoration-color",
        transitionDuration: "{durations.fast}",
        transitionTimingFunction: "{easings.out}",
        _hover: {
            color: "link.hover",
            textDecoration: "underline",
            textUnderlineOffset: "2px",
        },
    },
});
