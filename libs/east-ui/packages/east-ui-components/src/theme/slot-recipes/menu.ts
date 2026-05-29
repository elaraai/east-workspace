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
            padding: "4px",
            minWidth: "220px",
            fontSize: "{fontSizes.control}",
            overflow: "hidden",
        },
        item: {
            fontSize: "{fontSizes.control}",
            padding: "6px 10px",
            borderRadius: "{radii.sm}",
            color: "fg",
            cursor: "pointer",
            transitionProperty: "background, color",
            transitionDuration: "{durations.fast}",
            _hover: { background: "bg.subtle" },
            _highlighted: { background: "bg.subtle" },
        },
        itemGroupLabel: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.subtle",
            padding: "6px 10px",
        },
        itemCommand: {
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.subtle",
            marginLeft: "auto",
        },
        separator: {
            height: "1px",
            background: "border.subtle",
            border: "none",
            marginTop: "4px",
            marginBottom: "4px",
            marginLeft: "0",
            marginRight: "0",
        },
    },
});
