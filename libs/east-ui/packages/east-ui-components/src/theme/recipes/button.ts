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
 *  - `commit`  — bottom-bar action (mono uppercase, no border, hairline divider).
 *  - `commit-primary` — primary commit (filled brand, mono uppercase).
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

export const buttonRecipe = defineRecipe({
    className: "elara-btn",
    base: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "2",
        fontFamily: "body",
        fontWeight: "medium",         // spec `.btn` is weight 500, not semibold
        lineHeight: "1",
        borderRadius: "md",            // 6px
        cursor: "pointer",
        userSelect: "none",
        /* `position: relative` alone is harmless — it doesn't create a
         * stacking context unless z-index is set. We use it as the
         * anchor so the scoped `z-index: 1` below (applied only when
         * inside a Chakra `<Group>`) can lift the hovered/focused
         * segment above its neighbours. */
        position: "relative",
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
        _disabled: {
            background: "{colors.gray.200}",
            color: "fg.muted",
            cursor: "not-allowed",
            boxShadow: "none",
            _hover: { background: "{colors.gray.200}" },
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
            commit: {
                fontFamily: "mono",
                fontSize: "11.5px",
                fontWeight: "semibold",
                letterSpacing: "{letterSpacings.widest}",
                textTransform: "uppercase",
                background: "bg.surface",
                color: "fg.muted",
                borderWidth: "0",
                borderLeftWidth: "1px",
                borderLeftColor: "border.subtle",
                borderRadius: "0",
                paddingX: "{spacing.5}",
                paddingY: "{spacing.3}",
                _hover: { background: "bg.canvas", color: "fg" },
            },
            "commit-primary": {
                fontFamily: "mono",
                fontSize: "11.5px",
                fontWeight: "semibold",
                letterSpacing: "{letterSpacings.widest}",
                textTransform: "uppercase",
                background: "{colors.brand.600}",
                color: "white",
                borderRadius: "0",
                paddingX: "{spacing.5}",
                paddingY: "{spacing.3}",
                _hover: { background: "{colors.brand.700}" },
            },
        },
        size: {
            xs: { height: "26px", paddingX: "{spacing.2}", fontSize: "11.5px" },
            sm: { height: "28px", paddingX: "{spacing.3}", fontSize: "{fontSizes.xs}"  /* 12 */ },
            md: { height: "32px", paddingX: "{spacing.3}", fontSize: "{fontSizes.sm}"  /* 14 */ },
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
