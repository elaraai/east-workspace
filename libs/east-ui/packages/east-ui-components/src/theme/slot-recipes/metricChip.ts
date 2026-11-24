/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * MetricChip slot recipe — the design system's DeltaPill, the change
 * indicator: 20 tall, padded 0 4, its icon and value 4 apart, mono tabular
 * 10.5 / 600 at `--r-sm`. A rising or falling value is in its valence's text
 * step on a 6% wash of the valence; a flat one `--ink-3` on `--paper-3`.
 * Colour follows valence, the icon follows direction.
 *
 * It is a one-line box (#1636): its line is the 18px inside its clear 1px
 * edge, so its words start a whole number of pixels under it. A density
 * sizes it with the rail's chips, and is as tall as its line and padding
 * make it: at the comfortable density 34px in its edge, a whole 14px line
 * between 9px of padding (#1638), where a 9.75px padding about a 12.5px line
 * started its words at a fraction of a pixel under the edge.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fontAwesomeSize } from "../icon-size.js";
import { oneLineBox } from "../one-line-box.js";

export const metricChipSlotRecipe = defineSlotRecipe({
    className: "elara-metric-chip",
    slots: ["root", "indicator", "value", "label", "delta"],
    base: {
        root: {
            ...oneLineBox(20),
            boxSizing: "border-box",
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.1}",
            fontFamily: "mono",
            fontSize: "label.md",
            fontWeight: "semibold",
            // 4 with its edge: the design system's `pad 0 4`.
            paddingX: "3px",
            paddingY: "0",
            borderRadius: "{radii.sm}",
            borderWidth: "1px",
            borderColor: "transparent",
            background: "bg.subtle",
            color: "fg",
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
        },
        /* Its icon: the direction's caret, an even 10px square in the pill's even room. */
        indicator: { display: "inline-flex", alignItems: "center", flexShrink: "0", "& svg": fontAwesomeSize("10px") },
        value: { fontWeight: "semibold" },
        delta: { fontWeight: "semibold" },
        label: { fontFamily: "mono", fontSize: "10px", color: "fg.muted" },
    },
    variants: {
        sentiment: {
            /* `--pos-text` / `--neg-text` on the 6% wash of `--pos` / `--neg`; flat `--ink-3` on `--paper-3`. */
            up:    { root: { color: "fg.success", background: "status.posSubtle" } },
            down:  { root: { color: "fg.danger", background: "status.negSubtle" } },
            flat:  { root: { color: "fg.muted" } },
            brand: { root: { color: "brand.solid" } },
        },
        // Density cascade — root sizing mirrors the chipRail `--cr-*` sets
        // (label tracks `--cr-lbl-fs`) so a metric chip lines up with tags
        // and traces at the same density, as tall as its line and padding
        // make it. No default: an undensified chip is the 20px pill.
        density: {
            condensed: {
                root: { height: "auto", fontSize: "9px", lineHeight: "1", paddingX: "7px", paddingY: "2px", gap: "4px" },
                label: { fontSize: "8.5px" },
            },
            compact: {
                root: { height: "auto", fontSize: "10px", lineHeight: "1", paddingX: "10px", paddingY: "5px", gap: "5px" },
                label: { fontSize: "9.5px" },
            },
            comfortable: {
                root: { height: "auto", fontSize: "12.5px", lineHeight: "14px", paddingX: "15px", paddingY: "9px", gap: "7px" },
                label: { fontSize: "11px" },
            },
        },
    },
    defaultVariants: { sentiment: "flat" },
});
