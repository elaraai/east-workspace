/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * CommitBar slot recipe — spec `.commit-bar`.
 *
 * The footer of a `frame` that stages an action: a mono uppercase `draft`
 * status on the left (`pending` highlights the live count), then a `btnRow`
 * cluster of ORDINARY buttons — the generic `.btn` family (the Commit.Bar
 * recipe mock's `.btn` / `.btn.primary` gap row), not full-height mono
 * segments.
 *
 * The buttons themselves are NOT slots here. This recipe used to carry `btn` /
 * `btnPrimary` / `btnDanger`, each documented as "mirrors the button recipe's
 * outline / solid / danger" — a hand-maintained copy of another recipe, which
 * is exactly how it drifted: adopters styled their per-ROW Approve from the
 * button recipe and their BATCH Approve all from here, and the same verb ended
 * up painted two different greens. The buttons now come from the `button`
 * recipe at both scales (rows `xs`, the foot `md`), so they cannot disagree.
 * This recipe keeps what it is actually for: the bar's LAYOUT. Its status
 * takes the room the buttons leave, 192px at least while it says anything; a bar too narrow for both
 * on one line — a phone's table — puts the buttons on a line of their own
 * under it, at its right edge, wrapping them where even that is too narrow,
 * never past the bar's edge.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const commitBarSlotRecipe = defineSlotRecipe({
    className: "elara-commit-bar",
    slots: ["root", "draft", "pending", "btnRow"],
    base: {
        root: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "0",
            borderTopWidth: "1px",
            borderTopStyle: "solid",
            borderTopColor: "border.subtle",
        },
        draft: {
            paddingInline: "18px",
            paddingBlock: "14px",
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "semibold",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.subtle",
            flexGrow: "1",
            flexShrink: "1",
            flexBasis: "192px",
            minWidth: "0",
            /* With nothing to say it asks for no room: the buttons keep their line. */
            "&:empty": { flexBasis: "0" },
        },
        pending: { color: "fg" },
        btnRow: {
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            alignItems: "center",
            marginInlineStart: "auto",
            gap: "8px",
            padding: "10px 18px",
        },
    },
});
