/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Badge recipe — small mono-uppercase chip for taxonomic / status
 * micro-labels. Spec sources: `.pattern-anchor`, `.diff-pill.*`,
 * `.stakes-tag.{low,mid,high,crit}`.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const badgeRecipe = defineRecipe({
    className: "elara-badge",
    base: {
        display: "inline-flex",
        alignItems: "center",
        gap: "{spacing.1}",
        fontFamily: "mono",
        fontSize: "10px",
        fontWeight: "bold",
        lineHeight: "1.2",
        letterSpacing: "{letterSpacings.wider2}",
        textTransform: "uppercase",
        borderWidth: "1px",
        borderRadius: "{radii.xs}",
        paddingX: "{spacing.2}",
        paddingY: "2px",
        whiteSpace: "nowrap",
    },
    variants: {
        // Explicit size variants are required: Chakra deep-merges this recipe
        // with its built-in `badge` recipe, whose `size` variants +
        // `defaultVariants.size` would otherwise override the base `fontSize`
        // and inflate the badge past the 10 px spec. Defining our own sizes (and
        // defaulting to `sm`) makes the spec values win.
        size: {
            sm: { fontSize: "10px", paddingX: "{spacing.2}", paddingY: "2px", lineHeight: "1.2" },
            md: { fontSize: "11px", paddingX: "{spacing.2.5}", paddingY: "3px", lineHeight: "1.2" },
            lg: { fontSize: "{fontSizes.xs}", paddingX: "{spacing.3}", paddingY: "{spacing.1}", lineHeight: "1.2" },
        },
        variant: {
            /** Spec `.pattern-anchor` — brand-tinted body, no border. */
            brand: {
                background: "bg.brand.subtle",
                borderColor: "transparent",
                color: "{colors.brand.600}",
            },
            /** Spec `.diff-pill` default — outlined. */
            outline: {
                background: "bg.surface",
                borderColor: "border.strong",
                color: "fg",
            },
            /** Spec `.diff-pill.ok`, `.stakes-tag.low`. */
            ok: {
                background: "success.subtle",
                borderColor: "fg.success",
                color: "fg.success",
            },
            /** Spec `.stakes-tag.high`, `.diff-pill.warn`. */
            warn: {
                background: "warning.subtle.strong",
                borderColor: "fg.warning",
                color: "fg.warning",
            },
            /** Spec `.diff-pill.block`, `.stakes-tag.crit`. */
            danger: {
                background: "danger.subtle",
                borderColor: "fg.danger",
                color: "fg.danger",
            },
            /** Spec `.stakes-tag.mid`. */
            stakesMid: {
                background: "bg.brand.subtle",
                borderColor: "{colors.brand.600}",
                color: "brand.fg",
            },
            /** Plain — Chakra default. */
            plain: {
                background: "transparent",
                borderColor: "transparent",
                color: "fg",
            },
            /** Spec Badge & progress — count pill (paper-3, radius-full). */
            count: {
                background: "bg.subtle",
                borderColor: "transparent",
                color: "brand.fg",
                borderRadius: "{radii.full}",
                fontWeight: "semibold",
                fontSize: "11px",
                paddingX: "7px",
            },
            /** Spec Badge & progress — callout pill (brand-d fill, white). */
            callout: {
                background: "{colors.brand.600}",
                borderColor: "transparent",
                color: "white",
                borderRadius: "{radii.full}",
                fontWeight: "semibold",
                fontSize: "11px",
                paddingX: "7px",
            },
        },
        // Density cascade — a badge is a micro-label, one tier BELOW the
        // chip-height rhythm: it scales with density but stays smaller than a
        // Tag at the same density, centring vertically in the row. No
        // default: an undensified badge keeps the `size` look. Declared last
        // so density wins the merge over `size` / `variant` sizing.
        density: {
            condensed: { fontSize: "8.5px", lineHeight: "1", paddingX: "5px", paddingY: "1px" },
            compact: { fontSize: "10px", lineHeight: "1", paddingX: "8px", paddingY: "2px" },
            comfortable: { fontSize: "11px", lineHeight: "1", paddingX: "10px", paddingY: "4px" },
        },
    },
    defaultVariants: {
        variant: "outline",
        size: "sm",
    },
});
