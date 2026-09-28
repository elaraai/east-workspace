/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Edit history slot recipe — the editing session's Undo / Redo / Discard /
 * Apply bar (#879), shared by every editable collection. It sits in its
 * host's toolbar, beside the search, not in a row of its own: a status line
 * (mono xs `fg.muted`), the issues button (hidden, keeping its place, while
 * there are none), the history buttons (the `iconButton` recipe, grown to the
 * touch floor on a coarse pointer), and under them the latest error in
 * `fg.danger`.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const editHistorySlotRecipe = defineSlotRecipe({
    className: "elara-edit-history",
    slots: ["root", "actions", "status", "button", "issues", "error"],
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
            fontSize: "xs",
            color: "fg.muted",
        },
        button: {
            flexShrink: "0",
            _coarse: { minWidth: "11", minHeight: "11" },
        },
        issues: {
            display: "flex",
            flexShrink: "0",
            "&[data-empty]": { visibility: "hidden" },
        },
        error: {
            marginTop: "{spacing.2}",
            fontSize: "xs",
            color: "fg.danger",
        },
    },
});
