/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Sheet inspector slot recipe — the layout of the Sheet builder's inspector
 * pane (#1188, `Sheet Builder Spec.md` §8, §9.9), its sections padded 16px
 * and ruled off one from the next, as Studio's inspector's are.
 *
 * Details for one row: its number and id, a Pending or New chip, the lock of
 * a row owned upstream; its issues; its fields — `FieldForm`, whose own
 * recipe lays them out — a link's halves drawn as the grid draws them, with
 * Edit in sheet; its sub rows; and its gestures. For a band, several rows, or
 * nothing selected, the same sections hold what they show. The Issues tab
 * lists the batch's issues by row, each a control that goes to its cell.
 *
 * Only the layout is the inspector's own: its words take the theme's text
 * styles, its controls are the shared `button` and `iconButton`, its form is
 * `fieldForm`'s and a link cell the `sheet` recipe's. The pane — its tab row,
 * its collapse control and its rail — is the Dock's.
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
    minWidth: 0,
} as const;

export const sheetInspectorSlotRecipe = defineSlotRecipe({
    className: "elara-sheet-inspector",
    slots: [
        "root", "head", "eyebrow", "name", "marks", "chip", "lock",
        "issues", "sectionHead", "issue", "issueField", "issueText",
        "fields", "link", "linkCell", "subRows", "subRow", "subRowCode", "subRowName", "subRowFacts",
        "actions", "bulk", "summary",
        "stats", "stat", "statValue", "statLabel", "commit", "hints", "hint",
        "issueList", "issueItem", "issueWhere", "issueMessage", "empty", "emptyTitle", "emptyHint",
    ],
    base: {
        root: {
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            background: "bg.surface",
        },
        /* What is selected: its number, its id, and its marks. */
        head: { ...SECTION, gap: "5px" },
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
        /* A row the upstream system owns. */
        lock: {
            textStyle: "mono.xs",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            color: "fg.subtle",
            "& svg": { fontSize: "9px" },
        },
        /* Its issues, each its field and what is wrong. */
        issues: { ...SECTION, gap: "6px" },
        sectionHead: { textStyle: "caption.eyebrow" },
        issue: { display: "flex", flexDirection: "column", gap: "1px", minWidth: 0 },
        issueField: { textStyle: "mono.xs", color: "fg.subtle", textTransform: "uppercase", letterSpacing: "0.06em" },
        issueText: {
            textStyle: "body.sm",
            color: "fg.warning",
            overflowWrap: "anywhere",
            "&[data-kind=invalid]": { color: "fg.danger" },
        },
        /* Its fields: the form, and a link's halves under their label with Edit in sheet. */
        fields: { ...SECTION, gap: "{spacing.3}" },
        link: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px", minWidth: 0, width: "100%" },
        linkCell: { width: "100%", minWidth: 0 },
        /* The read-only rows under it (#844). */
        subRows: { ...SECTION, gap: "{spacing.2}" },
        subRow: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
        subRowCode: { textStyle: "mono.xs", color: "fg.subtle" },
        subRowName: { textStyle: "body.sm", color: "fg", overflowWrap: "anywhere" },
        subRowFacts: { textStyle: "mono.xs", color: "fg.muted", overflowWrap: "anywhere" },
        /* Its gestures. */
        actions: {
            display: "flex",
            flexWrap: "wrap",
            gap: "{spacing.2}",
            padding: "{spacing.4}",
        },
        /* Several rows: how many, and an edit across them. */
        bulk: { ...SECTION, gap: "{spacing.3}" },
        summary: { textStyle: "title.card.md", color: "fg" },
        /* Nothing selected: the counts, the last save, and what to do. */
        stats: {
            ...SECTION,
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "{spacing.3}",
        },
        stat: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
        statValue: { textStyle: "num", color: "fg" },
        statLabel: { textStyle: "caption.eyebrow" },
        commit: { ...SECTION, textStyle: "mono.xs", color: "fg.subtle" },
        hints: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
            margin: "0",
            padding: "{spacing.4}",
            paddingLeft: "calc({spacing.4} + 14px)",
        },
        hint: { textStyle: "body.sm", color: "fg.muted", textWrap: "pretty" },
        /* The Issues tab: every issue of the batch by row, each a control. */
        issueList: { display: "flex", flexDirection: "column", minWidth: 0, margin: "0", padding: "0", listStyle: "none" },
        issueItem: {
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "2px",
            width: "100%",
            paddingX: "{spacing.4}",
            paddingY: "10px",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderBottomColor: "border.subtle",
            background: "transparent",
            textAlign: "left",
            cursor: "pointer",
            _hover: { background: "bg.subtle" },
            _focusVisible: { outline: "none", boxShadow: "{shadows.focusInset}" },
        },
        issueWhere: { textStyle: "mono.xs", color: "fg.subtle", letterSpacing: "0.06em", textTransform: "uppercase" },
        issueMessage: {
            textStyle: "body.sm",
            color: "fg.warning",
            overflowWrap: "anywhere",
            "&[data-kind=invalid]": { color: "fg.danger" },
        },
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
