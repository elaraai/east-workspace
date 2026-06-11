/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Select slot recipe — inherits Input chrome on the trigger, frame.flat
 * + md shadow on the content listbox.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fieldChrome } from "../field-chrome.js";

export const selectSlotRecipe = defineSlotRecipe({
    className: "elara-select",
    slots: [
        "root", "label", "control", "trigger", "indicatorGroup",
        "indicator", "clearTrigger", "valueText",
        "positioner", "content", "item", "itemText", "itemIndicator",
        "itemGroup", "itemGroupLabel",
    ],
    base: {
        trigger: {
            ...fieldChrome,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "{spacing.2}",
            width: "100%",
            cursor: "pointer",
        },
        valueText: {
            flex: 1,
            textAlign: "left",
            color: "fg",
            _placeholder: { color: "fg.subtle" },
        },
        indicator: {
            color: "fg.muted",
        },
        content: {
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.md}",
            boxShadow: "md",
            paddingY: "{spacing.1}",
            overflow: "hidden",
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
        itemGroupLabel: {
            textStyle: "caption.eyebrow",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
        },
        label: {
            textStyle: "caption.eyebrow",
            marginBottom: "{spacing.1}",
        },
    },
    variants: {
        variant: {
            outline: {},
            numeric: {
                trigger: {
                    fontFamily: "mono",
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "right",
                },
                item: {
                    fontFamily: "mono",
                    fontVariantNumeric: "tabular-nums",
                },
            },
        },
        size: {
            sm: { trigger: { fontSize: "{fontSizes.xs}", paddingX: "{spacing.2}", paddingY: "{spacing.1}" } },
            md: { trigger: { fontSize: "{fontSizes.control}", paddingX: "10px", paddingY: "7px" } },
            lg: { trigger: { fontSize: "{fontSizes.md}", paddingX: "{spacing.4}", paddingY: "{spacing.3}" } },
        },
    },
    defaultVariants: {
        variant: "outline",
        size: "md",
    },
});
