/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Menu slot recipe. */

import { defineSlotRecipe } from "@chakra-ui/react";

export const menuSlotRecipe = defineSlotRecipe({
    className: "elara-menu",
    slots: [
        "trigger", "triggerItem", "positioner", "content",
        "item", "itemGroup", "itemGroupLabel", "itemText",
        "itemCommand", "itemIndicator", "separator",
    ],
    base: {
        content: {
            background: "bg.surface",
            borderRadius: "{radii.md}",
            borderWidth: "1px",
            borderColor: "border.strong",
            boxShadow: "md",
            fontSize: "{fontSizes.control}",
            /* Viewport clamp (#347): long menus scroll inside Zag's
             * available height instead of running off small screens. */
            maxWidth: "calc(100vw - 16px)",
            maxHeight: "min(var(--available-height, 70vh), 85vh)",
            overflowY: "auto",
            overflowX: "hidden",
        },
        item: {
            display: "flex",
            alignItems: "center",
            borderRadius: "{radii.sm}",
            color: "fg",
            cursor: "pointer",
            /* Touch (#346): comfortable row height on coarse pointers. */
            _coarse: { minHeight: "44px" },
            transitionProperty: "background, color",
            transitionDuration: "{durations.fast}",
            _hover: { background: "bg.subtle" },
            _highlighted: { background: "bg.subtle" },
            "&[data-destructive]": { color: "fg.danger" },
        },
        /* Chakra's default recipe absolutely positions the indicator for
         * option items; spec menus use it as an inline leading icon. */
        itemIndicator: {
            position: "static",
            insetStart: "auto",
            top: "auto",
            transform: "none",
            width: "16px",
            fontSize: "12px",
            color: "fg.muted",
            display: "inline-flex",
            justifyContent: "center",
            flexShrink: "0",
            "[data-destructive] &": { color: "fg.danger" },
        },
        itemGroupLabel: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
            padding: "6px 10px",
        },
        itemCommand: {
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.subtle",
            opacity: "1",
            letterSpacing: "normal",
            marginLeft: "auto",
        },
        separator: {
            height: "1px",
            background: "border.subtle",
            border: "none",
            marginTop: "4px",
            marginBottom: "4px",
            marginInline: "0",
        },
    },
    /* Chakra's default menu recipe carries size variants whose styles win
     * over `base` after config merge — restate the spec density inside the
     * variants so it applies at every size. */
    variants: {
        size: {
            sm: {
                content: { minW: "220px", padding: "4px", scrollPadding: "4px" },
                item: { gap: "8px", textStyle: "body.sm", py: "6px", px: "10px" },
            },
            md: {
                content: { minW: "220px", padding: "4px", scrollPadding: "4px" },
                item: { gap: "8px", textStyle: "body.sm", py: "6px", px: "10px" },
            },
        },
    },
    defaultVariants: {
        size: "md",
    },
});
