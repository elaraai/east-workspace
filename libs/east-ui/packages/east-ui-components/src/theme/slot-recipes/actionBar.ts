/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ActionBar slot recipe — sticky bottom action strip per spec
 * `.commit-bar` / `.diff-foot` / `.bf2-foot`.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const actionBarSlotRecipe = defineSlotRecipe({
    className: "elara-action-bar",
    slots: ["root", "positioner", "content", "separator", "selectionTrigger", "closeTrigger"],
    base: {
        positioner: { position: "sticky", bottom: 0, zIndex: 1 },
        content: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            background: "bg.canvas",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            paddingX: "{spacing.4}",
            paddingY: "{spacing.3}",
        },
        separator: { width: "1px", height: "18px", background: "border.subtle" },
    },
});
