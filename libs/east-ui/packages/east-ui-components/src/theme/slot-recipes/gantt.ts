/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Gantt slot recipe — header band, left column pane, timeline rows, task
 * bars and milestone diamonds.
 *
 * Status / kind colours are runtime East-variant data, so the SVG
 * renderer resolves them per-event via `useToken` against the semantic
 * tokens in `palette.ts`; the bar track (`bg.canvas`) and diamond border
 * (white) are status-independent. The recipe owns everything
 * colour-and-data-independent: header band, left-pane / cell dividers,
 * mono eyebrow typography, and the per-density `size` block.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const ganttSlotRecipe = defineSlotRecipe({
    className: "elara-gantt",
    slots: [
        "root", "header", "headerCell", "leftPanel", "leftPanelHeader",
        "timeline", "row", "rowHeader", "rowHeaderSub", "cell",
        "axis", "axisTick",
    ],
    base: {
        root: { display: "flex", flexDirection: "column", overflow: "hidden" },
        header: {
            background: "bg.canvas",
            borderBottomWidth: "1px",
            borderBottomColor: "border.strong",
            display: "flex",
        },
        headerCell: {
            textStyle: "caption.eyebrow",
            paddingX: "{spacing.1}",
            paddingY: "10px",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            minWidth: 0,
        },
        leftPanel: {
            background: "bg.canvas",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
        },
        leftPanelHeader: {
            textStyle: "caption.eyebrow",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            background: "bg.canvas",
        },
        rowHeader: {
            fontFamily: "mono",
            fontSize: "{fontSizes.control}",
            color: "fg.default",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        rowHeaderSub: {
            fontFamily: "mono",
            fontSize: "{fontSizes.control}",
            color: "fg.subtle",
            textAlign: "right",
        },
        cell: {
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        axis: { textStyle: "caption.eyebrow" },
        axisTick: { textStyle: "caption.eyebrow" },
    },
    variants: {
        size: {
            sm: { rowHeader: { paddingY: "{spacing.1}" } },
            md: {},
            lg: { rowHeader: { paddingY: "{spacing.3}" } },
        },
    },
    defaultVariants: { size: "md" },
});
