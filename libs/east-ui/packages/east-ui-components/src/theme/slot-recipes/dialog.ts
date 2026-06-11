/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Dialog slot recipe. */

import { defineSlotRecipe } from "@chakra-ui/react";

export const dialogSlotRecipe = defineSlotRecipe({
    className: "elara-dialog",
    slots: [
        "trigger", "backdrop", "positioner",
        "content", "eyebrow", "title", "description",
        "header", "body", "footer", "closeTrigger",
    ],
    base: {
        backdrop: {
            background: "{colors.overlay.backdrop}",
        },
        content: {
            background: "bg.surface",
            borderRadius: "10px",
            borderWidth: "1px",
            borderColor: "border.strong",
            boxShadow: "lg",
            padding: "20px 24px",
            maxWidth: "480px",
            overflow: "visible",
            display: "flex",
            flexDirection: "column",
        },
        eyebrow: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.18em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
            marginBottom: "10px",
        },
        header: {
            padding: "0",
            background: "transparent",
            borderWidth: "0",
            margin: "0",
        },
        title: {
            fontFamily: "heading",
            fontSize: "20px",
            fontWeight: "700",
            lineHeight: "{lineHeights.snug}",
            letterSpacing: "-0.01em",
            color: "fg",
            margin: "0",
            marginBottom: "8px",
        },
        description: {
            fontSize: "13.5px",
            lineHeight: "1.55",
            color: "{colors.brand.700}",
            margin: "0",
            marginBottom: "16px",
        },
        body: {
            padding: "0",
            margin: "0",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            fontSize: "13.5px",
            lineHeight: "1.55",
        },
        footer: {
            padding: "0",
            background: "transparent",
            borderWidth: "0",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "8px",
        },
    },
    variants: {
        size: {
            xs: { content: { maxWidth: "320px" } },
            sm: { content: { maxWidth: "400px" } },
            md: { content: { maxWidth: "480px" } },
            lg: { content: { maxWidth: "640px" } },
            xl: { content: { maxWidth: "800px" } },
            cover: { content: { maxWidth: "calc(100vw - 32px)" } },
            full: { content: { maxWidth: "100vw" } },
        },
    },
    defaultVariants: {
        size: "md",
    },
});
