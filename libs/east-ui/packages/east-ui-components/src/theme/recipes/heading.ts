/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Heading recipe.
 *
 * Sets DM Sans (`heading` font token) + tight tracking as the default for
 * every `<Heading>`. Sizes (`size="xl|lg|md|sm|xs"`) map onto the
 * corresponding `display.{xl..xs}` textStyle so the spec's
 * pattern_spec/colors_and_type.css `.h1..h5` rules are honoured.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const headingRecipe = defineRecipe({
    className: "elara-heading",
    base: {
        fontFamily: "heading",
        color: "fg",
        fontWeight: "semibold",
        lineHeight: "{lineHeights.tight}",
    },
    variants: {
        size: {
            xl: {
                fontSize: "{fontSizes.5xl}",   // 48 — spec h1
                fontWeight: "bold",
                lineHeight: "1.1",
                letterSpacing: "{letterSpacings.tighter}",
            },
            lg: {
                fontSize: "{fontSizes.4xl}",   // 36 — spec h2
                fontWeight: "bold",
                lineHeight: "{lineHeights.tight}",
                letterSpacing: "{letterSpacings.tight}",
            },
            md: {
                fontSize: "{fontSizes.3xl}",   // 30 — spec h3
                lineHeight: "{lineHeights.snug}",
                letterSpacing: "{letterSpacings.snug}",
            },
            sm: {
                fontSize: "{fontSizes.2xl}",   // 24 — spec h4
                lineHeight: "{lineHeights.snug}",
                letterSpacing: "{letterSpacings.snug}",
            },
            xs: {
                fontSize: "{fontSizes.xl}",    // 20 — spec h5
                lineHeight: "{lineHeights.snug}",
            },
        },
    },
    defaultVariants: {
        size: "md",
    },
});
