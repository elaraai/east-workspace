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
        /* Rendered inside a Dialog.Root, so this must zero out the dialog
         * recipe's content padding — the palette owns its own interior. */
        content: {
            background: "bg.surface",
            borderRadius: "{radii.lg}",
            borderWidth: "1px",
            borderColor: "border.strong",
            boxShadow: "lg",
            overflow: "hidden",
            maxWidth: "560px",
            padding: "0",
            gap: "0",
        },
        input: {
            width: "100%",
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
        list: { padding: "{spacing.1}", maxHeight: "320px", overflowY: "auto" },
        item: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            padding: "6px 10px",
            borderRadius: "{radii.sm}",
            fontSize: "{fontSizes.control}",
            color: "fg",
            cursor: "pointer",
            _hover: { background: "bg.subtle" },
            _highlighted: { background: "bg.subtle" },
        },
        itemText: { fontSize: "{fontSizes.control}" },
        itemSubtitle: { fontFamily: "mono", fontSize: "11px", color: "fg.muted", marginLeft: "auto" },
        /* Accelerators are plain right-aligned mono, same as Menu itemCommand. */
        itemKbd: {
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.subtle",
            marginLeft: "auto",
        },
        groupLabel: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
            padding: "6px 10px",
        },
        empty: { textAlign: "center", paddingY: "{spacing.6}", color: "fg.muted", fontSize: "{fontSizes.control}" },
    },
});
