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
 *
 * In a phone's frame (`data-history-form=phone`, the toolbar's second row,
 * `Mobile Builder Frame Spec.md` FR6): the row's width, the drafts' count at
 * its start (`No changes` mono 11 `fg.subtle`, or a `brandTint` chip mono
 * 11/600 in `brandPressed`), then 44px outline squares with a 16px icon, Save
 * filled `brand.solid` while it would save and a live dot in its place while
 * one is out; Discard's question below it, its title DM Sans 20/700.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const editHistorySlotRecipe = defineSlotRecipe({
    className: "elara-edit-history",
    slots: ["root", "actions", "status", "button", "issues", "conflicts", "conflictsCount", "error", "notice", "bannerIssues", "bannerIssue",
        "summary", "changes", "live", "askTitle", "askBody", "askButton"],
    base: {
        root: {
            flexShrink: "0",
            padding: "0",
            background: "transparent",
            /* A phone's: no box of its own, its parts the session row's items, so the count leads the row and the eye
             * listed before the history sits before Issues (R4). */
            "&[data-history-form=phone]": { display: "contents" },
        },
        actions: {
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            flexWrap: "nowrap",
            gap: "{spacing.2}",
            "[data-history-form=phone] > &": { display: "contents" },
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
            /* A phone's (the designer's `WorkOrdersPhone`): 44px squares on `--r-md`, `--rule-strong` and ink while they act,
             * `--rule` and `--ink-5` while they don't, never faded; Save `--brand-d` while it would save. */
            "[data-history-form=phone] &": {
                width: "44px", height: "44px", minWidth: "44px", padding: "0", borderRadius: "md", borderWidth: "1px",
                borderColor: "border.strong", background: "bg.surface", color: "fg", "& svg": { fontSize: "16px" },
                "&:disabled, &[aria-disabled=true]": { borderColor: "border.subtle", color: "fg.faint", opacity: 1 },
                "&[data-ready]": { background: "brand.solid", borderColor: "brand.solid", color: "brand.contrast" },
            },
            // Locked while a run of the app's optimiser is out (#1409, R2): the disabled look, the control kept.
            "&[aria-disabled=true]": { color: "fg.muted", cursor: "not-allowed", opacity: 0.5 },
        },
        issues: {
            display: "flex",
            flexShrink: "0",
            // With none, hidden in its slot, which is held (#1398, CL1): the bar keeps its width as issues come and go.
            "&[data-empty]": { visibility: "hidden" },
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
        /* A phone's row: what a Save is doing, else the drafts' count, taking what the buttons leave. */
        summary: {
            order: -1, flex: "1 1 auto", minWidth: "0", display: "flex", alignItems: "center", overflow: "hidden",
            /* The frame's loading line showing at the row's start, the count steps aside for it (R5); a Save's words do not. */
            "&[data-history-summary=count]": { "[data-frame-slot=sessionRow]:has([data-footer-line]:not([data-idle])) &": { display: "none" } },
        },
        changes: {
            fontFamily: "mono", fontSize: "label.lg", fontWeight: "500", color: "fg.subtle", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
            "&[data-changes]": {
                height: "24px", display: "inline-flex", alignItems: "center", paddingX: "{spacing.2}", borderRadius: "sm",
                background: "brandTint", color: "brandPressed", fontWeight: "600",
            },
        },
        /* Save's live dot while it is out: an echo of the dot, as an auto save's. */
        live: {
            position: "relative", width: "8px", height: "8px", borderRadius: "full", background: "currentColor",
            "&::after": {
                content: '""', position: "absolute", inset: "0", borderRadius: "full", background: "currentColor",
                animation: "elara-live-pulse calc({durations.slow} * 4) {easings.out} infinite",
                _motionReduce: { animation: "none" },
            },
        },
        askTitle: { fontFamily: "heading", fontSize: "title.lg", fontWeight: "700", letterSpacing: "-0.015em", color: "fg", lineHeight: "1.2" },
        askBody: { fontSize: "body", color: "fg.strong", lineHeight: "1.5" },
        askButton: { minHeight: "44px" },
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
