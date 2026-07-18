/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ValueTree slot recipe — the editable value-driven tree (#360). Rows are
 * flat virtualized lines (indent is data-driven, not nested DOM): a twist
 * (expand chevron), a name label, a value cell (typed editor, formatted
 * text, branch summary or opaque print) and a trailing control cluster
 * (add / remove / option toggle / variant tag select). Controls stay
 * visible at reduced opacity — no hover-only affordances, so touch and
 * keyboard users see the same surface.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const valueTreeSlotRecipe = defineSlotRecipe({
    className: "elara-value-tree",
    slots: [
        "root", "row", "twist", "label", "value",
        "valueText", "summary", "opaque", "controls", "ctl",
        "keyInput", "tagWrap", "empty",
    ],
    base: {
        /* Bare like Table / Deck — identity chrome is host composition. */
        root: {
            background: "bg.surface",
            fontSize: "13px",
        },
        row: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "{spacing.3}",
            minHeight: "32px",
            _hover: { background: "bg.subtle" },
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
        label: {
            fontWeight: "500",
            color: "fg.default",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 0,
            maxWidth: "45%",
        },
        value: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            flex: "1 1 auto",
            minWidth: 0,
        },
        valueText: {
            fontFamily: "mono",
            fontSize: "12px",
            color: "fg.default",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        /* Branch summary — "3 fields", "2 items". */
        summary: {
            fontSize: "11px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        /* Read-only printed value for unsupported types. */
        opaque: {
            fontFamily: "mono",
            fontSize: "11px",
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
        /* Inline new-dict-key entry (Enter commits, Escape cancels). */
        keyInput: {
            width: "96px",
            fontFamily: "mono",
            fontSize: "12px",
            paddingX: "{spacing.1}",
            height: "22px",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.sm}",
            background: "bg.surface",
            color: "fg.default",
            _focusVisible: { outline: "2px solid", outlineColor: "border.brand", outlineOffset: "-1px" },
        },
        /* Variant tag select wrapper — bounds the trigger width. */
        tagWrap: {
            minWidth: "88px",
            maxWidth: "160px",
        },
        empty: {
            padding: "{spacing.4}",
            fontSize: "12px",
            color: "fg.subtle",
        },
        /* Trailing add row for a root collection. */
        append: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
            fontSize: "12px",
            color: "fg.subtle",
            cursor: "pointer",
            borderRadius: "{radii.sm}",
            paddingX: "{spacing.1}",
            _hover: { color: "fg.default", background: "bg.emphasized" },
        },
    },
});
