/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tooltip slot recipe — dark ink chip per spec.
 *
 * `bg: fg.default` / `color: bg.surface` / mono 11 / 4 px radius / 8 px
 * horizontal padding / 4 px vertical. Matches the dark on-hover affordance
 * used by the pattern-spec for keystroke hints.
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
            paddingX: "{spacing.2}",
            paddingY: "{spacing.1}",
            borderWidth: "0",
            borderRadius: "{radii.sm}",
            boxShadow: "sm",
            maxWidth: "240px",
            lineHeight: "{lineHeights.normal}",
        },
        arrow: {
            "--arrow-background": "colors.fg.default",
        },
    },
});
