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
        "content", "title", "description",
        "header", "body", "footer", "closeTrigger",
    ],
    base: {
        backdrop: {
            background: "rgba(17,27,34,0.04)",
        },
        content: {
            background: "{colors.white}",
            borderRadius: "10px",
            borderWidth: "1px",
            borderColor: "{colors.gray.300}",
            boxShadow: "lg",
            padding: "20px 24px",
            maxWidth: "480px",
            overflow: "visible",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
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
            color: "{colors.gray.900}",
            margin: "0",
        },
        description: {
            fontSize: "13.5px",
            lineHeight: "1.55",
            color: "{colors.gray.700}",
            margin: "0",
            marginTop: "-8px",
        },
        body: {
            padding: "0",
            margin: "0",
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
