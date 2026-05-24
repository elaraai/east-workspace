/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** HoverCard slot recipe. */

import { defineSlotRecipe } from "@chakra-ui/react";

export const hoverCardSlotRecipe = defineSlotRecipe({
    className: "elara-hover-card",
    slots: ["trigger", "positioner", "content", "arrow", "arrowTip"],
    base: {
        content: {
            background: "{colors.white}",
            borderRadius: "6px",
            borderWidth: "1px",
            borderColor: "{colors.gray.300}",
            boxShadow: "md",
            padding: "14px 16px",
            minWidth: "240px",
            maxWidth: "320px",
            fontSize: "13px",
            color: "{colors.gray.900}",
        },
        arrow: {
            "--arrow-size": "12px",
            "--arrow-background": "colors.white",
            "--arrow-shadow-color": "colors.gray.300",
        },
        arrowTip: {
            borderColor: "{colors.gray.300}",
        },
    },
    variants: {
        size: {
            xs: { content: { padding: "8px 12px" } },
            sm: { content: { padding: "10px 14px" } },
            md: { content: { padding: "14px 16px" } },
            lg: { content: { padding: "16px 20px" } },
        },
    },
    defaultVariants: {
        size: "md",
    },
});
