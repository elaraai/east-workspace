/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Button recipe override — enforces the canonical button vocabulary.
 *
 * Variants are roles, not palettes:
 *  - `solid`   — the one primary action on a screen. The palette's solid
 *                fill; with no palette set, the brand (the default palette).
 *  - `ink`     — the dual-CTA partner to solid (deep ink fill).
 *  - `outline` — secondary actions (1 px subtle border, body weight 500).
 *  - `ghost`   — tertiary, low-stakes (Cancel, Dismiss).
 *  - `danger`  — destructive intent (subtle outline + danger ink color).
 *  - `commit`  — bottom-bar secondary action (the outline look in a commit cluster).
 *  - `commit-primary` — the one committing action (the `solid` look).
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
                /* Spec primary: `--brand-d` fill, `--paper` label at 600,
                 *  `--brand-dd` on hover and press (#1091). Routes through
                 *  `colorPalette` so `colorPalette="red"` produces red — the
                 *  palette is the role-knob — and reads only the mode-aware
                 *  roles every palette has: a numeric stop is the same colour
                 *  in both modes while the label flips, and a palette without
                 *  stops (`danger`) would take another palette's. */
                background: "colorPalette.solid",
                color: "colorPalette.contrast",
                fontWeight: "semibold",
                _hover:    { background: "colorPalette.solidHover" },
                _expanded: { background: "colorPalette.solidHover" },
                _active:   { background: "colorPalette.solidHover", transform: "scale(0.98)" },
            },
            ink: {
                /* Dual-CTA partner — always deep ink regardless of palette. */
                background: "{colors.brand.900}",
                color: "fg.inverse",
                fontWeight: "semibold",
                _hover:  { background: "{colors.brand.800}" },
                _active: { background: "{colors.brand.700}", transform: "scale(0.98)" },
            },
            /* Only the primary roles take the default palette, the brand. The
             *  neutral roles keep the gray palette: Chakra still reads it where
             *  these do not override — an expanded (open-menu) fill, and all of
             *  `subtle` / `surface` / `plain`. A `colorPalette` prop still
             *  selects another. */
            outline: {
                colorPalette: "gray",
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
                colorPalette: "gray",
                background: "transparent",
                color: "fg.muted",
                _hover:  { background: "bg.subtle", color: "fg" },
                _active: { background: "bg.emphasized", transform: "scale(0.98)" },
            },
            /* Chakra's own tinted roles, styled by its recipe. */
            subtle:  { colorPalette: "gray" },
            surface: { colorPalette: "gray" },
            plain:   { colorPalette: "gray" },
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
                background: "colorPalette.solid",
                color: "colorPalette.contrast",
                fontWeight: "semibold",
                _hover: { background: "colorPalette.solidHover" },
            },
        },
        size: {
            xs: { height: "26px", paddingX: "{spacing.2}", fontSize: "11.5px" },
            sm: { height: "28px", paddingX: "{spacing.3}", fontSize: "{fontSizes.xs}"  /* 12 */ },
            md: { height: "32px", paddingX: "{spacing.3}", fontSize: "12.5px" },
            lg: { height: "40px", paddingX: "{spacing.5}", fontSize: "{fontSizes.sm}"  /* 14 */ },
        },
    },
    /* No `colorPalette` here: it is a style prop, not a variant, so a default
     * for it does nothing. The default palette — brand — is set on `html`
     * (`global-css.ts`), where Chakra sets its own. */
    defaultVariants: {
        variant: "solid",
        size: "md",
    },
});
