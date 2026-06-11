/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Drawer slot recipe. */

import { defineSlotRecipe } from "@chakra-ui/react";

export const drawerSlotRecipe = defineSlotRecipe({
    className: "elara-drawer",
    /* `eyebrow` extends Chakra's Drawer anatomy — same mono heading as the
     * Dialog surface header. */
    slots: ["trigger", "backdrop", "positioner", "content", "eyebrow", "title", "description", "header", "body", "footer", "closeTrigger"],
    base: {
        backdrop: { background: "{colors.overlay.backdrop}" },
        content: {
            background: "bg.surface",
            borderLeftWidth: "1px",
            borderLeftColor: "border.strong",
            borderRightWidth: "1px",
            borderRightColor: "border.strong",
            boxShadow: "lg",
        },
        header: {
            display: "flex",
            alignItems: "flex-start",
            gap: "{spacing.2}",
            paddingX: "{spacing.5}", paddingY: "{spacing.4}",
            borderBottomWidth: "1px", borderBottomColor: "border.subtle",
            background: "bg.surface",
        },
        eyebrow: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.18em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
            marginBottom: "{spacing.2}",
        },
        title: {
            fontFamily: "heading", fontSize: "20px", fontWeight: "700",
            lineHeight: "{lineHeights.snug}", letterSpacing: "-0.01em",
            color: "fg",
        },
        description: {
            fontSize: "13.5px",
            lineHeight: "1.55",
            color: "{colors.brand.700}",
            marginTop: "{spacing.1}",
        },
        body: { paddingX: "{spacing.5}", paddingY: "{spacing.4}" },
        footer: {
            paddingX: "{spacing.5}", paddingY: "{spacing.3}",
            borderTopWidth: "1px", borderTopColor: "border.strong",
            background: "bg.surface",
            display: "flex", alignItems: "center", gap: "{spacing.2}",
        },
    },
});
