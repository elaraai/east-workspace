/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * TreeView slot recipe — indented branches (the `.diff-tree` pattern).
 * Items read as body text with mono key accents applied consumer-side.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const treeViewSlotRecipe = defineSlotRecipe({
    className: "elara-tree-view",
    slots: [
        "root", "branch", "branchControl", "branchTrigger",
        "branchContent", "branchIndicator", "branchText",
        "item", "itemText", "itemIndicator",
    ],
    base: {
        root: { display: "flex", flexDirection: "column" },
        branch: { display: "flex", flexDirection: "column" },
        branchControl: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "{spacing.2}",
            paddingY: "{spacing.1}",
            fontSize: "{fontSizes.control}",
            cursor: "pointer",
            color: "fg",
            transitionProperty: "background, color",
            transitionDuration: "{durations.fast}",
            _hover: { background: "bg.subtle" },
        },
        branchTrigger: { color: "fg.muted", cursor: "pointer", _hover: { color: "fg" } },
        branchIndicator: { color: "fg.muted", transitionProperty: "transform", transitionDuration: "{durations.fast}" },
        branchText: { fontSize: "{fontSizes.control}", color: "fg" },
        branchContent: { paddingLeft: "{spacing.4}" },
        item: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "{spacing.2}",
            paddingY: "{spacing.1}",
            fontSize: "{fontSizes.control}",
            color: "fg",
            cursor: "pointer",
            _hover: { background: "bg.subtle" },
            _selected: { background: "bg.brand.subtle", color: "{colors.brand.700}" },
            "&[data-selected]": { background: "bg.brand.subtle", color: "{colors.brand.700}" },
        },
        itemText: { fontSize: "{fontSizes.control}" },
    },
});
