/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Edit history slot recipe — the editing session's Undo / Redo / Discard /
 * Apply bar (#879), shared by every editable collection. It sits in its
 * host's toolbar, beside the search, not in a row of its own: a status line
 * (mono 11px `fg.muted`), the issues button (hidden, keeping its place, while
 * there are none), the history buttons (the `iconButton` recipe: on a coarse
 * pointer they keep their size and take a 44px touch target from its halo,
 * #346, so a phone's toolbar row holds them beside the rest — the user's
 * ruling, #1193), and under them the latest error in `fg.danger`. First among
 * the buttons, while a conflict waits, the conflicts button: the not-equal
 * icon in `--warn` and how many wait in mono 11/600 in its text step, at its
 * neighbours' height, on the third paper while its popover is open
 * (`editConflicts` draws the popover's body). A host that
 * shows the error in its banners instead (`SessionBanners`) lists an Apply's
 * issues there, one to a line.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const editHistorySlotRecipe = defineSlotRecipe({
    className: "elara-edit-history",
    slots: ["root", "actions", "status", "button", "issues", "conflicts", "conflictsCount", "error", "notice", "bannerIssues", "bannerIssue"],
    base: {
        root: {
            flexShrink: "0",
            padding: "0",
            background: "transparent",
        },
        actions: {
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            flexWrap: "nowrap",
            gap: "{spacing.2}",
        },
        status: {
            flex: "none",
            whiteSpace: "nowrap",
            fontFamily: "mono",
            fontSize: "label.lg",
            color: "fg.muted",
        },
        button: {
            flexShrink: "0",
            // Locked while a run of the app's optimiser is out (#1409, R2): the disabled look, the control kept.
            "&[aria-disabled=true]": { color: "fg.muted", cursor: "not-allowed", opacity: 0.5 },
        },
        issues: {
            display: "flex",
            flexShrink: "0",
            // Only while there are issues: no slot is kept for none.
            "&[data-empty]": { display: "none" },
        },
        conflicts: {
            width: "auto",
            minWidth: "28px",
            paddingX: "{spacing.2}",
            gap: "{spacing.2}",
            "& svg": { color: "status.warn", fontSize: "14px" },
            // Every one chosen, its popover still open: the icon alone, in the ink of a settled control.
            "&[data-settled] svg": { color: "fg.muted" },
            "&[data-state=open]": { background: "bg.subtle" },
        },
        conflictsCount: { fontFamily: "mono", fontSize: "11px", fontWeight: "semibold", color: "fg.warning", fontVariantNumeric: "tabular-nums" },
        error: {
            marginTop: "{spacing.2}",
            fontSize: "body.sm",
            color: "fg.danger",
        },
        /* What the bar says of drafts a reload would lose, or could not restore, where it says its error. */
        notice: {
            marginTop: "{spacing.2}",
            fontSize: "body.sm",
            color: "fg.warning",
        },
        /* An Apply's issues in a banner's body: one to a line, unmarked. */
        bannerIssues: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.1}",
            margin: "0",
            padding: "0",
            listStyle: "none",
        },
        bannerIssue: {
            minWidth: "0",
            overflowWrap: "anywhere",
        },
    },
});
