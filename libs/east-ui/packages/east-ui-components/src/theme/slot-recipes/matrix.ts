/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Matrix slot recipe — spec `.mx` row × column grid with rich cell
 * renderers (bars, avatars, heat-coloured backgrounds).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const matrixSlotRecipe = defineSlotRecipe({
    className: "elara-matrix",
    slots: [
        "root", "colHeader", "rowHeader", "cornerHeader",
        "cell", "emptyCell", "bar", "avatar", "legend", "overlay",
    ],
    base: {
        root: {
            display: "grid",
            fontSize: "12px",
            borderTopWidth: "1px",
            borderLeftWidth: "1px",
            borderTopColor: "border.subtle",
            borderLeftColor: "border.subtle",
        },
        colHeader: {
            paddingX: "{spacing.2}",
            paddingY: "{spacing.2}",
            background: "bg.panel",
            textStyle: "caption.eyebrow",
            borderRightWidth: "1px",
            borderBottomWidth: "1px",
            borderRightColor: "border.subtle",
            borderBottomColor: "border.subtle",
            textAlign: "center",
        },
        rowHeader: {
            paddingX: "{spacing.2}",
            paddingY: "{spacing.2}",
            minHeight: "32px",
            background: "bg.panel",
            borderRightWidth: "1px",
            borderBottomWidth: "1px",
            borderRightColor: "border.subtle",
            borderBottomColor: "border.subtle",
            fontSize: "12px",
            color: "fg",
        },
        cornerHeader: {
            background: "bg.panel",
            borderRightWidth: "1px",
            borderBottomWidth: "1px",
            borderRightColor: "border.subtle",
            borderBottomColor: "border.subtle",
        },
        cell: {
            background: "bg.surface",
            padding: "{spacing.2}",
            minHeight: "44px",
            borderRightWidth: "1px",
            borderBottomWidth: "1px",
            borderRightColor: "border.subtle",
            borderBottomColor: "border.subtle",
            display: "flex",
            alignItems: "center",
        },
        emptyCell: { background: "bg.subtle" },
        bar: {
            display: "flex",
            alignItems: "stretch",
            height: "24px",
            width: "100%",
            borderRadius: "2px",
            overflow: "hidden",
            background: "transparent",
        },
        avatar: {
            width: "24px",
            height: "24px",
            borderRadius: "{radii.full}",
            background: "{colors.brand.600}",
            color: "white",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "bold",
            flexShrink: 0,
        },
        legend: {
            display: "flex",
            gap: "{spacing.3}",
            alignItems: "center",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.2}",
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.muted",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
        },
    },
});
