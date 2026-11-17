/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Chart pie slot recipe (#1671) — a pie and its legend: the pie beside the
 * legend where the chart is wide enough, above it where it is not. A legend
 * entry is the chart rules' (`guidelines/charts.md`, Legend): a 14 × 3 swatch,
 * the label in mono 10.5 / 600 `--ink`, then the slice's value and its share,
 * each tabular, the share in `--ink-4`. An entry a click reaches is a button,
 * whose hover steps one paper darker.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const chartPieSlotRecipe = defineSlotRecipe({
    className: "elara-chart-pie",
    slots: ["root", "plot", "total", "legend", "entry", "swatch", "label", "value", "share"],
    base: {
        root: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.4}",
            width: "100%",
            height: "100%",
            minWidth: "0",
        },
        plot: {
            flexShrink: "0",
            display: "block",
        },
        /* A donut's total, in its centre: a numeral, mono and tabular. */
        total: {
            fontFamily: "mono",
            fontSize: "15px",
            fontWeight: "600",
            fill: "fg",
            fontVariantNumeric: "tabular-nums",
        },
        legend: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.1}",
            minWidth: "0",
            flex: "1",
        },
        entry: {
            display: "grid",
            gridTemplateColumns: "14px minmax(0, 1fr) auto 4ch",
            alignItems: "center",
            columnGap: "{spacing.2}",
            width: "100%",
            paddingY: "2px",
            paddingX: "{spacing.1}",
            borderRadius: "{radii.sm}",
            fontFamily: "mono",
            fontSize: "10.5px",
            lineHeight: "16px",
            textAlign: "start",
            background: "transparent",
            "&[data-clickable]": {
                cursor: "pointer",
                _hover: { background: "bg.subtle" },
                _focusVisible: { outline: "none", boxShadow: "focus" },
            },
        },
        swatch: {
            width: "14px",
            height: "3px",
            borderRadius: "1px",
        },
        label: {
            fontWeight: "600",
            color: "fg",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        value: {
            fontWeight: "600",
            color: "fg",
            fontVariantNumeric: "tabular-nums",
            textAlign: "right",
        },
        share: {
            fontWeight: "500",
            color: "fg.subtle",
            fontVariantNumeric: "tabular-nums",
            textAlign: "right",
        },
    },
    variants: {
        /* Beside the pie where the chart is wide enough; under it where it is not. */
        layout: {
            side: { root: { flexDirection: "row" } },
            below: { root: { flexDirection: "column", alignItems: "stretch" }, plot: { alignSelf: "center" } },
        },
    },
    defaultVariants: {
        layout: "side",
    },
});
