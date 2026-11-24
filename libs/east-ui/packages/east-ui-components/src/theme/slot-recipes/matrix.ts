/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Matrix slot recipe — the row × column grid of status-coloured segment bars.
 *
 * Shares the collection header / row-header / marker chrome (one unified
 * header system across Table / Matrix — a nested row's indent and caret are
 * the `table` recipe's `treeIndent` / `treeToggle`, #955) and adds the
 * matrix-native bar: a weighted segment track whose colour is driven by a
 * `fill` variant (the status palette + brand / slack / free), a per-orientation
 * track (`orientation`), and the status `markerRing` / `markerIcon` carried
 * verbatim from the Planner marker. The renderer carries no inline design
 * values — it only consumes these slots.
 *
 * In a tile (`tile`, #1671) — a Studio pivot's grid of heat blocks: its
 * header on the surface, each head its short label; its rows unruled, 40
 * tall around a 30px block of radius 4, 2 from its neighbours, its value mono
 * 11/500; a pair with no rows an outlined block that says so; its row names
 * mono 11/400, padded 0 12 from the Frame's 20.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { centredLine } from "../one-line-box.js";

export const matrixSlotRecipe = defineSlotRecipe({
    className: "elara-matrix",
    slots: [
        "root", "header", "leftPanel", "colHeader", "headerCell",
        "row", "rowHeader", "rowHeaderText", "rowHeaderName", "rowHeaderSub",
        "cell",
        "bar", "seg", "segLabel", "resizeHandle",
        "markerRing", "markerIcon",
    ],
    base: {
        root: { display: "flex", flexDirection: "column", overflowX: "auto", overflowY: "hidden", overscrollBehaviorX: "contain" /* touch pan containment (#352) */, background: "bg.surface", width: "100%" },
        // Header band — wrapper only. The header cells reuse the shared `table`
        // recipe's `columnHeader` slot (same chrome as the Table), so the
        // strong bottom rule + mono eyebrow are one source across both.
        header: { background: "bg.panel", alignItems: "stretch" },
        leftPanel: { background: "bg.surface" },
        row: { borderBottomWidth: "1px", borderBottomColor: "border.subtle" },
        // Row header — mono name, border-right rule. No avatar. A nested row
        // leads with its indent and caret (#955), then its text.
        rowHeader: {
            fontFamily: "mono",
            padding: "8px 12px",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            display: "flex",
            alignItems: "center",
            minWidth: 0,
            overflow: "hidden",
        },
        // The row header's text — its name over its sublabel, centred in the row.
        rowHeaderText: {
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flex: "1",
            minWidth: 0,
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
            color: "fg.subtle",
            marginTop: "2px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        // A head's label: the row names' head, and a column's — placed by the `tile` variant.
        colHeader: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 },
        headerCell: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 },
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
        // One weighted slice. `fill` colours it; the in-bar label centres here, on
        // a whole line of 14px in the bar's 24px (#1638): the theme's line of 1.5
        // is 15px, which the slice centred half a pixel under its edge. Its
        // numerals are tabular (a pivot's heat cell, #1671).
        seg: {
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "mono",
            fontSize: "10px",
            lineHeight: centredLine(24, 14),
            fontWeight: "semibold",
            fontVariantNumeric: "tabular-nums",
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
            sm: { rowHeader: { paddingY: "{spacing.1}" }, row: { minHeight: "40px" } },
            md: {},
            lg: { rowHeader: { paddingY: "{spacing.3}" }, row: { minHeight: "60px" } },
        },
        // A tile's grid (#1671): heat blocks, no rules.
        tile: {
            true: {
                header: { background: "transparent" },
                // The row names' head starts at the Frame's edge; a column's head is centred over its blocks.
                colHeader: { paddingInlineStart: "20px", paddingInlineEnd: "12px", lineHeight: centredLine(35, 19) },
                headerCell: { paddingInline: "2px", lineHeight: centredLine(35, 19) },
                row: { borderBottomWidth: "0" },
                rowHeader: { padding: "0 12px 0 20px", borderRightWidth: "0" },
                rowHeaderName: { fontSize: "11px", fontWeight: "400" },
                // 5 over and under its 30px block: the whole 40px row the renderer stands every bar in; 2 either side
                // stands the blocks 4 apart.
                cell: { padding: "5px 2px", borderRightWidth: "0" },
                bar: { height: "30px", borderRadius: "4px" },
                seg: {
                    fontSize: "11px", fontWeight: "500", lineHeight: centredLine(30, 14),
                    // A pair with no rows: the surface inside a `--rule`, its words in the label voice (28 inside the rule).
                    "&[data-fill=free]": { borderWidth: "1px", borderStyle: "solid", borderColor: "border.subtle", borderRadius: "4px", fontSize: "10px", fontWeight: "400", lineHeight: centredLine(28, 14) },
                },
            },
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
            brand:   { seg: { background: "brand.solid",  color: "brand.contrast" } },
            success: { seg: { background: "{colors.status.pos}", color: "{colors.white}" } },
            warning: { seg: { background: "{colors.status.warn}", color: "{colors.white}" } },
            danger:  { seg: { background: "{colors.status.neg}", color: "{colors.white}" } },
            info:    { seg: { background: "{colors.status.info}", color: "{colors.white}" } },
            neutral: { seg: { background: "bg.emphasized", color: "fg.default" } },
            slack: {
                seg: {
                    backgroundImage: "repeating-linear-gradient(-45deg, {colors.bg.emphasized} 0 4px, {colors.bg.subtle} 4px 8px)",
                    color: "fg.subtle",
                },
            },
            free: { seg: { background: "transparent", color: "fg.subtle" } },
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
