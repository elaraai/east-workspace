/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Chart pie slot recipe (#1671) — a pie and its legend, as the pie's mock
 * draws them: the pie beside the legend, 20 apart, where the chart is wide
 * enough, above it where it is not. A legend row is 26 tall: a 10 × 10
 * swatch — a slice is an area, where a series' 14 × 3 swatch is a line — the
 * label in mono 10.5 / 600 `--ink`, the slice's value in mono 12 / 500, and
 * its share in mono 10.5 `--ink-4`, each tabular, on a whole 16px line in the
 * row (#1638). Under the rows, the legend's note in mono 10 `--ink-4`. A
 * donut's total is the 26px numeral, over its caption in mono 10 / 500
 * `--ink-4`. An entry a click reaches is a button, whose hover steps one paper
 * darker. A legend of names alone is the swatch and the label. A row off
 * while the chart's host marks another slice (`data-dimmed`, #1673) is the
 * design system's off row: its label and value `--ink-4` at 500, its swatch
 * the muted mark, which the renderer draws. The pie's
 * frame places the pie a whole number of pixels from its edges — beside its
 * legend in the middle of its height, over one in the middle of its width,
 * alone in the middle of both — so the recipe leaves it at the frame's start.
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { centredLine } from "../one-line-box.js";

/** A legend row's height, which the pie's frame counts its rows by. */
const ROW = 26;

export const chartPieSlotRecipe = defineSlotRecipe({
    className: "elara-chart-pie",
    slots: ["root", "plot", "total", "caption", "legend", "entry", "swatch", "label", "value", "share", "note"],
    base: {
        root: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.5}",
            width: "100%",
            height: "100%",
            minWidth: "0",
        },
        /* At the frame's start on both axes: the frame's own margins place it, in whole pixels. */
        plot: {
            flexShrink: "0",
            display: "block",
            alignSelf: "flex-start",
        },
        /* A donut's total, in its centre: the 26px numeral, mono and tabular. */
        total: {
            fontFamily: "mono",
            fontSize: "{fontSizes.num}",
            fontWeight: "600",
            fill: "fg",
            fontVariantNumeric: "tabular-nums",
        },
        /* What the total is, under it: mono 10 / 500, `--ink-4`. */
        caption: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "500",
            fill: "fg.subtle",
        },
        legend: {
            display: "flex",
            flexDirection: "column",
            minWidth: "0",
            flex: "1",
        },
        entry: {
            display: "grid",
            gridTemplateColumns: "10px minmax(0, 1fr) auto 32px",
            alignItems: "center",
            columnGap: "{spacing.2}",
            width: "100%",
            height: `${ROW}px`,
            flexShrink: "0",
            borderRadius: "{radii.sm}",
            fontFamily: "mono",
            fontSize: "10.5px",
            lineHeight: centredLine(ROW, 16),
            textAlign: "start",
            background: "transparent",
            "&[data-clickable]": {
                cursor: "pointer",
                _hover: { background: "bg.subtle" },
                _focusVisible: { outline: "none", boxShadow: "focus" },
            },
            // A legend of names alone: the swatch and the label.
            "&[data-names]": { gridTemplateColumns: "10px minmax(0, 1fr)" },
        },
        swatch: {
            width: "10px",
            height: "10px",
        },
        label: {
            fontWeight: "600",
            color: "fg",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            "[data-dimmed] > &": { color: "fg.subtle", fontWeight: "500" },
        },
        value: {
            fontSize: "12px",
            fontWeight: "500",
            color: "fg",
            fontVariantNumeric: "tabular-nums",
            textAlign: "right",
            "[data-dimmed] > &": { color: "fg.subtle" },
        },
        share: {
            fontWeight: "400",
            color: "fg.subtle",
            fontVariantNumeric: "tabular-nums",
            textAlign: "right",
        },
        /* The legend's note, under its rows: mono 10 `--ink-4`, 4 under the last row. */
        note: {
            paddingTop: "{spacing.1}",
            fontFamily: "mono",
            fontSize: "10px",
            lineHeight: "15px",
            color: "fg.subtle",
        },
    },
    variants: {
        /* Beside the pie where the chart is wide enough; under it where it is not. */
        layout: {
            side: { root: { flexDirection: "row" } },
            below: { root: { flexDirection: "column", alignItems: "stretch" } },
        },
    },
    defaultVariants: {
        layout: "side",
    },
});
