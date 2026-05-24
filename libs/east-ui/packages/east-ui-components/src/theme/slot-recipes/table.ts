/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Table slot recipe — pattern_spec `.dt` data table.
 *
 *   - Column header: mono uppercase 10/600/0.16em, `bg.panel`, 1 px
 *     `border.strong` bottom rule.
 *   - Cell: body 13/normal, 1 px `border.subtle` bottom rule, 14/10
 *     padding.
 *   - Numeric cell (when `data-numeric` is set on the cell): mono
 *     tabular, right-aligned.
 *   - Total row: 1 px `border.strong` top, `bg.panel` fill, weight 600.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const tableSlotRecipe = defineSlotRecipe({
    className: "elara-table",
    slots: [
        "root", "header", "body", "row", "cell", "columnHeader",
        "footer", "caption", "scrollArea",
    ],
    base: {
        root: {
            fontFamily: "body",
            borderCollapse: "collapse",
            width: "100%",
            fontFeatureSettings: '"tnum" 1',
        },
        columnHeader: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            letterSpacing: "{letterSpacings.wider2}",
            textTransform: "uppercase",
            color: "fg.muted",
            background: "bg.canvas",
            paddingX: "14px",
            paddingY: "10px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.strong",
            textAlign: "left",
            whiteSpace: "nowrap",
        },
        cell: {
            fontSize: "13px",
            paddingX: "14px",
            paddingY: "10px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            verticalAlign: "top",
            color: "fg",
        },
        row: { transitionProperty: "background", transitionDuration: "{durations.fast}" },
        footer: {
            borderTopWidth: "1px",
            borderTopColor: "border.strong",
            background: "bg.panel",
            fontWeight: "semibold",
        },
        caption: { textStyle: "caption", color: "fg.muted", marginTop: "{spacing.2}" },
    },
    variants: {
        variant: {
            line: {},
            outline: {
                root: { borderWidth: "1px", borderColor: "border.subtle", borderRadius: "{radii.md}" },
            },
        },
        // Density sizes — padding from Chakra spacing tokens; the renderer maps
        // `value.density` (compact / cozy / comfortable) onto sm / md / lg and
        // pairs each with a row height from `TABLE_ROW_HEIGHT`.
        size: {
            sm: { cell: { paddingX: "{spacing.2}", paddingY: "{spacing.1}", fontSize: "12px" }, columnHeader: { paddingX: "{spacing.2}", paddingY: "{spacing.1}" } },
            md: { cell: { paddingX: "{spacing.3.5}", paddingY: "{spacing.2.5}", fontSize: "13px" }, columnHeader: { paddingX: "{spacing.3.5}", paddingY: "{spacing.2.5}" } },
            lg: { cell: { paddingX: "{spacing.4}", paddingY: "{spacing.3}", fontSize: "{fontSizes.sm}" }, columnHeader: { paddingX: "{spacing.4}", paddingY: "{spacing.3}" } },
        },
        striped: { true: { row: { "&:nth-of-type(odd)": { background: "bg.subtle" } } } },
        interactive: { true: { row: { _hover: { background: "bg.subtle" }, cursor: "pointer" } } },
    },
    defaultVariants: { variant: "line", size: "md" },
});
