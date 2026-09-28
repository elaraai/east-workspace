/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Toolbar slot recipe (#952) — the one row every slice-rail host lays its
 * chrome in (`src/toolbar/`).
 *
 *   - Root: one row that never wraps and never scrolls. It takes its width
 *     from its container, never its content, so the forms the toolbar folds
 *     to cannot move the width it chooses them for. What does not fit once
 *     everything has folded is clipped at the row's end — horizontally only,
 *     so a control's focus ring and its tap halo still show.
 *   - Item: its own width (`flex: none`), whatever form it is in; the first
 *     item of the end cluster takes the row's slack before it.
 *   - Gap: `md` 10px (the Plan's band), `lg` 12px.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const toolbarSlotRecipe = defineSlotRecipe({
    className: "elara-toolbar",
    slots: ["root", "item"],
    base: {
        root: {
            display: "flex",
            flexWrap: "nowrap",
            alignItems: "center",
            flex: "1 1 0%",
            minWidth: "0",
            // `clip`, never `hidden`: the row must not become a scroll container.
            overflowX: "clip",
            overflowY: "visible",
        },
        item: {
            display: "inline-flex",
            alignItems: "center",
            flex: "none",
            "&[data-toolbar-end]": { marginInlineStart: "auto" },
        },
    },
    variants: {
        gap: {
            md: { root: { gap: "10px" } },
            lg: { root: { gap: "{spacing.3}" } },
        },
    },
    defaultVariants: { gap: "lg" },
});
