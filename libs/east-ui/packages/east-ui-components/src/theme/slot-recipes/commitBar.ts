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
 * segments. `btn` mirrors the button recipe's `outline`, `btnPrimary` its
 * `solid` (spec `--brand-d` fill), `btnDanger` its `danger`; each slot is
 * self-contained — apply one per button, no merging at the call site.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

// Mirrors the spec's generic `.btn` (body 12.5px / 500, 6px radius,
// 1px rule-strong border) — the same family as the `button` recipe at `md`.
const btnBase = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    height: "32px",
    paddingInline: "12px",
    borderRadius: "{radii.md}",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "border.strong",
    background: "bg.surface",
    color: "fg",
    fontFamily: "body",
    fontSize: "12.5px",
    fontWeight: "medium",
    lineHeight: "1.15",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transitionProperty: "background, color, border-color",
    transitionDuration: "{durations.fast}",
} as const;

const btnDisabled = {
    "&[aria-disabled=true]": {
        cursor: "not-allowed",
        opacity: 0.5,
        background: "bg.muted",
        color: "fg.subtle",
        borderColor: "border.subtle",
        _hover: { background: "bg.muted", color: "fg.subtle" },
    },
} as const;

export const commitBarSlotRecipe = defineSlotRecipe({
    className: "elara-commit-bar",
    slots: ["root", "draft", "pending", "btnRow", "btn", "btnPrimary", "btnDanger"],
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
        // Secondary commit action (Rerun / Reset / Modify) — the outline look.
        btn: {
            ...btnBase,
            _hover: { background: "bg.subtle" },
            ...btnDisabled,
        },
        // The one committing action (Approve all / Apply) — the solid look,
        // spec `.btn.primary`: --brand-d fill, --brand-dd hover.
        btnPrimary: {
            ...btnBase,
            background: "{colors.brand.600}",
            color: "white",
            fontWeight: "semibold",
            borderColor: "{colors.brand.600}",
            _hover: { background: "{colors.brand.700}", borderColor: "{colors.brand.700}", color: "white" },
            ...btnDisabled,
        },
        // Destructive commit action (Reject all / Discard) — the danger look.
        btnDanger: {
            ...btnBase,
            background: "transparent",
            color: "fg.danger",
            _hover: { borderColor: "fg.danger" },
            ...btnDisabled,
        },
    },
});
