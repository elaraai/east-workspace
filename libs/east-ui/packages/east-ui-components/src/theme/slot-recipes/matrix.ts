/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Matrix slot recipe — the row × column grid of status-coloured segment bars.
 *
 * Shares the Planner header / group-head / row-header / marker chrome (one
 * unified header system across Table / Gantt / Planner / Matrix) and adds the
 * matrix-native bar: a weighted segment track whose colour is driven by a
 * `fill` variant (the status palette + brand / slack / free), a per-orientation
 * track (`orientation`), and the status `markerRing` / `markerIcon` carried
 * verbatim from the Planner marker. The renderer carries no inline design
 * values — it only consumes these slots.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const matrixSlotRecipe = defineSlotRecipe({
    className: "elara-matrix",
    slots: [
        "root", "header", "leftPanel",
        "row", "groupHead", "groupHeadCell", "rowHeader", "rowHeaderName", "rowHeaderSub",
        "cell",
        "bar", "seg", "segLabel", "resizeHandle",
        "markerRing", "markerIcon",
    ],
    base: {
        root: { display: "flex", flexDirection: "column", overflowX: "auto", overflowY: "hidden", background: "bg.surface", width: "100%" },
        // Header band — wrapper only. The header cells reuse the shared `table`
        // recipe's `columnHeader` slot (same chrome as Table / Gantt), so the
        // strong bottom rule + mono eyebrow are one source across all three.
        header: { background: "bg.panel", alignItems: "stretch" },
        leftPanel: { background: "bg.surface" },
        row: { borderBottomWidth: "1px", borderBottomColor: "border.subtle" },
        groupHead: {
            background: "bg.panel",
            minHeight: "28px",
            fontFamily: "mono",
            fontSize: "9.5px",
            fontWeight: "bold",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "{colors.gray.600}",
            display: "flex",
            alignItems: "center",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        groupHeadCell: {
            display: "flex",
            alignItems: "center",
            padding: "6px 12px",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
        },
        // Row header — mono name, border-right rule. No avatar, no sublabel.
        rowHeader: {
            fontFamily: "mono",
            padding: "8px 12px",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            minWidth: 0,
            overflow: "hidden",
        },
        rowHeaderName: {
            fontFamily: "mono",
            fontSize: "11.5px",
            fontWeight: "semibold",
            color: "fg.default",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        rowHeaderSub: {
            fontFamily: "mono",
            fontSize: "10px",
            color: "{colors.gray.500}",
            marginTop: "2px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        // Cell — segment-bar host. Border-right rule (row carries the bottom).
        cell: {
            position: "relative",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            display: "flex",
            alignItems: "center",
            padding: "8px",
            minWidth: 0,
            boxSizing: "border-box",
        },
        // Horizontal weight bar — width = weight; inset, rounded, clipped.
        bar: {
            display: "flex",
            alignItems: "stretch",
            height: "24px",
            width: "100%",
            borderRadius: "2px",
            overflow: "hidden",
            background: "transparent",
        },
        // One weighted slice. `fill` colours it; the in-bar label centres here.
        seg: {
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            position: "relative",
            overflow: "hidden",
            whiteSpace: "nowrap",
            boxSizing: "border-box",
        },
        segLabel: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", pointerEvents: "none" },
        // Drag-resize handle on an internal segment boundary (when onSegmentChange).
        resizeHandle: {
            position: "absolute",
            right: "-3px",
            top: 0,
            bottom: 0,
            width: "6px",
            cursor: "ew-resize",
            zIndex: 2,
            _after: {
                content: '""',
                position: "absolute",
                left: "50%",
                top: "30%",
                bottom: "30%",
                width: "1px",
                background: "rgba(255,255,255,0.6)",
            },
        },
        // Status ring around the marked cell — colour set by the `status` variant.
        markerRing: {
            position: "absolute",
            inset: "1px",
            borderWidth: "1.5px",
            borderStyle: "solid",
            borderRadius: "2px",
            pointerEvents: "none",
            zIndex: 1,
        },
        // A bare status icon in a cell corner; hovering surfaces the message.
        markerIcon: {
            position: "absolute",
            top: "3px",
            right: "3px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px",
            lineHeight: 1,
            cursor: "help",
            zIndex: 3,
        },
    },
    variants: {
        size: {
            sm: { rowHeader: { paddingY: "{spacing.1}" }, row: { minHeight: "40px" }, colHeader: { paddingY: "{spacing.1.5}" }, headerCell: { paddingY: "{spacing.1.5}" } },
            md: {},
            lg: { rowHeader: { paddingY: "{spacing.3}" }, row: { minHeight: "60px" }, colHeader: { paddingY: "{spacing.3}" }, headerCell: { paddingY: "{spacing.3}" } },
        },
        // Bar layout — horizontal weight bar vs bottom-anchored capacity column.
        orientation: {
            horizontal: {},
            vertical: {
                // Fixed-height bottom-anchored track, centred in a cell that
                // auto-sizes to it — so the inset is the cell padding on all
                // four sides (equal x / y padding).
                cell: { alignItems: "center" },
                bar: {
                    flexDirection: "column-reverse",
                    height: "32px",
                    borderRadius: 0,
                    borderWidth: "1px",
                    borderStyle: "solid",
                    borderColor: "border.subtle",
                },
                seg: { width: "100%", height: "auto" },
            },
        },
        // Segment fill — the status palette plus the three matrix-native fills.
        // Each arm sets the slice background and its in-bar label colour.
        fill: {
            brand:   { seg: { background: "{colors.brand.600}",  color: "{colors.white}" } },
            success: { seg: { background: "{colors.status.pos}", color: "{colors.white}" } },
            warning: { seg: { background: "{colors.status.warn}", color: "{colors.white}" } },
            danger:  { seg: { background: "{colors.status.neg}", color: "{colors.white}" } },
            info:    { seg: { background: "{colors.status.info}", color: "{colors.white}" } },
            neutral: { seg: { background: "bg.emphasized", color: "fg.default" } },
            slack: {
                seg: {
                    backgroundImage: "repeating-linear-gradient(-45deg, {colors.gray.200} 0 4px, {colors.gray.100} 4px 8px)",
                    color: "{colors.gray.500}",
                },
            },
            free: { seg: { background: "transparent", color: "{colors.gray.500}" } },
        },
        // Marker status — colours the ring border + icon (carried from Planner).
        status: {
            success: { markerRing: { borderColor: "{colors.status.pos}",  background: "bg.success.subtle" }, markerIcon: { color: "{colors.status.pos}"  } },
            warning: { markerRing: { borderColor: "{colors.status.warn}", background: "bg.warning.subtle" }, markerIcon: { color: "{colors.status.warn}" } },
            danger:  { markerRing: { borderColor: "{colors.status.neg}",  background: "bg.danger.subtle"  }, markerIcon: { color: "{colors.status.neg}"  } },
            info:    { markerRing: { borderColor: "{colors.status.info}", background: "bg.info.subtle"    }, markerIcon: { color: "{colors.status.info}" } },
            neutral: { markerRing: { borderColor: "border.strong",        background: "transparent"       }, markerIcon: { color: "fg.subtle"            } },
        },
    },
    defaultVariants: { size: "md", orientation: "horizontal", fill: "brand", status: "info" },
});
