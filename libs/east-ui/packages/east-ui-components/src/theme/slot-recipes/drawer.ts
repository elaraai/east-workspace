/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Drawer slot recipe. */

import { defineSlotRecipe } from "@chakra-ui/react";

export const drawerSlotRecipe = defineSlotRecipe({
    className: "elara-drawer",
    slots: ["trigger", "backdrop", "positioner", "content", "title", "description", "header", "body", "footer", "closeTrigger"],
    base: {
        backdrop: { background: "rgba(17,27,34,0.04)" },
        content: {
            background: "{colors.white}",
            borderLeftWidth: "1px",
            borderLeftColor: "{colors.gray.300}",
            borderRightWidth: "1px",
            borderRightColor: "{colors.gray.300}",
            boxShadow: "lg",
        },
        header: {
            paddingX: "{spacing.5}", paddingY: "{spacing.4}",
            borderBottomWidth: "1px", borderBottomColor: "{colors.gray.300}",
            background: "{colors.white}",
        },
        title: {
            fontFamily: "heading", fontSize: "20px", fontWeight: "700",
            lineHeight: "{lineHeights.snug}", letterSpacing: "-0.01em",
            color: "{colors.gray.900}",
        },
        description: {
            fontSize: "13.5px",
            color: "{colors.gray.700}",
            marginTop: "{spacing.1}",
        },
        body: { paddingX: "{spacing.5}", paddingY: "{spacing.4}" },
        footer: {
            paddingX: "{spacing.5}", paddingY: "{spacing.3}",
            borderTopWidth: "1px", borderTopColor: "{colors.gray.300}",
            background: "{colors.white}",
            display: "flex", alignItems: "center", gap: "{spacing.2}",
        },
    },
});
