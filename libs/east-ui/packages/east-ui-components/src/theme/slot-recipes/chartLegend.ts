/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Chart legend slot recipe — a chart's legend, as the chart rules have it
 * (`guidelines/charts.md`, Legend; #1671): over the plot, from the chart's
 * start, one 13px line with 12px under it; each entry a 14 × 3 swatch and its
 * name in mono 10.5 / 600 `--ink`, 6px apart, the entries 16px apart. Under
 * the plot (`data-below`) the 12px is above it. An entry a click reaches is a
 * button. An entry off while the chart's host marks another (`data-dimmed`,
 * #1673) is the design system's off row: its name `--ink-4` at 500, its
 * swatch the muted mark, which the renderer draws. Its one line holds the
 * entries that fit whole (#1692), then `+N more` in the off row's voice,
 * which names the rest on hover; a first entry too wide for the line ends its
 * name in an ellipsis.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const chartLegendSlotRecipe = defineSlotRecipe({
    className: "elara-chart-legend",
    slots: ["root", "entry", "swatch", "label", "more"],
    base: {
        root: {
            display: "flex",
            alignItems: "flex-start",
            columnGap: "{spacing.4}",
            minWidth: "0",
            height: "25px",
            boxSizing: "border-box",
            overflow: "hidden",
            "&[data-below]": { paddingTop: "{spacing.3}" },
        },
        entry: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.1.5}",
            minWidth: "0",
            height: "13px",
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "600",
            lineHeight: "13px",
            color: "fg",
            whiteSpace: "nowrap",
            "&:is(button)": { cursor: "pointer" },
            "&[data-dimmed]": { color: "fg.subtle", fontWeight: "500" },
        },
        swatch: { width: "14px", height: "3px", flexShrink: "0" },
        label: { minWidth: "0", overflow: "hidden", textOverflow: "ellipsis" },
        more: { flexShrink: "0", height: "13px", fontFamily: "mono", fontSize: "10.5px", fontWeight: "500", lineHeight: "13px", color: "fg.subtle", whiteSpace: "nowrap" },
    },
});
