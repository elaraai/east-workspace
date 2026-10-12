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
 * `fieldForm`'s and a link cell the `sheet` recipe's. What it lays out as the
 * Plan's inspector does — its sections, its head, its chip, its fields, its
 * gestures, the counts, the hints and the empty state — is the inspector's
 * shared parts (`inspector.ts`). The pane — its tab row, its collapse control
 * and its rail — is the Dock's.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { INSPECTOR_SECTION, inspectorBase, inspectorSlots } from "./inspector.js";

export const sheetInspectorSlotRecipe = defineSlotRecipe({
    className: "elara-sheet-inspector",
    slots: [
        ...inspectorSlots, "lock",
        "issues", "issue", "issueField", "issueText",
        "link", "linkCell", "subRows", "subRow", "subRowCode", "subRowName", "subRowFacts",
        "commit",
        "issueList", "issueItem", "issueWhere", "issueMessage",
    ],
    base: {
        ...inspectorBase,
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
        issues: { ...INSPECTOR_SECTION, gap: "6px" },
        issue: { display: "flex", flexDirection: "column", gap: "1px", minWidth: 0 },
        issueField: { textStyle: "mono.xs", color: "fg.subtle", textTransform: "uppercase", letterSpacing: "0.06em" },
        issueText: {
            textStyle: "body.sm",
            color: "fg.warning",
            overflowWrap: "anywhere",
            "&[data-kind=invalid]": { color: "fg.danger" },
        },
        /* A link's halves under their label, with Edit in sheet. */
        link: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px", minWidth: 0, width: "100%" },
        linkCell: { width: "100%", minWidth: 0 },
        /* The read-only rows under it (#844). */
        subRows: { ...INSPECTOR_SECTION, gap: "{spacing.2}" },
        subRow: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
        subRowCode: { textStyle: "mono.xs", color: "fg.subtle" },
        subRowName: { textStyle: "body.sm", color: "fg", overflowWrap: "anywhere" },
        subRowFacts: { textStyle: "mono.xs", color: "fg.muted", overflowWrap: "anywhere" },
        /* Nothing selected: the last save. */
        commit: { ...INSPECTOR_SECTION, textStyle: "mono.xs", color: "fg.subtle" },
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
    },
});
