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
 *     padding. Right-aligned / mono numeric cells are a per-cell
 *     concern — author them with a `render` UIComponent.
 *   - Total row: 1 px `border.strong` top, `bg.panel` fill, weight 600.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const tableSlotRecipe = defineSlotRecipe({
    className: "elara-table",
    slots: [
        "root", "header", "body", "row", "cell", "columnHeader",
        "footer", "caption", "scrollArea", "groupHead", "groupHeadCell",
        "groupHeadAggregate",
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
            color: "fg.subtle",
            /* Same gray.50 as canvas in light; in dark, canvas (gray.900) is
             * DARKER than the surface the table sits on, so the header band
             * read as a hole — panel tracks the surface level (#362). */
            background: "bg.panel",
            paddingX: "14px",
            paddingY: "10px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.strong",
            textAlign: "left",
            whiteSpace: "nowrap",
        },
        // Row grouping (#317) — group header rows, one visual family with the
        // Matrix / Planner groupHead band (bg.panel wash, mono micro-label).
        groupHead: {
            background: "bg.panel",
            minHeight: "28px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            cursor: "pointer",
            _hover: { background: "bg.muted" },
        },
        groupHeadCell: {
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "600",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "fg.muted",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.1}",
            fontFeatureSettings: '"tnum" 1',
        },
        // Aggregate cells stay at MEMBER-cell scale (an accounting subtotal
        // matches its member numbers, just heavier) — only the group LABEL
        // wears the mono micro-label treatment.
        groupHeadAggregate: {
            fontFamily: "body",
            fontSize: "{fontSizes.control}",
            fontWeight: "600",
            letterSpacing: "normal",
            textTransform: "none",
            color: "fg",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.1}",
            fontFeatureSettings: '"tnum" 1',
        },
        cell: {
            fontSize: "{fontSizes.control}",
            // Tight leading so a single-line cell + 10px vertical padding
            // lands on the spec's ~36px row rather than ballooning past it
            // under Chakra's default 1.5 line-height.
            lineHeight: "{lineHeights.tight}",
            paddingX: "14px",
            paddingY: "10px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            // Centre cell content vertically — for the Table's content-height
            // rows this matches the old top alignment; for the Gantt's left pane
            // (rows sized to the same density token) it keeps text centred.
            verticalAlign: "middle",
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
            sm: { cell: { paddingX: "{spacing.2}", paddingY: "{spacing.1.5}", fontSize: "12px" }, columnHeader: { paddingX: "{spacing.2}", paddingY: "{spacing.1.5}" } },
            md: { cell: { paddingX: "{spacing.3.5}", paddingY: "{spacing.2.5}", fontSize: "{fontSizes.control}" }, columnHeader: { paddingX: "{spacing.3.5}", paddingY: "{spacing.2.5}" } },
            lg: { cell: { paddingX: "{spacing.4}", paddingY: "{spacing.3}", fontSize: "{fontSizes.sm}" }, columnHeader: { paddingX: "{spacing.4}", paddingY: "{spacing.3}" } },
        },
        striped: { true: { row: { "&:nth-of-type(odd)": { background: "bg.subtle" } } } },
        interactive: { true: { row: { _hover: { background: "bg.subtle" }, cursor: "pointer" } } },
    },
    defaultVariants: { variant: "line", size: "md" },
});
