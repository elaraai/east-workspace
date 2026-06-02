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
        color: "{colors.brand.700}",
        borderRadius: "2px",
        paddingX: "0.5",
    },
});
