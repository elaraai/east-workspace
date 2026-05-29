/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * IconButton recipe — square button sized for an icon glyph.
 *
 * Spec sources: `.x-btn` (26×26 outline), commit-bar / diff-foot icon
 * triggers. Sizes match the button recipe so a pair of label + icon
 * triggers can sit on the same row.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const iconButtonRecipe = defineRecipe({
    className: "elara-icon-btn",
    base: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "{radii.sm}",
        cursor: "pointer",
        userSelect: "none",
        transitionProperty: "background, color, border-color, box-shadow",
        transitionDuration: "{durations.fast}",
        transitionTimingFunction: "{easings.out}",
        _focusVisible: { outline: "none", boxShadow: "{shadows.focus}" },
        _disabled: { color: "fg.muted", cursor: "not-allowed", opacity: 0.5 },
    },
    variants: {
        variant: {
            ghost:   { background: "transparent", color: "fg.muted", _hover: { background: "bg.subtle", color: "fg" } },
            outline: { background: "bg.surface",  color: "fg",       borderWidth: "1px", borderColor: "border.strong", _hover: { borderColor: "fg.muted" } },
            solid:   { background: "{colors.brand.600}", color: "white", _hover: { background: "{colors.brand.700}" } },
            ink:     { background: "fg.default", color: "bg.surface", _hover: { background: "{colors.brand.800}" } },
            subtle:  { background: "bg.subtle", color: "fg", _hover: { background: "bg.emphasized" } },
        },
        size: {
            xs: { width: "26px", height: "26px", fontSize: "13px" },
            sm: { width: "28px", height: "28px", fontSize: "13px" },
            md: { width: "32px", height: "32px", fontSize: "14px" },
            lg: { width: "40px", height: "40px", fontSize: "16px" },
        },
    },
    defaultVariants: { variant: "ghost", size: "md" },
});
