/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Meter slot recipe: the track and its fill, and the mono percent beside them — never a bar alone where there is room
 * for both. In a size container too narrow for the percent beside a bar worth drawing (under 56px: "100%" at the
 * comfortable 12.5px is 32px, its gap 12px, and the bar 12px), the bar takes the room alone, as a Trace's steps drop
 * their values where they have none (east-workspace#1730) — a Record's meter cell on a phone's 62px column. Every track
 * is an even number of pixels tall, so it centres on a whole pixel in the even lines its hosts draw.
 */

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
            background: "brand.solid",
            borderRadius: "{radii.xs}",
        },
        value: {
            flexShrink: "0",
            fontFamily: "mono",
            fontSize: "11px",
            fontVariantNumeric: "tabular-nums",
            color: "fg.muted",
            "@container (width < 56px)": { display: "none" },
        },
    },
    variants: {
        thickness: {
            xs: { track: { height: "2px" } },
            sm: { track: { height: "4px" } },
            md: { track: { height: "6px" } },
            lg: { track: { height: "8px" } },
        },
        /* A fill is a mark: the valence base, never its text step. */
        tone: {
            brand:   { fill: { background: "brand.solid" } },
            success: { fill: { background: "status.pos" } },
            warning: { fill: { background: "status.warn" } },
            danger:  { fill: { background: "status.neg" } },
            info:    { fill: { background: "status.info" } },
            neutral: { fill: { background: "fg.muted" } },
        },
        // Density cascade — track + value text scale with the chipRail/trace
        // rhythm so a meter sits comfortably beside chips at the same density.
        // No default: an undensified meter keeps the `thickness` look.
        // Declared after `thickness` so density wins the merge. Each track an
        // even height, as every thickness is: an odd one centred at half a pixel.
        density: {
            condensed: {
                root: { gap: "{spacing.1.5}" },
                track: { height: "4px" },
                value: { fontSize: "9px" },
            },
            compact: {
                root: { gap: "{spacing.2}" },
                track: { height: "6px" },
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
