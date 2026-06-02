/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Progress slot recipe — bsys `.bar` thin track.
 *
 * Spec `.bar`: paper-3 track, brand fill, 6 px tall, 3 px radius. Tones
 * are restricted to brand / pos / neg (no hue picker per spec).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const progressSlotRecipe = defineSlotRecipe({
    className: "elara-progress",
    slots: ["root", "label", "track", "range", "valueText"],
    base: {
        root: { display: "flex", flexDirection: "column", gap: "{spacing.1}" },
        label: { textStyle: "caption.eyebrow" },
        track: {
            background: "{colors.gray.100}",
            borderRadius: "{radii.xs}",
            height: "6px",
            overflow: "hidden",
        },
        range: { background: "{colors.brand.500}", height: "100%" },
        valueText: {
            fontFamily: "mono", fontSize: "11px",
            fontWeight: "600",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontVariantNumeric: "tabular-nums",
            color: "fg.subtle",
        },
    },
    variants: {
        sentiment: {
            brand: {},
            pos: { range: { background: "fg.success" } },
            neg: { range: { background: "fg.danger" } },
        },
        size: {
            xs: { track: { height: "3px" } },
            sm: { track: { height: "4px" } },
            md: { track: { height: "6px" } },
        },
    },
    defaultVariants: { sentiment: "brand", size: "md" },
});
