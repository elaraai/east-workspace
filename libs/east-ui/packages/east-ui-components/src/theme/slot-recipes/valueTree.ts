/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ValueTree slot recipe — the editable value-driven tree (#360). Rows are
 * flat virtualized lines (indent is data-driven, not nested DOM): a twist
 * (expand chevron), a name label, a value cell (typed editor, formatted
 * text, branch preview or opaque summary) and a trailing control cluster
 * (remove / option set-clear / variant tag select). The two columns read
 * like a form: the label column keeps a stable basis so values align,
 * editors are bounded to the value column, and numeric editors right-align
 * with tabular numerals. Controls stay visible at reduced opacity — no
 * hover-only affordances, so touch and keyboard users see the same
 * surface. Expanded collections end in an "Add …" ghost row.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const valueTreeSlotRecipe = defineSlotRecipe({
    className: "elara-value-tree",
    slots: [
        "root", "row", "twist", "label", "value",
        "valueText", "summary", "opaque", "controls", "ctl",
        "setBtn", "keyInput", "tagWrap", "empty", "append",
        "toolbar", "toolbarBtn",
    ],
    base: {
        /* Bare like Table / Deck — identity chrome is host composition. */
        root: {
            background: "bg.surface",
            fontSize: "{fontSizes.control}",
        },
        row: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "{spacing.3}",
            paddingY: "3px",
            minHeight: "32px",
            _hover: { background: "bg.subtle" },
            _focusVisible: {
                outline: "2px solid",
                outlineColor: "border.brand",
                outlineOffset: "-2px",
            },
        },
        /* Expand / collapse twist — the whole square is the toggle. */
        twist: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "18px",
            height: "18px",
            flexShrink: 0,
            fontSize: "10px",
            color: "fg.subtle",
            borderRadius: "{radii.sm}",
            cursor: "pointer",
            _hover: { background: "bg.emphasized", color: "fg.default" },
            _coarse: { width: "28px", height: "28px" },
        },
        /* The form-like name column — a stable basis so values align. */
        label: {
            fontWeight: "500",
            color: "fg.default",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: "0 1 200px",
            minWidth: "72px",
            maxWidth: "45%",
        },
        /* The value column — editors bound to it, numerics right-aligned.
         * Overflow clips (segmented editors like DateTime have intrinsic
         * min-content widths that would otherwise push past narrow rows). */
        value: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            flex: "1 1 auto",
            minWidth: 0,
            maxWidth: "300px",
            overflow: "hidden",
            /* Editors are dense inline lines, not standalone form fields —
             * cap their height so adjacent rows keep visible air. */
            "& input": {
                height: "26px",
                minHeight: "26px",
            },
            "&[data-leaf=integer] input, &[data-leaf=float] input": {
                textAlign: "end",
                fontVariantNumeric: "tabular-nums",
            },
        },
        valueText: {
            fontFamily: "mono",
            fontSize: "{fontSizes.xs}",
            color: "fg.default",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        /* Branch preview / count — "Press · 2.5 · Running", "3 items". */
        summary: {
            fontSize: "{fontSizes.xs}",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        /* Read-only summarized value for unsupported types. */
        opaque: {
            fontFamily: "mono",
            fontSize: "{fontSizes.xs}",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        /* Trailing control cluster — subdued but always visible (touch parity). */
        controls: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.1}",
            marginLeft: "auto",
            flexShrink: 0,
            opacity: 0.55,
            transition: "opacity 120ms ease",
            "[data-part=row]:hover &": { opacity: 1 },
            "[data-part=row]:focus-visible &": { opacity: 1 },
            _hoverNone: { opacity: 0.9 },
        },
        ctl: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "20px",
            height: "20px",
            fontSize: "10px",
            color: "fg.subtle",
            borderRadius: "{radii.sm}",
            cursor: "pointer",
            _hover: { background: "bg.emphasized", color: "fg.default" },
            _coarse: { width: "32px", height: "32px" },
        },
        /* The option "Set" text affordance (none → some). */
        setBtn: {
            display: "inline-flex",
            alignItems: "center",
            fontSize: "{fontSizes.xs}",
            fontWeight: "500",
            color: "fg.subtle",
            borderRadius: "{radii.sm}",
            paddingX: "{spacing.2}",
            height: "20px",
            cursor: "pointer",
            _hover: { background: "bg.emphasized", color: "fg.default" },
            _coarse: { height: "32px" },
        },
        /* Inline new-dict-key entry (Enter commits, Escape cancels). */
        keyInput: {
            width: "120px",
            fontFamily: "mono",
            fontSize: "{fontSizes.xs}",
            paddingX: "{spacing.1}",
            height: "22px",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.sm}",
            background: "bg.surface",
            color: "fg.default",
            _focusVisible: { outline: "2px solid", outlineColor: "border.brand", outlineOffset: "-1px" },
        },
        /* Variant tag select wrapper — sizes to the tag text (the select
         * trigger fills it), bounded so long tags don't blow the row. */
        tagWrap: {
            width: "max-content",
            minWidth: "112px",
            maxWidth: "220px",
            flexShrink: 0,
        },
        empty: {
            padding: "{spacing.4}",
            fontSize: "{fontSizes.xs}",
            color: "fg.subtle",
        },
        /* Collapse-all / expand-all bar — pins above the rows (the
         * VirtualRows header slot) with the row grid's own horizontals. */
        toolbar: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.1}",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.1}",
            borderBottomWidth: "1px",
            borderColor: "border.subtle",
            background: "bg.surface",
        },
        toolbarBtn: {
            display: "inline-flex",
            alignItems: "center",
            fontSize: "{fontSizes.xs}",
            color: "fg.subtle",
            borderRadius: "{radii.sm}",
            paddingX: "{spacing.2}",
            height: "22px",
            cursor: "pointer",
            _hover: { background: "bg.emphasized", color: "fg.default" },
            _coarse: { height: "32px" },
        },
        /* "Add item" / "Add entry" ghost-row affordance. */
        append: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
            fontSize: "{fontSizes.xs}",
            color: "fg.subtle",
            cursor: "pointer",
            borderRadius: "{radii.sm}",
            paddingX: "{spacing.1}",
            height: "24px",
            _hover: { color: "fg.default", background: "bg.emphasized" },
            _coarse: { height: "32px" },
        },
    },
});
