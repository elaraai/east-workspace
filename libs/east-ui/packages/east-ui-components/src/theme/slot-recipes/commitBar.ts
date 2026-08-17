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
 * This recipe keeps what it is actually for: the bar's LAYOUT.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const commitBarSlotRecipe = defineSlotRecipe({
    className: "elara-commit-bar",
    slots: ["root", "draft", "pending", "btnRow"],
    base: {
        root: {
            display: "grid",
            gridTemplateColumns: "1fr auto",
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
            alignSelf: "center",
        },
        pending: { color: "fg" },
        btnRow: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 18px",
        },
    },
});
