/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ReviewChrome slot recipe — the shared decision-column pieces of the review
 * contract (`contracts/review.ts`), lifted copy-exact from the Planner's
 * review chrome (PR #76) so every adopter (Table, Roster, Board, Plan)
 * wears identical chrome. The batch foot stays on the sibling `commitBar`
 * recipe; the Approve / Reject pair reuses the shared `button` recipe.
 *
 * Slots:
 * - `decisionHeader` — the decision-column header cell.
 * - `decisionCol` — the per-row decision cell (the Approve/Reject pair).
 * - `statusDot` — the quiet per-row status dot beside the subject's identity.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const reviewChromeSlotRecipe = defineSlotRecipe({
    className: "elara-review-chrome",
    slots: ["decisionHeader", "decisionCol", "statusDot"],
    base: {
        // Review decision-column header — mirrors the column-header type rhythm
        // but right-anchored, with a left rule fencing the column off from the
        // grid (the way a frozen pane is fenced). Width comes from the layout
        // the renderer builds, not from this slot.
        decisionHeader: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "semibold",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "fg.subtle",
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            borderBottomWidth: "1px",
            borderBottomColor: "border.strong",
            borderLeftWidth: "1px",
            borderLeftColor: "border.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            minWidth: 0,
        },
        // Per-row decision cell — the Approve/Reject pair, right-aligned and
        // fenced by the same left rule. Vertical rhythm comes from the row's
        // own min-height; sticky-right pinning + wash are applied by the renderer.
        decisionCol: {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "6px",
            padding: "0 12px",
            borderLeftWidth: "1px",
            borderLeftColor: "border.subtle",
            boxSizing: "border-box",
            // On a card (the Plan's narrow layout, §10) there is no column to
            // fence: the pair sits in the card's own foot, rule-less.
            "[data-plan-narrow] &": { borderLeftWidth: 0, padding: 0 },
        },
        // The quiet status dot beside the subject's identity (some ⇒ flagged).
        // Colour rides the `status` variant; this is just the 8px disc geometry.
        // Reads as one flag per row, not a per-cell ring (which is too busy).
        statusDot: {
            display: "inline-block",
            width: "8px",
            height: "8px",
            borderRadius: "{radii.full}",
            marginRight: "6px",
            flexShrink: 0,
            verticalAlign: "middle",
            background: "fg.subtle",
        },
    },
    variants: {
        // Density-driven header rhythm — mirrors the adopters' own header cells.
        size: {
            sm: { decisionHeader: { paddingY: "{spacing.1.5}" } },
            md: {},
            lg: { decisionHeader: { paddingY: "{spacing.3}" } },
        },
        // The row's status axis — colours the quiet dot from the shared status
        // tokens, the same axis that drives the adopters' marker/row tinting.
        status: {
            success: { statusDot: { background: "{colors.status.pos}" } },
            warning: { statusDot: { background: "{colors.status.warn}" } },
            danger:  { statusDot: { background: "{colors.status.neg}" } },
            info:    { statusDot: { background: "{colors.status.info}" } },
            neutral: { statusDot: { background: "fg.subtle" } },
        },
    },
    defaultVariants: { size: "md" },
});
