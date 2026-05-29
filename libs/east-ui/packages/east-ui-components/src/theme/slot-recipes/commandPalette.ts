/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * CommandPalette slot recipe — input + listbox in a dialog.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const commandPaletteSlotRecipe = defineSlotRecipe({
    className: "elara-command-palette",
    slots: [
        "trigger", "dialog", "backdrop", "positioner", "content",
        "input", "list", "item", "itemKbd", "itemText", "itemSubtitle",
        "group", "groupLabel", "empty",
    ],
    base: {
        backdrop: { background: "{colors.overlay.backdrop}" },
        content: {
            background: "bg.surface",
            borderRadius: "{radii.lg}",
            borderWidth: "1px",
            borderColor: "border.subtle",
            boxShadow: "xl",
            overflow: "hidden",
            maxWidth: "640px",
        },
        input: {
            fontFamily: "body",
            fontSize: "{fontSizes.md}",
            background: "bg.surface",
            color: "fg",
            paddingX: "{spacing.4}",
            paddingY: "{spacing.3}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            outline: "none",
            _placeholder: { color: "fg.subtle" },
        },
        list: { paddingY: "{spacing.2}", maxHeight: "320px", overflowY: "auto" },
        item: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "{spacing.4}",
            paddingY: "{spacing.2}",
            borderRadius: "{radii.sm}",
            marginX: "{spacing.2}",
            fontSize: "{fontSizes.control}",
            color: "fg",
            cursor: "pointer",
            _hover: { background: "bg.subtle" },
            _highlighted: { background: "bg.subtle" },
        },
        itemSubtitle: { fontFamily: "mono", fontSize: "11px", color: "fg.muted", marginLeft: "auto" },
        itemKbd: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            background: "bg.subtle",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.xs}",
            paddingX: "{spacing.2}",
            paddingY: "1px",
            color: "fg",
            marginLeft: "auto",
        },
        groupLabel: { textStyle: "caption.eyebrow", paddingX: "{spacing.4}", paddingY: "{spacing.2}" },
        empty: { textAlign: "center", paddingY: "{spacing.6}", color: "fg.muted", fontSize: "{fontSizes.control}" },
    },
});
