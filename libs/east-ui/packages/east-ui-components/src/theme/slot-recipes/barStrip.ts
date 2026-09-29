/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * BarStrip slot recipe — ranked horizontal bar list (label · bar · value),
 * as the Studio mock draws its breakdown: a short label column, the brand
 * fill on the sunken track, and the value right-aligned in mono.
 */

/** The mock's second ink — the labels'. */
const INK_2 = { base: "brand.700", _dark: "gray.300" } as const;

import { defineSlotRecipe } from "@chakra-ui/react";

export const barStripSlotRecipe = defineSlotRecipe({
    className: "elara-bar-strip",
    slots: ["root", "row", "label", "track", "fill", "value", "trailing"],
    base: {
        root: {
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            width: "100%",
        },
        row: {
            display: "flex",
            alignItems: "center",
            gap: "10px",
            width: "100%",
        },
        label: {
            minWidth: "64px",
            flexShrink: "0",
            fontSize: "12.5px",
            color: INK_2,
            whiteSpace: "nowrap",
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
            background: "brand.solid",
            borderRadius: "{radii.xs}",
        },
        value: {
            minWidth: "32px",
            textAlign: "right",
            flexShrink: "0",
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "600",
            fontVariantNumeric: "tabular-nums",
            color: "fg",
        },
        /* A value the author spells — set in the value's voice. */
        trailing: {
            minWidth: "32px",
            textAlign: "right",
            flexShrink: "0",
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "600",
            fontVariantNumeric: "tabular-nums",
            color: "fg",
        },
    },
    variants: {
        thickness: {
            xs: { track: { height: "4px" } },
            sm: { track: { height: "6px" } },
            md: { track: { height: "10px" } },
        },
        // Density cascade — track, value text and row spacing scale with the
        // chipRail/trace rhythm. No default: an undensified strip keeps the
        // `thickness` look. Declared after `thickness` so density wins the
        // merge.
        density: {
            condensed: {
                root: { gap: "{spacing.1}" },
                row: { gap: "{spacing.1.5}" },
                track: { height: "4px" },
                value: { fontSize: "9px" },
            },
            compact: {
                root: { gap: "{spacing.1.5}" },
                row: { gap: "{spacing.2}" },
                track: { height: "6px" },
                value: { fontSize: "10px" },
            },
            comfortable: {
                root: { gap: "{spacing.2}" },
                row: { gap: "{spacing.3}" },
                track: { height: "10px" },
                value: { fontSize: "12.5px" },
            },
        },
    },
    defaultVariants: {
        thickness: "sm",
    },
});
