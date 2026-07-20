/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * OptionList slot recipe — a continuous list of full-width rows separated
 * by hairlines (the outer frame owns the perimeter; no per-item border or
 * radius). Selected row reads as a brand-tint surface, hover as a subtle
 * wash; label is brand-heading, description is mono.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const optionListSlotRecipe = defineSlotRecipe({
    className: "elara-option-list",
    slots: ["root", "item", "itemText", "itemDescription", "itemIndicator", "label"],
    base: {
        root: {
            display: "flex",
            flexDirection: "column",
            width: "100%",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.md}",
            overflow: "hidden",
        },
        label: { textStyle: "caption.eyebrow", marginBottom: "{spacing.2}" },
        item: {
            display: "flex",
            alignItems: "center",
            /* Touch (#346). */
            _coarse: { minHeight: "44px" },
            gap: "{spacing.3}",
            width: "100%",
            paddingX: "16px",
            paddingY: "12px",
            background: "bg.surface",
            color: "fg",
            cursor: "pointer",
            transitionProperty: "background",
            transitionDuration: "{durations.fast}",
            "& + &": { borderTopWidth: "1px", borderTopColor: "border.subtle" },
            _hover: { background: "bg.subtle" },
            _selected: { background: "bg.brand.subtle" },
            "&[data-selected]": { background: "bg.brand.subtle" },
            "&[aria-disabled='true']": {
                cursor: "not-allowed",
                background: "bg.subtle",
                opacity: 0.55,
                _hover: { background: "bg.subtle" },
            },
        },
        itemText: {
            fontFamily: "heading",
            fontSize: "{fontSizes.sm}",
            fontWeight: "semibold",
            color: "fg",
            lineHeight: "1.25",
        },
        itemDescription: {
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.subtle",
            marginTop: "4px",
            lineHeight: "1.4",
        },
        itemIndicator: {
            display: "inline-flex",
            alignItems: "center",
            flexShrink: 0,
            color: "brand.fg",
        },
    },
});
