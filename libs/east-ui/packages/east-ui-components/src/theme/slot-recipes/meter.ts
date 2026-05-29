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
            background: "{colors.gray.100}",
            borderRadius: "3px",
            overflow: "hidden",
        },
        fill: {
            position: "absolute",
            top: "0",
            left: "0",
            bottom: "0",
            background: "{colors.brand.500}",
            borderRadius: "3px",
        },
        value: {
            flexShrink: "0",
            fontFamily: "mono",
            fontSize: "11px",
            fontVariantNumeric: "tabular-nums",
            color: "{colors.gray.600}",
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
    },
    defaultVariants: {
        thickness: "md",
        tone: "brand",
    },
});
