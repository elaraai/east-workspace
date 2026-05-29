/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Slider slot recipe — thin track with a brand fill and a bordered thumb,
 * mirroring the workbench `.wb-track` / `.wb-fill` / `.wb-thumb` handle.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const sliderSlotRecipe = defineSlotRecipe({
    className: "elara-slider",
    slots: [
        "root", "label", "valueText", "control", "track", "range",
        "thumb", "markerGroup", "marker", "markerLabel",
    ],
    base: {
        root: {
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
        },
        label: {
            textStyle: "caption.eyebrow",
        },
        valueText: {
            fontFamily: "mono",
            fontSize: "{fontSizes.sm}",
            fontVariantNumeric: "tabular-nums",
            color: "fg",
        },
        track: {
            background: "bg.subtle",
            borderRadius: "{radii.full}",
            height: "4px",
            overflow: "hidden",
        },
        range: {
            background: "{colors.brand.600}",
            height: "100%",
        },
        thumb: {
            width: "14px",
            height: "14px",
            borderRadius: "{radii.full}",
            background: "bg.surface",
            borderWidth: "2px",
            borderColor: "{colors.brand.600}",
            boxShadow: "sm",
            cursor: "grab",
            _focusVisible: {
                boxShadow: "none",
                outline: "none",
            },
        },
        marker: {
            width: "2px",
            height: "8px",
            background: "border.strong",
        },
        markerLabel: {
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.muted",
        },
    },
});
