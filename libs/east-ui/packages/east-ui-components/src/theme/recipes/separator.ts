/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Separator recipe — pattern_spec `.rule` / `.rule.dashed` / `.rule.brand`.
 *
 * Default is a 1 px subtle hairline. Variants for ephemeral / branded /
 * strong separators.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const separatorRecipe = defineRecipe({
    className: "elara-separator",
    base: {
        borderWidth: "0",
        borderTopWidth: "1px",
        borderTopStyle: "solid",
        borderTopColor: "border.subtle",
        margin: "0",
    },
    variants: {
        variant: {
            subtle: { borderTopColor: "border.subtle" },
            strong: { borderTopColor: "border.strong" },
            dashed: { borderTopStyle: "dashed", borderTopColor: "border.strong" },
            brand:  { borderTopColor: "border.brand" },
        },
        orientation: {
            horizontal: {},
            vertical:   { borderTopWidth: "0", borderLeftWidth: "1px", borderLeftStyle: "solid", borderLeftColor: "border.subtle" },
        },
    },
    defaultVariants: { variant: "strong", orientation: "horizontal" },
});
