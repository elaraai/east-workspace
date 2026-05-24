/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Planner slot recipe — mirror of `gantt` with slot-cell grid for
 * scheduling-style layouts.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const plannerSlotRecipe = defineSlotRecipe({
    className: "elara-planner",
    slots: [
        "root", "header", "headerCell", "leftPanel", "leftPanelHeader",
        "slotGrid", "row", "rowHeader", "cell", "axis", "event",
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
        leftPanel: { background: "bg.panel", borderRightWidth: "1px", borderRightColor: "border.subtle" },
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
            minHeight: "44px",
        },
        event: {
            background: "{colors.brand.600}",
            color: "white",
            fontFamily: "mono",
            fontSize: "10px",
            paddingX: "{spacing.2}",
            paddingY: "2px",
            borderRadius: "2px",
            fontWeight: "semibold",
        },
        axis: { fontFamily: "mono", fontSize: "10px", color: "fg.muted" },
    },
});
