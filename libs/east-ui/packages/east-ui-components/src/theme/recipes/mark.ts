/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Mark recipe — inline highlighted span.
 *
 * Defaults to a soft brand-tinted background (per `.brand-tint` swatches
 * across the spec).
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const markRecipe = defineRecipe({
    className: "elara-mark",
    base: {
        background: "bg.brand.subtle",
        /* brand.fg = brand.700 light / brand.300 dark — fixed brand.700 ink
         * vanished on the brand.800 dark fill (#362). */
        color: "brand.fg",
        borderRadius: "2px",
        paddingX: "0.5",
    },
});
