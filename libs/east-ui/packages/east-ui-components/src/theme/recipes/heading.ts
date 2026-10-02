/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Heading recipe.
 *
 * Sets DM Sans (`heading` font token) + tight tracking as the default for
 * every `<Heading>`. Sizes (`size="xl|lg|md|sm|xs"`) are the design system's
 * `h1` … `h5` (`_ds_bundle.css`): 24 / 20 / 18 / 16 / 15, the
 * `display.{xl..xs}` text styles.
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
                fontSize: "{fontSizes.title.xl}",   // 24 — h1
                fontWeight: "bold",
                lineHeight: "{lineHeights.tight}",
                letterSpacing: "{letterSpacings.tighter}",
            },
            lg: {
                fontSize: "{fontSizes.title.lg}",   // 20 — h2
                fontWeight: "bold",
                lineHeight: "{lineHeights.tight}",
                letterSpacing: "{letterSpacings.tight}",
            },
            md: {
                fontSize: "{fontSizes.title.md}",   // 18 — h3
                lineHeight: "{lineHeights.snug}",
                letterSpacing: "{letterSpacings.snug}",
            },
            sm: {
                fontSize: "{fontSizes.title.sm}",   // 16 — h4
                lineHeight: "{lineHeights.snug}",
                letterSpacing: "{letterSpacings.snug}",
            },
            xs: {
                fontSize: "{fontSizes.title.xs}",   // 15 — h5, DM Sans 700
                fontWeight: "bold",
                lineHeight: "{lineHeights.snug}",
                letterSpacing: "{letterSpacings.snug}",
            },
        },
    },
    defaultVariants: {
        size: "md",
    },
});
