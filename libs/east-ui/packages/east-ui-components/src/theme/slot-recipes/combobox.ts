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
import { fieldChrome, fieldFocusRing } from "../field-chrome.js";

export const comboboxSlotRecipe = defineSlotRecipe({
    className: "elara-combobox",
    slots: [
        "root", "label", "control", "input", "trigger",
        "clearTrigger", "positioner", "content", "list", "item", "itemText",
        "itemIndicator", "itemGroup", "itemGroupLabel", "empty", "indicatorGroup",
    ],
    base: {
        root: {
            width: "100%",
        },
        // The bordered shell wears the shared chrome; the inner input carries
        // the padding + font, so the control's own padding is zeroed and focus
        // is tracked with `_focusWithin`.
        control: {
            ...fieldChrome,
            display: "inline-flex",
            alignItems: "stretch",
            width: "100%",
            paddingInline: "0",
            paddingBlock: "0",
            _focusWithin: fieldFocusRing,
        },
        input: {
            flex: 1,
            /* Shrinkable + ellipsized: a long placeholder (struct key
             * signatures) truncates instead of running under the trigger
             * icons. */
            minWidth: "0",
            textOverflow: "ellipsis",
            minHeight: "0",
            background: "transparent",
            border: "none",
            /* Touch (#346): 44px input row + 16px text (iOS zoom guard). */
            _coarse: { minHeight: "44px", fontSize: "{fontSizes.md}" },
            paddingInline: "10px",
            paddingBlock: "7px",
            fontFamily: "body",
            fontSize: "{fontSizes.control}",
            lineHeight: "1.3",
            color: "fg",
            outline: "none",
            _placeholder: { color: "fg.subtle" },
        },
        /* In-flow beside the input (the merged Chakra default absolutely
         * positions this over the input's end, where custom input padding
         * lets long text run underneath it). */
        indicatorGroup: {
            position: "static",
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
        },
        trigger: {
            paddingX: "{spacing.2}",
            color: "fg.muted",
            cursor: "pointer",
        },
        clearTrigger: {
            paddingX: "{spacing.1}",
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
            /* Touch (#346). */
            _coarse: { minHeight: "44px" },
            _hover: { background: "bg.subtle" },
            _highlighted: { background: "bg.subtle" },
            _selected: { color: "brand.fg" },
        },
        itemGroupLabel: { textStyle: "caption.eyebrow", paddingX: "{spacing.3}", paddingY: "{spacing.2}" },
        label: { textStyle: "caption.eyebrow", marginBottom: "{spacing.1}" },
    },
    variants: {
        variant: {
            /* The merged Chakra default styles the INNER input per variant —
             * a 1px border and an inside focus ring — and default variant
             * styles beat custom base. The control shell wears the one field
             * ring (`_focusWithin` above), so the input stays chromeless. */
            outline: {
                input: {
                    borderWidth: "0",
                    focusVisibleRing: "none",
                    _focusVisible: { outline: "none", boxShadow: "none" },
                },
            },
        },
    },
});
