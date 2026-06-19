/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * PresetGrid slot recipe — spec `Input.Presets` (`#presetpicker`, `spec.css`
 * `.preset-grid` / `.preset` / `.pr-name` / `.pr-desc` / `.preset.active`).
 *
 * A row of named scenario presets that snap a band to a pre-baked configuration:
 * an N-up grid (`cols` 1/2/3) of bordered cards, each a brand-name title +
 * mono description; the active card carries the brand tint. Bottom rule divides
 * it from the body below.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const presetGridSlotRecipe = defineSlotRecipe({
    className: "elara-preset-grid",
    slots: ["root", "card", "name", "desc"],
    base: {
        root: {
            display: "grid",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderBottomColor: "border.subtle",
        },
        card: {
            // spec.css `.preset` — padding + right rule, paper surface, tint on active.
            display: "block",
            width: "100%",
            textAlign: "start",
            paddingInline: "16px",
            paddingBlock: "12px",
            borderRightWidth: "1px",
            borderRightStyle: "solid",
            borderRightColor: "border.subtle",
            background: "bg.surface",
            cursor: "pointer",
            transitionProperty: "background",
            transitionDuration: "fast",
            _hover: { background: "bg.subtle" },
            "&:last-of-type": { borderRightWidth: "0" },
            "&[data-active]": { background: "bg.brand.subtle" },
            _focusVisible: {
                outline: "2px solid",
                outlineColor: "border.brand",
                outlineOffset: "-2px",
            },
        },
        name: {
            // spec.css `.pr-name` — font-brand 14px/600, full ink.
            fontFamily: "brand",
            fontSize: "14px",
            fontWeight: "semibold",
            color: "fg",
        },
        desc: {
            // spec.css `.pr-desc` — font-mono 11px / ink-4.
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.subtle",
            marginTop: "4px",
        },
    },
    variants: {
        // Drop the right rule on the last card of each row (spec.css `.preset:nth-child(Nn)`),
        // not just the final card, so multi-row grids have no dangling right edge.
        cols: {
            "1": { root: { gridTemplateColumns: "1fr" }, card: { borderRightWidth: "0" } },
            "2": { root: { gridTemplateColumns: "repeat(2, 1fr)" }, card: { "&:nth-of-type(2n)": { borderRightWidth: "0" } } },
            "3": { root: { gridTemplateColumns: "repeat(3, 1fr)" }, card: { "&:nth-of-type(3n)": { borderRightWidth: "0" } } },
        },
    },
    defaultVariants: { cols: "3" },
});
