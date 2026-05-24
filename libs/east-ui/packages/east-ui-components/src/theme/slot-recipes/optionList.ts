/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * OptionList slot recipe — pattern_spec `Input.Presets` / `Decision.Alternatives`.
 *
 * Continuous list of full-width rows separated by 1 px hairlines.
 * No per-item borders or radii — the outer `frame` owns the perimeter.
 * Selected row = brand-tint surface; hover = subtle paper-3 wash.
 * Label uses brand-heading 14 px / 600; description uses mono 11 px ink-4.
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
            gap: "{spacing.3}",
            width: "100%",
            paddingX: "18px",
            paddingY: "14px",
            background: "bg.surface",
            color: "fg",
            cursor: "pointer",
            transitionProperty: "background",
            transitionDuration: "{durations.fast}",
            "& + &": { borderTopWidth: "1px", borderTopColor: "border.subtle" },
            _hover: { background: "bg.canvas" },
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
            color: "fg.muted",
            marginTop: "4px",
            lineHeight: "1.4",
        },
        itemIndicator: {
            display: "inline-flex",
            alignItems: "center",
            flexShrink: 0,
            color: "{colors.brand.700}",
        },
    },
});
