/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ShowMore slot recipe — disclosure trigger that reveals collapsed content.
 *
 * Trigger reads as a brand-tinted link.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const showMoreSlotRecipe = defineSlotRecipe({
    className: "elara-show-more",
    slots: ["root", "trigger", "content", "indicator"],
    base: {
        trigger: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.1}",
            fontFamily: "body",
            fontSize: "12.5px",
            fontWeight: "medium",
            color: "link",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            paddingX: "0",
            paddingY: "{spacing.1}",
            _hover: { color: "link.hover" },
        },
        indicator: { color: "fg.muted", transitionProperty: "transform", transitionDuration: "{durations.fast}" },
        content: { paddingY: "{spacing.2}" },
    },
});
