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
            background: "{colors.white}",
            borderRadius: "6px",
            borderWidth: "1px",
            borderColor: "{colors.gray.300}",
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
            color: "{colors.gray.900}",
            cursor: "pointer",
            transitionProperty: "background, color",
            transitionDuration: "{durations.fast}",
            _hover: { background: "{colors.gray.50}" },
            _highlighted: { background: "{colors.gray.50}" },
        },
        itemGroupLabel: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "{colors.gray.500}",
            padding: "6px 10px",
        },
        itemCommand: {
            fontFamily: "mono",
            fontSize: "11px",
            color: "{colors.gray.500}",
            marginLeft: "auto",
        },
        separator: {
            height: "1px",
            background: "{colors.gray.200}",
            border: "none",
            marginTop: "4px",
            marginBottom: "4px",
            marginLeft: "0",
            marginRight: "0",
        },
    },
});
