/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * EditableChip slot recipe — chip-shaped editable token.
 *
 * Preview state matches the `tag` recipe; edit state uses the input
 * recipe's `flushed` variant within the same chip outline.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const editableChipSlotRecipe = defineSlotRecipe({
    className: "elara-editable-chip",
    slots: ["root", "area", "preview", "input", "editTrigger", "submitTrigger", "cancelTrigger"],
    base: {
        root: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.1}",
            paddingX: "{spacing.2}",
            paddingY: "{spacing.1}",
            borderRadius: "{radii.sm}",
            borderWidth: "1px",
            borderColor: "border.strong",
            background: "bg.surface",
            fontFamily: "body",
            fontSize: "{fontSizes.xs}",
            fontWeight: "medium",
            color: "{colors.brand.700}",
        },
        preview: { cursor: "text" },
        input: {
            fontFamily: "inherit",
            fontSize: "inherit",
            color: "inherit",
            background: "transparent",
            border: "none",
            outline: "none",
            padding: "0",
        },
        editTrigger: { color: "fg.muted", cursor: "pointer", padding: "{spacing.1}", _hover: { color: "fg" } },
        submitTrigger: { color: "fg.success", cursor: "pointer", padding: "{spacing.1}" },
        cancelTrigger: { color: "fg.muted", cursor: "pointer", padding: "{spacing.1}" },
    },
});
