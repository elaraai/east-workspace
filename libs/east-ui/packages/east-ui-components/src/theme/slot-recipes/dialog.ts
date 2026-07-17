/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Dialog slot recipe. */

import { defineSlotRecipe } from "@chakra-ui/react";

/* Small-viewport sheet (#347): below 480px every non-`full` dialog renders
 * as a bottom sheet — full width, top-only radius, body scrolling inside a
 * dvh-capped panel. Viewport (not container) media is correct here: dialogs
 * are viewport-scoped overlays. Spread into each size variant because
 * variant styles land after base in the cascade (a base-level override
 * would lose to the variant's unconditional maxWidth). */
const SHEET_MEDIA = "@media (max-width: 479px)";
const sheetContent = {
    [SHEET_MEDIA]: {
        maxWidth: "100vw",
        width: "100vw",
    },
};

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
        positioner: {
            [SHEET_MEDIA]: {
                alignItems: "flex-end",
                padding: "0",
            },
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
            [SHEET_MEDIA]: {
                margin: "0",
                borderRadius: "10px 10px 0 0",
                borderBottomWidth: "0",
                borderInlineWidth: "0",
                maxHeight: "calc(100dvh - 16px - env(safe-area-inset-top, 0px))",
                overflowY: "auto",
            },
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
            [SHEET_MEDIA]: {
                paddingBottom: "env(safe-area-inset-bottom, 0px)",
            },
        },
    },
    variants: {
        size: {
            xs: { content: { maxWidth: "320px", ...sheetContent } },
            sm: { content: { maxWidth: "400px", ...sheetContent } },
            md: { content: { maxWidth: "480px", ...sheetContent } },
            lg: { content: { maxWidth: "640px", ...sheetContent } },
            xl: { content: { maxWidth: "800px", ...sheetContent } },
            cover: { content: { maxWidth: "calc(100vw - 32px)", ...sheetContent } },
            full: { content: { maxWidth: "100vw" } },
        },
    },
    defaultVariants: {
        size: "md",
    },
});
