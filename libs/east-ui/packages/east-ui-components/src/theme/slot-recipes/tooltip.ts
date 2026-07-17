/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tooltip slot recipe — dark ink chip per spec.
 *
 * `bg: fg.default` / `color: bg.surface` / mono 11. Tooltips are text-only
 * explanations of what a number is; structured content belongs in a Popover.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const tooltipSlotRecipe = defineSlotRecipe({
    className: "elara-tooltip",
    slots: ["trigger", "positioner", "content", "arrow", "arrowTip"],
    base: {
        content: {
            fontFamily: "mono",
            fontSize: "11px",
            background: "fg.default",
            color: "bg.surface",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderWidth: "0",
            borderRadius: "{radii.sm}",
            boxShadow: "sm",
            /* Viewport clamp (#347) — also inherited by ToggleTip. */
            maxWidth: "min(280px, calc(100vw - 16px))",
            lineHeight: "1.5",
        },
        arrow: {
            "--arrow-background": "colors.fg.default",
        },
    },
});
