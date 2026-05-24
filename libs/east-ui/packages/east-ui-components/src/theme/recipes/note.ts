/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Note recipe — left-bordered callout for italicised inline asides.
 *
 * Spec sources: `.banner.solid`, `.ho-q`, `.je-rationale`. Default uses
 * brand-tinted accent; `warn` / `neg` variants for cautionary asides.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const noteRecipe = defineRecipe({
    className: "elara-note",
    base: {
        borderLeftWidth: "3px",
        borderLeftColor: "border.brand",
        background: "bg.canvas",
        paddingX: "{spacing.4}",
        paddingY: "{spacing.3}",
        fontStyle: "italic",
        color: "fg.muted",
        fontSize: "{fontSizes.sm}",
        lineHeight: "{lineHeights.normal}",
    },
    variants: {
        accent: {
            brand:   { borderLeftColor: "border.brand" },
            warning: { borderLeftColor: "fg.warning" },
            danger:  { borderLeftColor: "fg.danger" },
            success: { borderLeftColor: "fg.success" },
            muted:   { borderLeftColor: "border.muted" },
        },
    },
    defaultVariants: {
        accent: "brand",
    },
});
