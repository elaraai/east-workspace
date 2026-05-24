/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Avatar slot recipe — pattern_spec/spec.css `.avatar` 22 px gray chip.
 *
 * Default size `xs` = 22 px circular gray-on-paper with mono 10 px / 600
 * initials in `fg`. `brand` variant flips to `{colors.brand.600}` fill +
 * white initials (spec `.mx-avatar` for matrix grid).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const avatarSlotRecipe = defineSlotRecipe({
    className: "elara-avatar",
    slots: ["root", "image", "fallback"],
    base: {
        root: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "{radii.full}",
            overflow: "hidden",
            fontFamily: "mono",
            fontWeight: "semibold",
            lineHeight: "1",
            letterSpacing: "{letterSpacings.normal}",
            // Inside an AvatarGroup, each member gets a surface-coloured ring so
            // overlapped circles read as a stack instead of blending into slivers.
            "&[data-group-item]": {
                borderWidth: "2px",
                borderColor: "bg.surface",
            },
        },
        fallback: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
        },
    },
    variants: {
        variant: {
            subtle: {
                root: {
                    background: "{colors.gray.100}",
                    color: "{colors.brand.700}",
                    borderWidth: "1px",
                    borderColor: "{colors.gray.200}",
                },
            },
            brand: {
                root: {
                    background: "{colors.brand.600}",
                    color: "white",
                },
            },
            ink: {
                root: {
                    background: "fg.default",
                    color: "bg.surface",
                },
            },
        },
        size: {
            xs: { root: { width: "22px",  height: "22px",  fontSize: "10px" } },
            sm: { root: { width: "24px",  height: "24px",  fontSize: "10px" } },
            md: { root: { width: "32px",  height: "32px",  fontSize: "{fontSizes.xs}" } },
            lg: { root: { width: "40px",  height: "40px",  fontSize: "{fontSizes.sm}" } },
            xl: { root: { width: "56px",  height: "56px",  fontSize: "{fontSizes.md}" } },
        },
    },
    defaultVariants: {
        variant: "subtle",
        size: "xs",
    },
});
