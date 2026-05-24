/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * CommitBar slot recipe — spec `.commit-bar`.
 *
 * The footer of a `frame` that stages an action: a mono uppercase `draft`
 * status on the left (`pending` highlights the live count), then a `btnRow`
 * of full-height, zero-radius, rule-divided mono buttons. Each button slot
 * (`btn` ghost, `btnPrimary` committing, `btnDanger` destructive) is
 * self-contained — apply one per button, no merging at the call site.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

const btnBase = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    paddingInline: "22px",
    paddingBlock: "14px",
    borderRadius: "0",
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: "border.subtle",
    background: "bg.surface",
    color: "fg.muted",
    fontFamily: "mono",
    fontSize: "11.5px",
    fontWeight: "semibold",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transitionProperty: "background, color",
    transitionDuration: "{durations.fast}",
} as const;

const btnDisabled = {
    "&[aria-disabled=true]": {
        cursor: "not-allowed",
        opacity: 0.5,
        background: "bg.muted",
        color: "fg.subtle",
        borderLeftColor: "border.subtle",
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
        btnRow: { display: "flex" },
        btn: {
            ...btnBase,
            _hover: { background: "bg.canvas", color: "fg" },
            ...btnDisabled,
        },
        btnPrimary: {
            ...btnBase,
            background: "{colors.brand.700}",
            color: "white",
            borderLeftColor: "{colors.brand.700}",
            _hover: { background: "{colors.brand.800}", color: "white" },
            ...btnDisabled,
        },
        btnDanger: {
            ...btnBase,
            color: "fg.danger",
            _hover: { background: "danger.subtle", color: "fg.danger" },
            ...btnDisabled,
        },
    },
});
