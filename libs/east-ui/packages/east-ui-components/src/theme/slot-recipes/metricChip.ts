/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * MetricChip slot recipe — spec `.delta` / `.deltapill.{up,down,flat}`.
 *
 * Compact mono inline chip carrying a status-coded delta value.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const metricChipSlotRecipe = defineSlotRecipe({
    className: "elara-metric-chip",
    slots: ["root", "indicator", "value", "label", "delta"],
    base: {
        root: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.1}",
            fontFamily: "mono",
            fontSize: "11.5px",
            fontWeight: "semibold",
            paddingX: "{spacing.2}",
            paddingY: "3px",
            borderRadius: "{radii.xs}",
            borderWidth: "1px",
            borderColor: "border.subtle",
            background: "bg.surface",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
        },
        value: { fontWeight: "semibold" },
        delta: { fontWeight: "semibold" },
        label: { fontFamily: "mono", fontSize: "10px", color: "fg.muted" },
    },
    variants: {
        sentiment: {
            up:   { root: { borderColor: "fg.success", color: "fg.success", background: "success.subtle" } },
            down: { root: { borderColor: "fg.danger",  color: "fg.danger",  background: "danger.subtle" } },
            flat: { root: { borderColor: "border.strong", color: "fg.subtle", background: "bg.subtle" } },
            brand:{ root: { borderColor: "{colors.brand.600}", color: "{colors.brand.600}", background: "bg.brand.subtle" } },
        },
        // Density cascade — root sizing mirrors the chipRail `--cr-*` sets
        // (label tracks `--cr-lbl-fs`) so a metric chip lines up with tags
        // and traces at the same density. No default: an undensified chip
        // keeps the base look.
        density: {
            condensed: {
                root: { fontSize: "9px", lineHeight: "1", paddingX: "7px", paddingY: "2px", gap: "4px" },
                label: { fontSize: "8.5px" },
            },
            compact: {
                root: { fontSize: "10px", lineHeight: "1", paddingX: "10px", paddingY: "5px", gap: "5px" },
                label: { fontSize: "9.5px" },
            },
            comfortable: {
                root: { fontSize: "12.5px", lineHeight: "1", paddingX: "15px", paddingY: "9.75px", gap: "7px" },
                label: { fontSize: "11px" },
            },
        },
    },
    defaultVariants: { sentiment: "flat" },
});
