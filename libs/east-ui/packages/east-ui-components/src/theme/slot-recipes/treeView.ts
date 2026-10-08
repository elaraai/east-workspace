/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * TreeView slot recipe — indented branches (the `.diff-tree` pattern).
 * Items read as body text with mono key accents applied consumer-side.
 * A branch leads with Font Awesome's chevron-right (#1263), the Table's
 * nested-row caret's 11px in its own square, which Chakra's indicator styles
 * turn down while the branch is open.
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
            fontSize: "{fontSizes.body}",
            cursor: "pointer",
            /* Touch (#346). */
            _coarse: { minHeight: "44px" },
            color: "fg",
            transitionProperty: "background, color",
            transitionDuration: "{durations.fast}",
            _hover: { background: "bg.subtle" },
        },
        branchTrigger: { color: "fg.muted", cursor: "pointer", _hover: { color: "fg" } },
        branchIndicator: { display: "inline-flex", color: "fg.muted", fontSize: "11px", "--fa-width": "1em", transitionProperty: "transform", transitionDuration: "{durations.fast}" },
        branchText: { fontSize: "{fontSizes.body}", color: "fg" },
        branchContent: { paddingLeft: "{spacing.4}" },
        item: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "{spacing.2}",
            paddingY: "{spacing.1}",
            fontSize: "{fontSizes.body}",
            color: "fg",
            cursor: "pointer",
            /* Touch (#346). */
            _coarse: { minHeight: "44px" },
            _hover: { background: "bg.subtle" },
            _selected: { background: "bg.brand.subtle", color: "brand.fg" },
            "&[data-selected]": { background: "bg.brand.subtle", color: "brand.fg" },
        },
        itemText: { fontSize: "{fontSizes.body}" },
    },
});
