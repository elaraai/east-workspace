/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pagination slot recipe — numbered page chips with prev/next triggers.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

export const paginationSlotRecipe = defineSlotRecipe({
    className: "elara-pagination",
    slots: ["root", "item", "ellipsis", "prevTrigger", "nextTrigger"],
    base: {
        root: { display: "inline-flex", alignItems: "center", gap: "{spacing.1}" },
        item: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "28px",
            height: "28px",
            /* Touch hit target (#346). */
            ...coarseHitArea({ position: true }),
            paddingX: "{spacing.2}",
            borderRadius: "{radii.sm}",
            borderWidth: "1px",
            borderColor: "border.strong",
            background: "bg.surface",
            color: "fg",
            fontFamily: "mono",
            fontSize: "12px",
            fontVariantNumeric: "tabular-nums",
            cursor: "pointer",
            transitionProperty: "background, color, border-color",
            transitionDuration: "{durations.fast}",
            _hover: { borderColor: "fg.muted" },
            _selected: { background: "bg.brand.subtle", color: "brand.fg", borderColor: "border.brand" },
            "&[data-selected]": { background: "bg.brand.subtle", color: "brand.fg", borderColor: "border.brand" },
        },
        ellipsis: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "28px",
            height: "28px",
            background: "transparent",
            borderWidth: "0",
            color: "fg.muted",
            fontFamily: "mono",
        },
        prevTrigger: { color: "fg.muted", cursor: "pointer", padding: "{spacing.1}", ...coarseHitArea({ position: true }), _hover: { color: "fg" }, _disabled: { color: "fg.muted", opacity: 0.4, cursor: "not-allowed" } },
        nextTrigger: { color: "fg.muted", cursor: "pointer", padding: "{spacing.1}", ...coarseHitArea({ position: true }), _hover: { color: "fg" }, _disabled: { color: "fg.muted", opacity: 0.4, cursor: "not-allowed" } },
    },
});
