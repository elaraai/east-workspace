/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio inspector slot recipe — the layout of the builder's inspector pane's
 * body, as the Studio spec draws it under the pane's tab row: the selected
 * placement's name and key, the datasets it reads, its description on the
 * quiet panel with its lock, and its layout fields, over the pane's footer;
 * with nothing selected, what to do.
 *
 * Only the layout is the inspector's own. Its words take the theme's text
 * styles, and its controls are the shared ones — the `stepper` (the span, in
 * the brand), the `input` (the row), the `select` (the height) and the `seg`
 * strip (the alignment). The pane itself — its tab row, its collapse control
 * and its rail — is the Dock's.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** One of the body's sections, ruled off from the next. */
const SECTION = {
    display: "flex",
    flexDirection: "column",
    padding: "{spacing.4}",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "border.subtle",
} as const;

export const studioInspectorSlotRecipe = defineSlotRecipe({
    className: "elara-studio-inspector",
    slots: [
        "root", "selection", "eyebrow", "name", "meta", "warning",
        "data", "reads", "read", "noReads",
        "config", "configHead", "lockNote", "description",
        "layout", "field", "fieldLabel", "rowField", "heightField",
        "footer", "empty", "emptyTitle", "emptyHint",
    ],
    base: {
        root: {
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            background: "bg.surface",
        },
        /* The selected placement: its name and its component's key. */
        selection: { ...SECTION, gap: "5px" },
        eyebrow: { textStyle: "caption.eyebrow" },
        name: { textStyle: "title.card.md", color: "fg", overflowWrap: "anywhere" },
        meta: { textStyle: "mono.sm", color: "fg.subtle", overflowWrap: "anywhere" },
        /* Its component's code changed since the page went live. */
        warning: {
            textStyle: "mono.sm",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            color: "fg.warning",
            "& svg": { fontSize: "9px", flexShrink: 0 },
        },
        /* What its component's code reads. */
        data: { ...SECTION, gap: "10px" },
        reads: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.1}",
            margin: "0",
            padding: "0",
            listStyle: "none",
        },
        read: { textStyle: "mono.md", color: "fg", overflowWrap: "anywhere" },
        noReads: { textStyle: "mono.md", color: "fg.subtle" },
        /* Its description, fixed by its developer, on the quiet panel. */
        config: { ...SECTION, gap: "9px", background: "bg.panel" },
        configHead: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "{spacing.3}",
        },
        lockNote: {
            textStyle: "mono.xs",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            color: "fg.subtle",
            "& svg": { fontSize: "9px" },
        },
        description: {
            textStyle: "body.sm",
            margin: "0",
            /* Strong secondary ink, `--ink-2`. */
            color: "fg.strong",
            "&[data-empty]": { color: "fg.subtle" },
        },
        /* Its layout: one row per field, its label and its control. */
        layout: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.3}",
            padding: "{spacing.4}",
        },
        field: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "{spacing.3}",
        },
        fieldLabel: { textStyle: "body.sm", color: "fg" },
        rowField: { flex: "none", width: "72px" },
        heightField: { flex: "none", width: "96px" },
        footer: {
            textStyle: "mono.xs",
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            paddingX: "{spacing.4}",
            paddingY: "{spacing.3}",
            borderTopWidth: "1px",
            borderTopStyle: "solid",
            borderTopColor: "border.subtle",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "fg.subtle",
            "& svg": { fontSize: "9px" },
        },
        /* Nothing selected: what to do. */
        empty: {
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "{spacing.2}",
            padding: "{spacing.6}",
            textAlign: "center",
        },
        emptyTitle: { textStyle: "caption.eyebrow" },
        emptyHint: { textStyle: "body.sm", maxWidth: "220px", color: "fg.muted", textWrap: "pretty" },
    },
});
