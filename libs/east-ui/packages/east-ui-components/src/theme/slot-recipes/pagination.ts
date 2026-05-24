/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pagination slot recipe — flat numbered chips, ink fill on current.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

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
            paddingX: "{spacing.2}",
            borderRadius: "{radii.sm}",
            background: "bg.surface",
            color: "fg",
            fontFamily: "mono",
            fontSize: "12px",
            fontVariantNumeric: "tabular-nums",
            cursor: "pointer",
            transitionProperty: "background, color, border-color",
            transitionDuration: "{durations.fast}",
            _hover: { background: "bg.subtle" },
            _selected: { background: "fg.default", color: "bg.surface" },
            "&[data-selected]": { background: "fg.default", color: "bg.surface" },
        },
        ellipsis: {
            display: "inline-flex",
            alignItems: "center",
            color: "fg.muted",
            fontFamily: "mono",
        },
        prevTrigger: { color: "fg.muted", cursor: "pointer", padding: "{spacing.1}", _hover: { color: "fg" }, _disabled: { color: "fg.muted", opacity: 0.4, cursor: "not-allowed" } },
        nextTrigger: { color: "fg.muted", cursor: "pointer", padding: "{spacing.1}", _hover: { color: "fg" }, _disabled: { color: "fg.muted", opacity: 0.4, cursor: "not-allowed" } },
    },
});
