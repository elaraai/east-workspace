/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * EyebrowRow slot recipe — spec `.eyebrow-row`.
 *
 * The header strip that tops a `frame` (and divides its sections): a mono
 * uppercase `lbl` on the left, mono `meta` on the right, `rule-strong`
 * separator dots between meta segments. Paper-2 surface, bottom rule.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const eyebrowRowSlotRecipe = defineSlotRecipe({
    className: "elara-eyebrow-row",
    slots: ["root", "lbl", "meta", "sep"],
    base: {
        root: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            paddingInline: "18px",
            paddingBlock: "12px",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderBottomColor: "border.subtle",
            background: "bg.canvas",
        },
        lbl: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "semibold",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "fg",
            whiteSpace: "nowrap",
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        meta: {
            display: "inline-flex",
            alignItems: "center",
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "medium",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            flexShrink: 0,
        },
        sep: {
            color: "border.strong",
            paddingInline: "6px",
        },
    },
});
