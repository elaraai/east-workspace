/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Calendar slot recipe — the day-of-week × week intensity grid per the
 * `calendar-heatmap` pattern: mono eyebrow header with the low→high legend,
 * mono day/week labels, brand-ramp cells whose text flips to the on-tint
 * ink in the upper steps, and the selection footer with the pos/neg delta
 * chip and the drill action.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const calendarSlotRecipe = defineSlotRecipe({
    className: "elara-calendar",
    slots: [
        "root", "header", "title", "legend",
        "grid", "dayHeader", "weekLabel", "cell",
        "footer", "summary", "deltaChip", "action",
    ],
    base: {
        /* Bare like Table / Planner — identity chrome (title, outer frame)
         * is host composition via Card / Slice.Frame. */
        root: {
            background: "bg.surface",
        },
        header: {
            display: "flex",
            justifyContent: "flex-end",
            paddingX: "{spacing.4}",
            paddingTop: "{spacing.2}",
        },
        legend: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        grid: {
            display: "grid",
            gap: "{spacing.1}",
            padding: "{spacing.4}",
        },
        dayHeader: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
            textAlign: "center",
            paddingBottom: "{spacing.1}",
        },
        weekLabel: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            color: "fg.subtle",
            display: "flex",
            alignItems: "center",
        },
        cell: {
            fontFamily: "mono",
            fontSize: "11px",
            fontVariantNumeric: "tabular-nums",
            textAlign: "center",
            paddingY: "{spacing.2}",
            borderRadius: "{radii.sm}",
            cursor: "pointer",
            color: "fg",
            /* Brand intensity ramp — text flips to the on-tint ink in the
             * upper steps for contrast. */
            "&[data-level='0']": { background: "{colors.brand.50}" },
            "&[data-level='1']": { background: "{colors.brand.100}" },
            "&[data-level='2']": { background: "{colors.brand.200}" },
            "&[data-level='3']": { background: "{colors.brand.300}" },
            "&[data-level='4']": { background: "{colors.brand.500}", color: "{colors.white}" },
            "&[data-level='5']": { background: "{colors.brand.600}", color: "{colors.white}" },
            "&[data-level='6']": { background: "{colors.brand.700}", color: "{colors.white}" },
            "&[data-empty]": { background: "bg.panel", color: "fg.subtle", cursor: "default" },
            "&[data-selected]": {
                outline: "2px solid",
                outlineColor: "fg",
                outlineOffset: "-2px",
            },
        },
        footer: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.3}",
            paddingX: "{spacing.4}",
            paddingY: "{spacing.2}",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
        },
        summary: {
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.muted",
        },
        deltaChip: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            paddingX: "{spacing.1}",
            paddingY: "1px",
            borderRadius: "{radii.xs}",
            borderWidth: "1px",
            "&[data-tone=pos]": { color: "fg.success", borderColor: "fg.success", background: "bg.success.subtle" },
            "&[data-tone=neg]": { color: "fg.danger", borderColor: "fg.danger", background: "bg.danger.subtle" },
        },
        action: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "600",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "link",
            cursor: "pointer",
            background: "transparent",
            border: "none",
            padding: "0",
            "&[data-disabled]": { color: "fg.subtle", cursor: "default" },
        },
    },
});
