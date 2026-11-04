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
 *
 * At 560 px of its own width or narrower (`data-tree-phone`, `Query Builder
 * Phone Spec.md` QP13): a branch's row 44, its chevron 14, its label 13/500, its
 * preview mono 10.5 `--ink-4` in whole parts; a field's row at least 36 behind a
 * 1 px `--rule` guide, its key 13 `--ink-3` in a 96 column; values wrap, each row
 * measured; every control a 44 target.
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { wholeOrNone } from "../../style/whole-or-none.js";

export const valueTreeSlotRecipe = defineSlotRecipe({
    className: "elara-value-tree",
    slots: [
        "root", "row", "twist", "label", "value",
        "valueText", "summary", "opaque", "controls", "ctl",
        "setBtn", "keyInput", "tagWrap", "empty", "append",
        "toolbar", "toolbarBtn", "phoneSummary",
    ],
    base: {
        /* Bare like Table / Deck — identity chrome is host composition. */
        root: {
            background: "bg.surface",
            fontSize: "{fontSizes.body}",
        },
        row: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "{spacing.3}",
            paddingY: "3px",
            /* FIXED height, not min: the renderer virtualizes rows at exact
             * 32px multiples without per-row measurement (#533) — a row that
             * grew would overlap its neighbour. Inline editors are capped to
             * 26px below, so every row's content fits. */
            height: "32px",
            _hover: { background: "bg.subtle" },
            /* Transient search-jump highlight (#520). */
            "&[data-match]": { background: "bg.brand.subtle" },
            "[data-tree-phone] &": {
                position: "relative", height: "auto", minHeight: "36px", paddingY: "8px", boxSizing: "border-box", alignItems: "flex-start",
                "&[data-branch]": { minHeight: "44px", alignItems: "center", paddingY: "4px", cursor: "pointer" },
                /* The guide its parent's rows hang from. */
                "&[data-nested]:not([data-branch])::before": { content: '""', position: "absolute", top: 0, bottom: 0, insetInlineStart: "var(--tree-guide, 0px)", width: "1px", background: "border.subtle" },
            },
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
            "[data-tree-phone] &": { fontSize: "14px", width: "24px", height: "20px", _coarse: { width: "24px", height: "20px" } },
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
            "[data-tree-phone] [data-part=row]:not([data-branch]) > &": { flex: "0 0 96px", maxWidth: "96px", whiteSpace: "normal", overflowWrap: "anywhere", fontWeight: "400", color: "fg.muted", lineHeight: "20px" },
            "[data-tree-phone] [data-branch] > &": { flex: "0 0 auto", maxWidth: "none", minWidth: "0", whiteSpace: "normal", lineHeight: "20px" },
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
            "[data-tree-phone] &": { maxWidth: "none", flexWrap: "wrap", lineHeight: "20px", "& input": { height: "36px", minHeight: "36px" } },
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
            fontSize: "{fontSizes.body}",
            color: "fg.default",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "[data-tree-phone] &": { whiteSpace: "normal", overflow: "visible", overflowWrap: "anywhere" },
        },
        /* A phone's preview: as many whole ` · ` parts as fit, mono 10.5 `--ink-4`. */
        phoneSummary: { ...wholeOrNone("20px"), flex: "1 1 auto", minWidth: "0", columnGap: "4px", fontFamily: "mono", fontSize: "label.md", color: "fg.subtle", whiteSpace: "nowrap" },
        /* Branch preview / count — "Press · 2.5 · Running", "3 items". */
        summary: {
            fontSize: "{fontSizes.body.sm}",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        /* Read-only summarized value for unsupported types. */
        opaque: {
            fontFamily: "mono",
            fontSize: "{fontSizes.body}",
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
            "[data-tree-phone] &": { width: "44px", height: "44px", marginY: "-8px", _coarse: { width: "44px", height: "44px" } },
        },
        /* The option "Set" text affordance (none → some). */
        setBtn: {
            display: "inline-flex",
            alignItems: "center",
            fontSize: "{fontSizes.body.sm}",
            fontWeight: "500",
            color: "fg.subtle",
            borderRadius: "{radii.sm}",
            paddingX: "{spacing.2}",
            height: "20px",
            cursor: "pointer",
            _hover: { background: "bg.emphasized", color: "fg.default" },
            _coarse: { height: "32px" },
            "[data-tree-phone] &": { height: "44px", marginY: "-8px", _coarse: { height: "44px" } },
        },
        /* Inline new-dict-key entry (Enter commits, Escape cancels). */
        keyInput: {
            width: "120px",
            fontFamily: "mono",
            fontSize: "{fontSizes.body}",
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
            fontSize: "{fontSizes.body.sm}",
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
            fontSize: "{fontSizes.body.sm}",
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
            fontSize: "{fontSizes.body.sm}",
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
