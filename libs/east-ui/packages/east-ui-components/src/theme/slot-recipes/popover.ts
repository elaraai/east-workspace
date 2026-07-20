/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Popover slot recipe. */

import { defineSlotRecipe } from "@chakra-ui/react";

export const popoverSlotRecipe = defineSlotRecipe({
    className: "elara-popover",
    slots: ["trigger", "positioner", "content", "arrow", "arrowTip", "header", "body", "footer", "title", "description", "closeTrigger"],
    base: {
        content: {
            background: "bg.surface",
            borderRadius: "{radii.md}",
            borderWidth: "1px",
            borderColor: "border.strong",
            boxShadow: "md",
            padding: "14px 16px",
            /* Chakra's default recipe fixes width at --popover-size (320px);
             * the spec sizes to content within 240–360. */
            width: "fit-content",
            minWidth: "min(240px, calc(100vw - 16px))",
            /* Viewport clamp (#347): the 360px spec band yields to small
             * screens; tall content scrolls within Zag's available height. */
            maxWidth: "min(360px, calc(100vw - 16px))",
            fontSize: "{fontSizes.control}",
            lineHeight: "{lineHeights.normal}",
            color: "fg",
            /* Was `overflow: visible`; the viewport clamp needs tall content
             * to scroll (the arrow is a sibling slot, unaffected). */
            maxHeight: "min(var(--available-height, 60vh), 85vh)",
            overflowY: "auto",
        },
        arrow: {
            "--arrow-size": "12px",
            "--arrow-background": "colors.bg.surface",
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
        body: {
            padding: "0",
            fontSize: "{fontSizes.control}",
        },
    },
});
