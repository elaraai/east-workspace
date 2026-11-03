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
 *   - Item: one that grows (`data-toolbar-grow`) takes the row's slack, and
 *     may shrink to nothing — a phone's view tabs, which scroll inside it.
 *   - Item: one that gives way (`data-toolbar-shrink`, a phone's count line)
 *     does so before one that grows does, and what follows it stands at the
 *     row's end.
 *   - Gap: `md` 10px (the Plan's band), `lg` 12px, `none` with no padding
 *     either — a phone's row, whose items carry their own (`Mobile Builder
 *     Frame Spec.md` FR2).
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
            // Reserve real space for the first and last control's focus ring.
            // Clip margins do not extend a single-axis clip in every browser.
            paddingInline: "{spacing.1}",
        },
        item: {
            display: "inline-flex",
            alignItems: "center",
            flex: "none",
            "&[data-toolbar-end]": { marginInlineStart: "auto" },
            "&[data-toolbar-grow]": { flex: "1 1 auto", minWidth: "0", alignSelf: "stretch" },
            /* Gives way before anything else does, the row's slack past it: what follows stands at the row's end. */
            "&[data-toolbar-shrink]": { flex: "0 1000 auto", minWidth: "0", overflow: "hidden" },
            "&[data-toolbar-shrink] + [data-toolbar-item]": { marginInlineStart: "auto" },
        },
    },
    variants: {
        gap: {
            md: { root: { gap: "10px" } },
            lg: { root: { gap: "{spacing.3}" } },
            none: { root: { gap: "0", paddingInline: "0", alignSelf: "stretch" } },
        },
    },
    defaultVariants: { gap: "lg" },
});
