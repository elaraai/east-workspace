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
 * lists the batch's issues by row, each a control that goes to its cell — one
 * whose row the rail's filters hide saying which.
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
        "issueList", "issueItem", "issueWhere", "issueMessage", "issueHidden",
        "phoneHead", "phoneEyebrow", "phoneName", "phoneChip", "phoneField", "phoneFieldHead", "phoneLabel", "phoneKey", "phoneActions", "phoneButton",
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
        /* An issue whose row the rail's filters hide: which, and that a click clears them. */
        issueHidden: { textStyle: "body.sm", color: "fg.muted", overflowWrap: "anywhere" },
        /* A phone's Details (`Mobile Sheet Spec.md` SH12, the designer's `WorkOrdersPhone`): its head padded 16 20 — the
         * eyebrow mono 10/600 in `--ink-4`, the name DM Sans 16/700, a draft's chip 20 tall on the brand's tint, 4 under
         * it, and a lock after the chip — their row kept while it holds neither where its view takes edits (`data-writes`,
         * #1584): a chip arriving with the first edit moves nothing under it. */
        phoneHead: {
            display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", rowGap: "4px",
            paddingY: "16px", paddingX: "20px",
            borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
            _focusVisible: { outline: "none", boxShadow: "{shadows.focusInset}" },
            "&[data-writes]": { gridTemplateRows: "auto auto 24px" },
            "& > [data-inspector-lock]": { gridRow: "3", gridColumn: "2", alignSelf: "end", minHeight: "20px" },
        },
        phoneEyebrow: {
            gridColumn: "1 / -1", fontFamily: "mono", fontSize: "label.sm", fontWeight: 600, lineHeight: "1.4", letterSpacing: "0.14em",
            textTransform: "uppercase", color: "fg.subtle", overflowWrap: "anywhere",
        },
        phoneName: { gridColumn: "1 / -1", fontFamily: "heading", fontSize: "title.md", fontWeight: 700, letterSpacing: "-0.01em", lineHeight: "1.25", color: "fg", overflowWrap: "anywhere" },
        phoneChip: {
            gridRow: "3", gridColumn: "1", justifySelf: "start", marginTop: "4px", marginInlineEnd: "8px", height: "20px", display: "inline-flex", alignItems: "center", paddingX: "8px",
            boxSizing: "border-box", borderRadius: "sm", fontFamily: "mono", fontSize: "label.sm", fontWeight: 500,
            "&[data-state=pending]": { background: "brandTint", color: "brandPressed" },
            "&[data-state=new]": { background: "bg.subtle", color: "fg.strong" },
        },
        /* Each field a section of its own, padded 16 20 between rules, its parts 8 apart. */
        phoneField: {
            position: "relative",
            display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "8px", minWidth: 0, paddingY: "16px", paddingX: "20px",
            borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
            /* The field's own form at touch size, its label the section's: the shared Field's own label hidden — never a
             * radio's or a checkbox's, which are its control — and each field of a variant's block keeping its own (#1549). */
            "& [data-field-form], & [data-field], & [data-field-line]": { minWidth: 0, maxWidth: "100%" },
            "& [data-field] [data-scope=field][data-part=label]:not([data-field-block] *)": { display: "none" },
            "& [data-field-line] input, & [data-field-line] button, & [data-field-line] [data-part=trigger]": { minHeight: "44px" },
        },
        /* Its label 13/500 in ink over its name, mono 11 in `--ink-4`. */
        phoneFieldHead: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0 },
        phoneLabel: { display: "grid", gap: "2px", flex: 1, minWidth: 0, fontSize: "body", fontWeight: 500, lineHeight: "1.4", color: "fg" },
        phoneKey: { fontFamily: "mono", fontSize: "label.lg", fontWeight: 400, lineHeight: "1.4", color: "fg.subtle" },
        /* Its gestures: Default 44 buttons, two to a line. */
        phoneActions: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px", paddingY: "16px", paddingX: "20px" },
        phoneButton: {
            minHeight: "44px", height: "44px", width: "100%", justifyContent: "center", paddingX: "8px",
            borderColor: "border.strong", borderRadius: "md", background: "bg.surface", fontSize: "body.sm", fontWeight: 500, color: "fg",
        },
    },
});
