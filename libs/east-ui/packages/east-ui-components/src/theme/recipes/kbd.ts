/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Kbd recipe — flat keyboard-key chip.
 *
 * Spec `.kbd`: mono 10 px / weight 600 / 0.04 em tracking / gray.100 fill /
 * 1 px gray.300 border / 3 px radius / **no drop shadow**. The Chakra
 * default `raised` variant adds a 2 px bottom drop shadow which the spec
 * explicitly does not use, so the renderer/recipe defaults to flat.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const kbdRecipe = defineRecipe({
    className: "elara-kbd",
    base: {
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "mono",
        fontSize: "10px",
        fontWeight: "semibold",
        letterSpacing: "0.04em",
        lineHeight: "1",
        paddingX: "6px",
        paddingY: "2px",
        borderRadius: "{radii.xs}",
        whiteSpace: "nowrap",
    },
    variants: {
        variant: {
            flat: {
                background: "{colors.gray.100}",
                borderWidth: "1px",
                borderColor: "border.strong",
                color: "fg",
            },
            outline: {
                background: "transparent",
                borderWidth: "1px",
                borderColor: "border.strong",
                color: "fg",
            },
            subtle: {
                background: "{colors.gray.100}",
                borderWidth: "0",
                color: "fg",
            },
            raised: {
                background: "{colors.gray.100}",
                borderWidth: "1px",
                borderColor: "border.strong",
                color: "fg",
                boxShadow: "0 2px 0 {colors.border.strong}",
            },
        },
        // Density cascade — a key cap is a micro-label like Badge, one tier
        // below the chip-height rhythm: it scales with density but stays
        // smaller than a Tag, centring vertically in the row. No default: an
        // undensified kbd keeps the base look.
        density: {
            condensed: { fontSize: "8.5px", paddingX: "4px", paddingY: "1px" },
            compact: { fontSize: "10px", paddingX: "6px", paddingY: "2px" },
            comfortable: { fontSize: "11px", paddingX: "7px", paddingY: "4px" },
        },
    },
    defaultVariants: {
        variant: "flat",
    },
});
