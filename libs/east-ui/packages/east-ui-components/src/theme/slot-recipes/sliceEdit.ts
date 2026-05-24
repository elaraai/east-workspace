/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Slice edit slot recipe — the single popover overlay shape every compact
 * `Slice.*` affordance opens to edit (filter clause / filter `+M more` /
 * breakdown dimension / cohort predicate / range picker). One head + body +
 * foot anatomy; only the foot's action grammar varies. The body scrolls
 * internally (`maxH 50vh`); head and foot stay pinned; opening it never
 * resizes the parent. Matches `design/slice.html#slice-edit`.
 *
 * Also carries the field → operator → value control chrome (`control` slot)
 * shared by the predicate builder, so renderers never inline a `selectCss`.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const sliceEditSlotRecipe = defineSlotRecipe({
    className: "elara-slice-edit",
    slots: [
        "content", "head", "headLabel", "headClose",
        "body", "foot", "footLink", "footDanger", "footActions",
        "clauseRow", "clauseConj", "clauseBox", "clauseField", "clauseOp", "clauseVal",
        "builderRow", "resolveLine", "moreRow", "moreRowEdit", "moreRowRemove",
    ],
    base: {
        content: {
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.sm}",
            boxShadow: "md",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
        },
        head: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "14px",
            paddingY: "10px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "semibold",
            letterSpacing: "0.04em",
            color: "fg",
        },
        headLabel: { color: "fg" },
        headClose: {
            marginLeft: "auto",
            width: "22px",
            height: "22px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "fg",
            cursor: "pointer",
            borderRadius: "{radii.sm}",
            _hover: { background: "bg.subtle" },
        },
        body: {
            paddingX: "14px",
            paddingY: "12px",
            maxHeight: "50vh",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.3}",
        },
        foot: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "14px",
            paddingY: "10px",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            background: "bg.canvas",
            fontFamily: "mono",
            fontSize: "11px",
        },
        footLink: {
            color: "link",
            cursor: "pointer",
            _hover: { textDecoration: "underline", textUnderlineOffset: "2px" },
        },
        footDanger: {
            color: "fg.danger",
            cursor: "pointer",
            _hover: { textDecoration: "underline", textUnderlineOffset: "2px" },
        },
        footActions: {
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
        },

        // --- predicate clause rows (cohort edit) ---
        clauseRow: {
            display: "grid",
            gridTemplateColumns: "32px 1fr",
            gap: "{spacing.2}",
            alignItems: "center",
            fontFamily: "mono",
            fontSize: "11px",
        },
        clauseConj: {
            fontSize: "9.5px",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "fg.subtle",
            textAlign: "right",
        },
        clauseBox: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            flexWrap: "wrap",
            paddingX: "8px",
            paddingY: "6px",
            background: "bg.canvas",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.sm}",
            color: "fg.muted",
        },
        clauseField: { color: "{colors.brand.700}", fontWeight: "semibold", whiteSpace: "nowrap" },
        clauseOp: { color: "fg.subtle" },
        clauseVal: { color: "fg", fontWeight: "semibold" },

        // --- field/op/value builder row (controls use the shared `input` recipe) ---
        // One inline row: field · op · value (flexes) · submit. minmax(0,1fr)
        // lets the value control shrink instead of forcing a wrap.
        builderRow: {
            display: "grid",
            gridTemplateColumns: "auto auto minmax(0, 1fr) auto",
            alignItems: "center",
            gap: "{spacing.2}",
        },

        // --- resolves-to line ---
        resolveLine: {
            marginTop: "{spacing.1}",
            paddingTop: "{spacing.2}",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            fontFamily: "mono",
            fontSize: "10.5px",
            color: "fg.muted",
            lineHeight: "1.5",
        },

        // --- +M more list rows (filter overflow) ---
        moreRow: {
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: "{spacing.3}",
            alignItems: "center",
            paddingY: "6px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            fontFamily: "mono",
            fontSize: "11px",
            _last: { borderBottomWidth: "0" },
        },
        moreRowEdit: {
            color: "link",
            cursor: "pointer",
            fontSize: "10px",
            letterSpacing: "0.06em",
        },
        moreRowRemove: {
            color: "fg.muted",
            cursor: "pointer",
            fontSize: "16px",
            lineHeight: "1",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "20px",
            height: "20px",
            borderRadius: "{radii.sm}",
            _hover: { color: "fg", background: "bg.subtle" },
        },
    },
    variants: {
        size: {
            /** Default — chip / range editors. */
            sm: { content: { width: "320px" } },
            /** Predicate editors — cohort / filter `+M more`. */
            lg: { content: { width: "380px" } },
        },
    },
    defaultVariants: { size: "sm" },
});
