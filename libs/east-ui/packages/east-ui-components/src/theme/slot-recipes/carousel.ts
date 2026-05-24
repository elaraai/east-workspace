/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Carousel slot recipe — minimal chrome; spec uses bare chip prev/next.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const carouselSlotRecipe = defineSlotRecipe({
    className: "elara-carousel",
    slots: ["root", "viewport", "itemGroup", "item", "control", "prevTrigger", "nextTrigger", "indicatorGroup", "indicator"],
    base: {
        root: { position: "relative", display: "flex", flexDirection: "column", gap: "{spacing.2}" },
        viewport: { overflow: "hidden" },
        itemGroup: { display: "flex" },
        item: { flexShrink: 0, width: "100%" },
        control: { display: "flex", justifyContent: "space-between", alignItems: "center" },
        prevTrigger: {
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: "28px", height: "28px",
            borderRadius: "{radii.sm}",
            borderWidth: "1px", borderColor: "border.strong",
            background: "bg.surface", color: "fg",
            cursor: "pointer",
            _hover: { borderColor: "fg.muted" },
            _disabled: { opacity: 0.4, cursor: "not-allowed" },
        },
        nextTrigger: {
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: "28px", height: "28px",
            borderRadius: "{radii.sm}",
            borderWidth: "1px", borderColor: "border.strong",
            background: "bg.surface", color: "fg",
            cursor: "pointer",
            _hover: { borderColor: "fg.muted" },
            _disabled: { opacity: 0.4, cursor: "not-allowed" },
        },
        indicatorGroup: { display: "flex", gap: "{spacing.1}", justifyContent: "center" },
        indicator: {
            width: "8px", height: "8px",
            borderRadius: "{radii.full}",
            background: "border.strong",
            cursor: "pointer",
            transitionProperty: "background",
            transitionDuration: "{durations.fast}",
            /* Use brand.700 (deep ink-teal) for the active dot. brand.500
             * (#488e97) reads as a washed-out mid cyan against the muted
             * neutrals; brand.700 matches the solid button colour. */
            _selected: { background: "{colors.brand.700}" },
            "&[data-current]": { background: "{colors.brand.700}" },
        },
    },
});
