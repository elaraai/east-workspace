/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The inspector's shared parts (#1188, #1197) — what the Sheet's inspector
 * (`sheetInspector`) and the Plan's (`planInspector`) lay out alike: the
 * body's sections, padded 16px and ruled off one from the next, as Studio's
 * inspector's are; the head of what is selected, its eyebrow, its name and
 * its marks; a draft's chip; a section's head; the fields; the gestures; the
 * summary of several; the counts and the hints of nothing selected; and an
 * empty state. Each recipe spreads them under its own slots, beside its own
 * parts.
 *
 * Only the layout is the inspector's own: its words take the theme's text
 * styles, its controls are the shared `button` and `iconButton`, and its form
 * is `fieldForm`'s. The pane — its tab row, its collapse control and its rail
 * — is the Dock's.
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";

// `satisfies`, not an annotation: the recipes spread these into their base
// objects, and a `SystemStyleObject`-typed value would carry that whole type
// into each slot's inferred type — too large for declaration emit.

/** One of the body's sections, ruled off from the next. */
export const INSPECTOR_SECTION = {
    display: "flex",
    flexDirection: "column",
    padding: "{spacing.4}",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "border.subtle",
    minWidth: 0,
} as const satisfies SystemStyleObject;

/** The slots the shared parts style. */
export const inspectorSlots = [
    "root", "head", "eyebrow", "name", "marks", "chip", "sectionHead", "fields", "actions", "bulk", "summary",
    "stats", "stat", "statValue", "statLabel", "hints", "hint", "empty", "emptyTitle", "emptyHint",
] as const;

/** Their base styles. */
export const inspectorBase = {
    root: {
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "bg.surface",
    },
    /* What is selected: its name, and its marks. */
    head: { ...INSPECTOR_SECTION, gap: "5px" },
    eyebrow: { textStyle: "caption.eyebrow" },
    name: { textStyle: "title.card.md", color: "fg", overflowWrap: "anywhere" },
    marks: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "6px",
        "&:empty": { display: "none" },
    },
    /* A draft's chip: Pending (changed since the record held it), New (never applied). */
    chip: {
        textStyle: "mono.xs",
        display: "inline-flex",
        alignItems: "center",
        paddingX: "6px",
        paddingY: "1px",
        borderRadius: "{radii.sm}",
        borderWidth: "1px",
        borderStyle: "solid",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        "&[data-state=pending]": { background: "brandTint", borderColor: "brandTint", color: "brand.solid" },
        "&[data-state=new]": { background: "bg.subtle", borderColor: "border.strong", color: "fg.strong" },
    },
    sectionHead: { textStyle: "caption.eyebrow" },
    /* Its fields: the form. */
    fields: { ...INSPECTOR_SECTION, gap: "{spacing.3}" },
    /* Its gestures. */
    actions: {
        display: "flex",
        flexWrap: "wrap",
        gap: "{spacing.2}",
        padding: "{spacing.4}",
    },
    /* Several selected: how many, and an edit across them. */
    bulk: { ...INSPECTOR_SECTION, gap: "{spacing.3}" },
    summary: { textStyle: "title.card.md", color: "fg" },
    /* Nothing selected: the counts, and what to do. */
    stats: {
        ...INSPECTOR_SECTION,
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: "{spacing.3}",
    },
    stat: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
    statValue: { textStyle: "num", color: "fg" },
    statLabel: { textStyle: "caption.eyebrow" },
    hints: {
        display: "flex",
        flexDirection: "column",
        gap: "{spacing.2}",
        margin: "0",
        padding: "{spacing.4}",
        paddingLeft: "calc({spacing.4} + 14px)",
    },
    hint: { textStyle: "body.sm", color: "fg.muted", textWrap: "pretty" },
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
} satisfies Record<(typeof inspectorSlots)[number], SystemStyleObject>;

/** A schedule status badge shared by Plan and Calendar inspectors. */
export const INSPECTOR_STATUS = {
    fontFamily: "mono",
    fontSize: "9px",
    fontWeight: "600",
    letterSpacing: "0.12em",
    lineHeight: "normal",
    textTransform: "uppercase",
    paddingX: "{spacing.1}",
    paddingY: "1px",
    borderRadius: "{radii.xs}",
    whiteSpace: "nowrap",
    "&[data-tone=success]": { background: "bg.success.subtle", color: "fg.success" },
    "&[data-tone=warning]": { background: "bg.warning.subtle", color: "fg.warning" },
    "&[data-tone=danger]": { background: "bg.danger.subtle", color: "fg.danger" },
    "&[data-tone=info]": { background: "bg.brand.subtle", color: "brand.fg" },
    "&[data-tone=neutral]": { background: "bg.subtle", color: "fg.muted" },
    "&[data-ring]": { background: "transparent", boxShadow: "inset 0 0 0 1px currentColor" },
} as const satisfies SystemStyleObject;
