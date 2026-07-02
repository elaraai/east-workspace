/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `clauseBuilder` — chrome for the shared field → operator → value clause
 * authoring row (`ClauseBuilder` in `forms/`) and the compact clause chips
 * that render authored clauses. One recipe so every clause-authoring
 * surface (Slice.Edit filters/cohorts, the decision judgement panel's
 * constraint inject) lays out and reads identically.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const clauseBuilderSlotRecipe = defineSlotRecipe({
    className: "elara-clause-builder",
    slots: [
        "row", "rowStacked", "stackControls", "stackValue", "stackSubmit",
        "fieldLock", "rangeLine", "rangeBound", "rangeJoin", "hint",
        "chip", "chipField", "chipOp", "chipVal",
    ],
    base: {
        // One inline row: field · op · value (flexes) · submit. minmax(0,1fr)
        // lets the value control shrink instead of forcing a wrap.
        // Fractional tracks so the row degrades with its container: the
        // field select gets the largest share (its labels are longest), the
        // op select sizes to its content with a floor, the value control
        // takes the rest. Hard pixel minimums would overflow narrow hosts
        // (the 320px Slice.Edit popover); `auto` tracks would collapse the
        // width:100% select triggers to min-content and truncate them.
        row: {
            display: "grid",
            // op floor sized so the longest common operator label ("contains"
            // / "between" / "not in") fits without ellipsis once the trigger
            // reserves chevron padding (#130), while still fitting the 320px
            // Slice.Edit popover.
            gridTemplateColumns: "minmax(0, 1.3fr) minmax(100px, max-content) minmax(80px, 1fr) auto",
            alignItems: "center",
            gap: "{spacing.2}",
            minWidth: "0",
        },
        // Intrinsically wide value controls (set / range / datetime, #193)
        // stack: field+op line, full-width value line, hint, submit line.
        rowStacked: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
            minWidth: "0",
        },
        stackControls: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            minWidth: "0",
        },
        stackValue: {
            width: "100%",
            minWidth: "0",
        },
        stackSubmit: {
            display: "flex",
            justifyContent: "flex-end",
        },
        // Range bounds share one line while they fit and WRAP when they don't
        // (two segmented date inputs inside the Slice.Edit popover) — the row
        // degrades by wrapping, never by overflowing (#193).
        rangeLine: {
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "{spacing.2}",
            minWidth: "0",
        },
        rangeBound: {
            flex: "1 1 130px",
            minWidth: "0",
        },
        // Edit mode pins the field — rendered as a label, not a control.
        fieldLock: {
            color: "{colors.brand.700}",
            fontWeight: "semibold",
            whiteSpace: "nowrap",
            fontSize: "{fontSizes.xs}",
        },
        rangeJoin: {
            color: "fg.subtle",
            fontSize: "{fontSizes.xs}",
            flexShrink: 0,
        },
        // Inline "why can't I Add" caption under the row (mirrors the cohort
        // name field's disable + hint grammar). Spans the grid's full width;
        // inert in the stacked flex layout.
        hint: {
            gridColumn: "1 / -1",
            fontFamily: "mono",
            fontSize: "{fontSizes.2xs}",
            color: "fg.muted",
        },
        // Authored clause rendered as a compact chip: field · op · value.
        chip: {
            display: "inline-flex",
            alignItems: "baseline",
            gap: "{spacing.1}",
            fontFamily: "mono",
            fontSize: "{fontSizes.2xs}",
            lineHeight: "1.4",
        },
        chipField: { color: "{colors.brand.700}", fontWeight: "semibold", whiteSpace: "nowrap" },
        chipOp: { color: "fg.subtle" },
        chipVal: { color: "fg", fontWeight: "semibold" },
    },
});
