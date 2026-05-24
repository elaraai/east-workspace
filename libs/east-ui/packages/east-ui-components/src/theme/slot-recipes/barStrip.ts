/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** BarStrip slot recipe — ranked horizontal bar list (label · bar · value). */

import { defineSlotRecipe } from "@chakra-ui/react";

export const barStripSlotRecipe = defineSlotRecipe({
    className: "elara-bar-strip",
    slots: ["root", "row", "label", "track", "fill", "value", "trailing"],
    base: {
        root: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
            width: "100%",
        },
        row: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.3}",
            width: "100%",
        },
        label: {
            minWidth: "6rem",
            flexShrink: "0",
        },
        track: {
            position: "relative",
            flex: "1",
            height: "6px",
            background: "{colors.gray.100}",
            borderRadius: "{radii.full}",
            overflow: "hidden",
        },
        fill: {
            position: "absolute",
            top: "0",
            left: "0",
            bottom: "0",
            background: "{colors.brand.600}",
            borderRadius: "{radii.full}",
        },
        value: {
            minWidth: "3rem",
            textAlign: "right",
            flexShrink: "0",
            fontFamily: "mono",
            fontSize: "11px",
            fontVariantNumeric: "tabular-nums",
            color: "{colors.gray.600}",
        },
        trailing: { flexShrink: "0" },
    },
    variants: {
        thickness: {
            xs: { track: { height: "4px" } },
            sm: { track: { height: "6px" } },
            md: { track: { height: "10px" } },
        },
    },
    defaultVariants: {
        thickness: "sm",
    },
});
