/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * EmptyState slot recipe — pattern_spec/spec.css `.empty`.
 *
 * Centered prose block: 36 px paddingX, 28 px paddingY, a 36 px icon
 * indicator in `border.strong` — Font Awesome's, never a text glyph (#1263) —
 * title 15 px / 600 ink, description 13.5 px `fg.muted`.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const emptyStateSlotRecipe = defineSlotRecipe({
    className: "elara-empty-state",
    slots: ["root", "content", "indicator", "title", "description", "actions"],
    base: {
        root: {
            background: "bg.surface",
        },
        content: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            paddingX: "{spacing.8}",
            paddingY: "{spacing.10}",
            gap: "{spacing.2}",
        },
        /* The icon: its size is the indicator's font size (Chakra's `_icon`
         * sizes it 1em), in the strong rule. */
        indicator: {
            fontSize: "36px",
            color: "border.strong",
            marginBottom: "{spacing.3}",
            lineHeight: "1",
        },
        title: {
            fontSize: "{fontSizes.title.xs}",   // 15 — the design system's empty-state title
            fontWeight: "semibold",
            color: "fg",
            lineHeight: "{lineHeights.snug}",
        },
        description: {
            fontSize: "13.5px",
            color: "fg.muted",
            lineHeight: "{lineHeights.normal}",
            maxWidth: "44ch",
        },
        actions: {
            marginTop: "{spacing.4}",
            display: "flex",
            gap: "{spacing.2}",
        },
    },
    variants: {
        // Each size's icon is its own: Chakra's recipe, merged beneath, gives
        // the indicator a text style per size (60px at lg), which outranks a
        // font size — so each size clears it (#1263).
        size: {
            sm: { content: { paddingX: "{spacing.5}", paddingY: "{spacing.6}" }, indicator: { textStyle: "none", fontSize: "24px" } },
            md: { content: { paddingX: "{spacing.8}", paddingY: "{spacing.10}" }, indicator: { textStyle: "none", fontSize: "36px" } },
            lg: { content: { paddingX: "{spacing.10}", paddingY: "{spacing.16}" }, indicator: { textStyle: "none", fontSize: "48px" } },
        },
    },
    defaultVariants: {
        size: "md",
    },
});
