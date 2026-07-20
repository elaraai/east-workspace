/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Button recipe override — enforces the canonical button vocabulary.
 *
 * Variants are roles, not palettes:
 *  - `solid`   — the one primary action on a screen. Spec brand.600 fill.
 *  - `ink`     — the dual-CTA partner to solid (deep ink fill).
 *  - `outline` — secondary actions (1 px subtle border, body weight 500).
 *  - `ghost`   — tertiary, low-stakes (Cancel, Dismiss).
 *  - `danger`  — destructive intent (subtle outline + danger ink color).
 *  - `commit`  — bottom-bar secondary action (the outline look in a commit cluster).
 *  - `commit-primary` — the one committing action (solid brand fill).
 *
 * Sizes match pattern_spec hit-targets:
 *  - `xs` — 26 px (compact `.x-btn` / `.btn.compact`)
 *  - `sm` — 28 px
 *  - `md` — 32 px (default)
 *  - `lg` — 40 px (Decision.Brief primary commit)
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

export const buttonRecipe = defineRecipe({
    className: "elara-btn",
    base: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "2",
        fontFamily: "body",
        fontWeight: "medium",         // spec `.btn` is weight 500, not semibold
        lineHeight: "1.15",
        borderRadius: "md",            // 6px
        cursor: "pointer",
        userSelect: "none",
        /* `position: relative` alone is harmless — it doesn't create a
         * stacking context unless z-index is set. We use it as the
         * anchor so the scoped `z-index: 1` below (applied only when
         * inside a Chakra `<Group>`) can lift the hovered/focused
         * segment above its neighbours. */
        position: "relative",
        /* Touch hit target (#346) — ≥44px effective area on coarse pointers;
         * visual size (26–40px per the spec) is unchanged. */
        ...coarseHitArea(),
        transitionProperty: "background, color, border-color, box-shadow, transform",
        transitionDuration: "{durations.fast}",
        transitionTimingFunction: "{easings.out}",
        _focusVisible: {
            outline: "none",
            boxShadow: "{shadows.focus}",
        },
        /* Attached-group-only z-index lift. Chakra v3's `<Group attached>`
         * applies `data-group-item` to every child segment. We scope the
         * lift to that attribute so standalone buttons never establish
         * an unnecessary stacking context and don't fight with
         * tooltips / popovers / sticky chrome elsewhere on the page. */
        "&[data-group-item]:hover, &[data-group-item]:focus-visible": {
            zIndex: 1,
        },
        /* `bg.emphasized` keeps the light look (gray.200) and stays a muted
         * slab in dark (gray.600) instead of a washed light block (#362). */
        _disabled: {
            background: "bg.emphasized",
            color: "fg.muted",
            cursor: "not-allowed",
            boxShadow: "none",
            _hover: { background: "bg.emphasized" },
        },
        _active: {
            transform: "scale(0.98)",
        },
    },
    variants: {
        variant: {
            solid: {
                /* Spec `.btn.primary { background: var(--brand-d) }` = brand.600.
                 *  Routes through `colorPalette` so `colorPalette="red"` produces
                 *  red.600 (etc.) — palette is the role-knob, the recipe doesn't
                 *  pin to a single brand stop. */
                background: "colorPalette.600",
                color: "white",
                fontWeight: "semibold",
                _hover:  { background: "colorPalette.700" },
                _active: { background: "colorPalette.800", transform: "scale(0.98)" },
            },
            ink: {
                /* Dual-CTA partner — always deep ink regardless of palette. */
                background: "{colors.brand.900}",
                color: "white",
                fontWeight: "semibold",
                _hover:  { background: "{colors.brand.800}" },
                _active: { background: "{colors.brand.700}", transform: "scale(0.98)" },
            },
            outline: {
                background: "bg.surface",
                color: "fg",
                borderWidth: "1px",
                borderColor: "border.strong",
                /* Hover signals via background tint (stays inside the
                 * button's perimeter), not border-color. In a standalone
                 * button either works; in an attached `<Group>` a
                 * border-color change creates a colour mismatch at the
                 * rounded outer corner where the lifted segment meets a
                 * neighbour's resting straight edge — reads as a
                 * "slightly different curve". The tint cue avoids that. */
                _hover:  { background: "bg.subtle" },
                _active: { background: "bg.muted", transform: "scale(0.98)" },
            },
            ghost: {
                background: "transparent",
                color: "fg.muted",
                _hover:  { background: "bg.subtle", color: "fg" },
                _active: { background: "bg.emphasized", transform: "scale(0.98)" },
            },
            danger: {
                background: "transparent",
                color: "fg.danger",
                borderWidth: "1px",
                borderColor: "border.strong",
                _hover:  { borderColor: "fg.danger" },
            },
            /* Commit-cluster buttons are the ORDINARY button family (spec
             * Commit.Bar recipe mock: `.btn` / `.btn.primary` in a gap row) —
             * the old full-height mono-segment treatment is retired. */
            commit: {
                background: "bg.surface",
                color: "fg",
                borderWidth: "1px",
                borderColor: "border.strong",
                _hover: { background: "bg.subtle" },
            },
            "commit-primary": {
                background: "{colors.brand.600}",
                color: "white",
                fontWeight: "semibold",
                _hover: { background: "{colors.brand.700}" },
            },
        },
        size: {
            xs: { height: "26px", paddingX: "{spacing.2}", fontSize: "11.5px" },
            sm: { height: "28px", paddingX: "{spacing.3}", fontSize: "{fontSizes.xs}"  /* 12 */ },
            md: { height: "32px", paddingX: "{spacing.3}", fontSize: "12.5px" },
            lg: { height: "40px", paddingX: "{spacing.5}", fontSize: "{fontSizes.sm}"  /* 14 */ },
        },
    },
    defaultVariants: {
        variant: "solid",
        size: "md",
        /* Default palette for the `solid` variant — brand-teal. Examples
         *  that want red / green / etc. set `colorPalette` explicitly. */
        colorPalette: "brand",
    },
});
