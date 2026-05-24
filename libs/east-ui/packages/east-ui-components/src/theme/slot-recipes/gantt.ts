/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Gantt slot recipe — spec `.mx-*` grid with horizontal task bars.
 *
 * Header bar `bg.panel`, row dividers `border.subtle`, task bars use
 * status palette via the `barStrip` segment colours.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const ganttSlotRecipe = defineSlotRecipe({
    className: "elara-gantt",
    slots: [
        "root", "header", "headerCell", "leftPanel", "leftPanelHeader",
        "timeline", "row", "rowHeader", "cell", "axis", "axisTick",
        "bar", "milestone", "event",
    ],
    base: {
        root: { display: "flex", flexDirection: "column", overflow: "hidden" },
        header: {
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            display: "flex",
        },
        headerCell: {
            textStyle: "caption.eyebrow",
            paddingX: "{spacing.2}",
            paddingY: "{spacing.2}",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            textAlign: "center",
        },
        leftPanel: {
            background: "bg.panel",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
        },
        leftPanelHeader: {
            textStyle: "caption.eyebrow",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            background: "bg.panel",
        },
        rowHeader: {
            background: "bg.panel",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            fontSize: "13px",
            color: "fg",
        },
        cell: {
            background: "bg.surface",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            minHeight: "32px",
        },
        bar: {
            height: "20px",
            borderRadius: "2px",
            background: "{colors.brand.600}",
            color: "white",
            fontFamily: "mono",
            fontSize: "10px",
            paddingX: "{spacing.2}",
            display: "flex",
            alignItems: "center",
            fontWeight: "semibold",
        },
        milestone: { color: "{colors.brand.700}", fontFamily: "mono", fontSize: "11px" },
        axis: { fontFamily: "mono", fontSize: "10px", color: "fg.muted" },
        axisTick: { fontFamily: "mono", fontSize: "10px", color: "fg.muted" },
    },
});
