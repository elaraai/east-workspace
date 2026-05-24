/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Slider slot recipe — brand thumb / range, thin track.
 *
 * Per CLAUDE.md "Thin chart lines" rule: track is 4 px, thumb is 12 px,
 * range is the brand-500 colour at 60% opacity (brush-handle look).
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
            borderRadius: "{radii.sm}",
            height: "4px",
            overflow: "hidden",
        },
        range: {
            background: "{colors.brand.500}",
            height: "100%",
        },
        thumb: {
            width: "12px",
            height: "12px",
            borderRadius: "{radii.full}",
            background: "bg.surface",
            borderWidth: "2px",
            borderColor: "{colors.brand.500}",
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
