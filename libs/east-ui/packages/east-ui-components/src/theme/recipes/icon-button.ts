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
 * The smallest, `2xs`, is the design system's small ghost icon button
 * (`.ibtn.sm`, 24×24 at `--r-md`): a frame's eyebrow menu.
 *
 * Each size's glyph is an even number of pixels tall in its even square — 14
 * in 24, 26 and 28 (the design system's small icon), 14 in 32, 16 in 40 — so its
 * box starts on a whole pixel at the square's middle. An odd glyph in an even
 * square starts on a half pixel, which the browser draws a pixel up or down by
 * where the page puts the button: a 13px cross in a 28px square stood 9 rows
 * from its top and 8 from its foot, or the other way about.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

export const iconButtonRecipe = defineRecipe({
    className: "elara-icon-btn",
    base: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "{radii.sm}",
        cursor: "pointer",
        userSelect: "none",
        /* Touch hit target (#346) — ≥44px effective area on coarse pointers. */
        ...coarseHitArea({ position: true }),
        transitionProperty: "background, color, border-color, box-shadow",
        transitionDuration: "{durations.fast}",
        transitionTimingFunction: "{easings.out}",
        _focusVisible: { outline: "none", boxShadow: "{shadows.focus}" },
        _disabled: { color: "fg.muted", cursor: "not-allowed", opacity: 0.5 },
    },
    variants: {
        variant: {
            /* While the menu it opens is open it stands as hovered. */
            ghost:   { background: "transparent", color: "fg.muted", _hover: { background: "bg.subtle", color: "fg" }, _open: { background: "bg.subtle", color: "fg" } },
            outline: { background: "bg.surface",  color: "fg",       borderWidth: "1px", borderColor: "border.strong", _hover: { borderColor: "fg.muted" } },
            solid:   { background: "brand.solid", color: "brand.contrast", _hover: { background: "brand.solidHover" } },
            ink:     { background: "fg.default", color: "bg.surface", _hover: { background: "{colors.brand.800}" } },
            subtle:  { background: "bg.subtle", color: "fg", _hover: { background: "bg.emphasized" } },
        },
        size: {
            "2xs": { width: "24px", height: "24px", fontSize: "14px", borderRadius: "{radii.md}" },
            xs: { width: "26px", height: "26px", fontSize: "14px" },
            sm: { width: "28px", height: "28px", fontSize: "14px" },
            md: { width: "32px", height: "32px", fontSize: "14px" },
            lg: { width: "40px", height: "40px", fontSize: "16px" },
        },
    },
    defaultVariants: { variant: "ghost", size: "md" },
});
