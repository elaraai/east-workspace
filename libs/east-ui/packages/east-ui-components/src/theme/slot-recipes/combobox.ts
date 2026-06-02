/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Combobox slot recipe — typed-input search with dropdown listbox.
 *
 * Trigger inherits the input shape (4 px radius, 1 px border.subtle).
 * Content listbox is a `frame.flat` 6 px popup with md shadow.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const comboboxSlotRecipe = defineSlotRecipe({
    className: "elara-combobox",
    slots: [
        "root", "label", "control", "input", "trigger",
        "clearTrigger", "positioner", "content", "list", "item", "itemText",
        "itemIndicator", "itemGroup", "itemGroupLabel", "empty", "indicatorGroup",
    ],
    base: {
        control: {
            display: "inline-flex",
            alignItems: "stretch",
            width: "100%",
            borderRadius: "{radii.sm}",
            borderWidth: "1px",
            borderColor: "border.strong",
            background: "bg.surface",
            transitionProperty: "border-color, box-shadow",
            transitionDuration: "{durations.fast}",
            _focusWithin: {
                borderColor: "{colors.brand.600}",
                boxShadow: "none",
            },
        },
        input: {
            flex: 1,
            background: "transparent",
            border: "none",
            paddingX: "10px",
            paddingY: "7px",
            fontSize: "{fontSizes.control}",
            color: "fg",
            outline: "none",
            _placeholder: { color: "fg.subtle" },
        },
        trigger: {
            paddingX: "{spacing.2}",
            color: "fg.muted",
            cursor: "pointer",
        },
        content: {
            background: "bg.surface",
            borderRadius: "{radii.md}",
            borderWidth: "1px",
            borderColor: "border.subtle",
            boxShadow: "md",
            paddingY: "{spacing.1}",
            maxHeight: "320px",
            overflowY: "auto",
        },
        item: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            fontSize: "{fontSizes.control}",
            cursor: "pointer",
            _hover: { background: "bg.subtle" },
            _highlighted: { background: "bg.subtle" },
            _selected: { color: "{colors.brand.700}" },
        },
        itemGroupLabel: { textStyle: "caption.eyebrow", paddingX: "{spacing.3}", paddingY: "{spacing.2}" },
        label: { textStyle: "caption.eyebrow", marginBottom: "{spacing.1}" },
    },
});
