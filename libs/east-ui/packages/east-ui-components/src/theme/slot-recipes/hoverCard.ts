/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** HoverCard slot recipe. */

import { defineSlotRecipe } from "@chakra-ui/react";

export const hoverCardSlotRecipe = defineSlotRecipe({
    className: "elara-hover-card",
    /* `title` / `description` extend Chakra's HoverCard anatomy — same
     * mono-eyebrow heading as Popover ("same visual" per spec). */
    slots: ["trigger", "positioner", "content", "arrow", "arrowTip", "title", "description"],
    base: {
        content: {
            background: "bg.surface",
            borderRadius: "{radii.md}",
            borderWidth: "1px",
            borderColor: "border.strong",
            boxShadow: "md",
            padding: "14px 16px",
            /* Same chrome and sizing rule as Popover — fit to content
             * within the spec band, not Chakra's fixed default width. */
            width: "fit-content",
            minWidth: "240px",
            maxWidth: "360px",
            fontSize: "{fontSizes.control}",
            lineHeight: "{lineHeights.normal}",
            color: "fg",
        },
        arrow: {
            "--arrow-size": "12px",
            "--arrow-background": "colors.white",
            "--arrow-shadow-color": "colors.gray.300",
        },
        arrowTip: {
            borderColor: "border.strong",
        },
        title: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
            marginBottom: "8px",
        },
        description: {
            fontSize: "{fontSizes.control}",
            color: "fg.muted",
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
