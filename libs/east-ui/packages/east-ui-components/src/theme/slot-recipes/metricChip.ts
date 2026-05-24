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
            fontSize: "11px",
            fontWeight: "semibold",
            paddingX: "{spacing.2}",
            paddingY: "2px",
            borderRadius: "2px",
            borderWidth: "1px",
            borderColor: "border.subtle",
            background: "bg.surface",
            color: "{colors.gray.600}",
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
            flat: { root: { borderColor: "border.strong", color: "fg.muted", background: "bg.subtle" } },
            brand:{ root: { borderColor: "border.brand", color: "{colors.brand.700}", background: "bg.brand.subtle" } },
        },
    },
    defaultVariants: { sentiment: "flat" },
});
