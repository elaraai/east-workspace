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
            background: "{colors.white}",
            borderRadius: "6px",
            borderWidth: "1px",
            borderColor: "{colors.gray.300}",
            boxShadow: "md",
            padding: "14px 16px",
            minWidth: "240px",
            maxWidth: "360px",
            fontSize: "13px",
            color: "{colors.gray.900}",
            overflow: "visible",
        },
        arrow: {
            "--arrow-size": "12px",
            "--arrow-background": "colors.white",
            "--arrow-shadow-color": "colors.gray.300",
        },
        arrowTip: {
            borderColor: "{colors.gray.300}",
        },
        title: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "{colors.gray.500}",
            marginBottom: "8px",
        },
        description: {
            fontSize: "13px",
            color: "{colors.gray.600}",
        },
        body: {
            padding: "0",
            fontSize: "13px",
        },
    },
});
