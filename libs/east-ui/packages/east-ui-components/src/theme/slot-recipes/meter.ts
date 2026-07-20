/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Meter slot recipe. */

import { defineSlotRecipe } from "@chakra-ui/react";

export const meterSlotRecipe = defineSlotRecipe({
    className: "elara-meter",
    slots: ["root", "track", "fill", "value", "label"],
    base: {
        root: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.3}",
            width: "100%",
        },
        label: {
            flexShrink: "0",
        },
        track: {
            position: "relative",
            flex: "1",
            height: "6px",
            background: "bg.subtle",
            borderRadius: "{radii.xs}",
            overflow: "hidden",
        },
        fill: {
            position: "absolute",
            top: "0",
            left: "0",
            bottom: "0",
            background: "{colors.brand.500}",
            borderRadius: "{radii.xs}",
        },
        value: {
            flexShrink: "0",
            fontFamily: "mono",
            fontSize: "11px",
            fontVariantNumeric: "tabular-nums",
            color: "fg.muted",
        },
    },
    variants: {
        thickness: {
            xs: { track: { height: "2px" } },
            sm: { track: { height: "4px" } },
            md: { track: { height: "6px" } },
            lg: { track: { height: "8px" } },
        },
        tone: {
            brand:   { fill: { background: "{colors.brand.600}" } },
            success: { fill: { background: "fg.success" } },
            warning: { fill: { background: "fg.warning" } },
            danger:  { fill: { background: "fg.danger" } },
            info:    { fill: { background: "fg.info" } },
            neutral: { fill: { background: "fg.muted" } },
        },
        // Density cascade — track + value text scale with the chipRail/trace
        // rhythm so a meter sits comfortably beside chips at the same density.
        // No default: an undensified meter keeps the `thickness` look.
        // Declared after `thickness` so density wins the merge.
        density: {
            condensed: {
                root: { gap: "{spacing.1.5}" },
                track: { height: "3px" },
                value: { fontSize: "9px" },
            },
            compact: {
                root: { gap: "{spacing.2}" },
                track: { height: "5px" },
                value: { fontSize: "10px" },
            },
            comfortable: {
                root: { gap: "{spacing.3}" },
                track: { height: "8px" },
                value: { fontSize: "12.5px" },
            },
        },
    },
    defaultVariants: {
        thickness: "md",
        tone: "brand",
    },
});
