/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Record slot recipe — the e3-ui table for a system of records (`Record -
 * DX Proposal.md`), in the Table's anatomy: the design system's Row card,
 * its rows 36, 32 or 28 tall and their cells padded 0 12, the first and the
 * last 20, under a column-group row and a header row that stick together.
 *
 *   - Toolbar: the title, mono 10/600 at 0.14em in ink, and the count after
 *     it on `bg.subtle`; the status line, mono 11 in `fg.muted`, right-aligned
 *     and one line; Add and Delete, the outline buttons, Delete off in
 *     `fg.faint` until rows are ticked.
 *   - Header: the group row 24 tall, each group's label mono 9.5/600 at 0.14em
 *     over a `border.strong` rule inset 6 at each end; the header row as tall
 *     as a row, its labels mono 10/600 at 0.1em, one line.
 *   - Select column: 46 wide, a 14 checkbox at radius 3, `brand.solid` once
 *     ticked.
 *   - Rows: `bg.surface`, `bg.canvas` under the pointer, `bg.subtle` selected
 *     or ticked; a draft row the warn wash at 8%, unchanged on hover. A cell
 *     that steps (a cycle, a toggle, a boolean) `bg.subtle` under the pointer;
 *     a drafted cell `brandTint`; the active cell `bg.subtle` and the inset
 *     focus ring; a new row's empty editable cell the warn wash at 17%.
 *   - Cells: the title 13/500 with neutral initials before it; the chips of a
 *     cycle or a toggle 22 tall (15 compact and condensed), each look a scale
 *     step of the heat ramp or a valence's 6% wash, edge and text step; the
 *     mark look's pips and dots; an age mono 13/500, warn past its threshold
 *     with a dot; an audit's date mono 13/500 and its who in `fg.muted`, or
 *     PENDING in `brandPressed`.
 *   - Strip: 32 tall on `bg.canvas`, its label mono 10/600 at 0.14em in
 *     `brand.solid`, its text 12.5 in `fg.strong`, its keys mono 10.5. Over a
 *     Sheet kind the Sheet's strip draws its chips in this frame.
 *   - Footer: 36 tall, padded 0 20, mono 10.5 counts in `fg.muted`, and the
 *     legend's 15-tall chips.
 *
 * Every value is a semantic token, so the dark theme comes for free; the
 * renderer sets data attributes and geometry alone.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fontAwesomeSize } from "../icon-size.js";

/** A chip's or a legend chip's look: the first member, a scale step, a toggle's on, or a valence's wash, edge and text step. */
const LOOKS = {
    "&[data-look=none]": { background: "bg.surface", color: "fg.subtle", borderColor: "border.strong" },
    "&[data-look=heat-1]": { background: "heat.1", color: "fg", borderColor: "heat.1" },
    "&[data-look=heat-2]": { background: "heat.2", color: "fg", borderColor: "heat.2" },
    "&[data-look=heat-3]": { background: "heat.3", color: "fg", borderColor: "heat.3" },
    "&[data-look=heat-4]": { background: "heat.4", color: "bg.surface", borderColor: "heat.4" },
    "&[data-look=heat-5]": { background: "heat.5", color: "bg.surface", borderColor: "heat.5" },
    "&[data-look=success]": { background: "status.posSubtle", color: "fg.success", borderColor: "status.pos" },
    "&[data-look=danger]": { background: "status.negSubtle", color: "fg.danger", borderColor: "status.neg" },
    "&[data-look=warning]": { background: "status.warnSubtle", color: "fg.warning", borderColor: "status.warn" },
    "&[data-look=info]": { background: "status.infoSubtle", color: "fg.info", borderColor: "status.info" },
} as const;

/** A row's, a cell's or a chip's change of state: the design system's hover motion. */
const SETTLE = { transitionDuration: "{durations.fast}", transitionTimingFunction: "{easings.out}" } as const;

/** A mark's dot and word: a valence's tone, or a 1px ring when neutral. */
const MARK_TONES = {
    "&[data-tone=neutral]": { "--record-mark": "transparent", "--record-mark-edge": "{colors.fg.subtle}", "--record-mark-ink": "{colors.fg.muted}" },
    "&[data-tone=success]": { "--record-mark": "{colors.status.pos}", "--record-mark-edge": "{colors.status.pos}", "--record-mark-ink": "{colors.fg.success}" },
    "&[data-tone=danger]": { "--record-mark": "{colors.status.neg}", "--record-mark-edge": "{colors.status.neg}", "--record-mark-ink": "{colors.fg.danger}" },
    "&[data-tone=warning]": { "--record-mark": "{colors.status.warn}", "--record-mark-edge": "{colors.status.warn}", "--record-mark-ink": "{colors.fg.warning}" },
    "&[data-tone=info]": { "--record-mark": "{colors.status.info}", "--record-mark-edge": "{colors.status.info}", "--record-mark-ink": "{colors.fg.info}" },
} as const;

/** The 14 checkbox the select column and a boolean cell draw: `brand.solid` once ticked, its 9 tick in the paper. */
const BOX = {
    width: "14px", height: "14px", boxSizing: "border-box", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
    lineHeight: "1", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "xs", background: "bg.surface",
    color: "bg.surface",
    "& > svg": fontAwesomeSize("9px"),
    "&[data-on]": { background: "brand.solid", borderColor: "brand.solid" },
} as const;

/** A cell's or a header cell's padding: 0 12, the first and the last 20, a centred cell's 4. */
const CELL_PAD = {
    paddingInline: "12px",
    "&[data-align=center]": { justifyContent: "center", paddingInline: "4px" },
    "&[data-align=end]": { justifyContent: "flex-end" },
    "&[data-first]": { paddingInlineStart: "20px" },
    "&[data-last]": { paddingInlineEnd: "20px" },
} as const;

/** A row that holds drafts, or is new: the warn wash at 8% over the paper. */
const DRAFT_WASH = "color-mix(in oklch, {colors.status.warn} 8%, {colors.bg.surface})";

/** A new row's empty editable cell: the warn wash at 17%. */
const REQUIRED_WASH = "color-mix(in srgb, {colors.status.warn} 17%, {colors.bg.surface})";

export const recordSlotRecipe = defineSlotRecipe({
    className: "elara-record",
    slots: [
        "root", "grid",
        "title", "titleText", "titleCount", "status", "actions", "action",
        "head", "groupRow", "groupSeg", "groupLabel", "groupRule", "headerRow", "headerCell", "headerLabel",
        "row", "cell", "tick", "run", "runRow", "runGutter", "runCell", "runActionCell",
        "titleCell", "avatar", "nobody", "personLabel", "text",
        "chip", "pips", "pip", "mark", "markDot", "markWord", "box",
        "age", "staleDot", "absent", "auditDate", "auditMeta", "pending", "pendingDot", "pendingMeta",
        "empty", "emptyMark", "emptyTitle", "emptyClear", "emptyBox", "emptyLink",
        "strip", "stripLabel", "stripText", "stripKeys",
        "footer", "footerCount", "footerNote", "footerSpacer", "legend", "legendItem", "legendChip", "legendName",
    ],
    base: {
        /* Main: the grid, then the strip, then the footer. */
        root: {
            display: "flex", flexDirection: "column", flex: "1 1 auto", height: "100%", minWidth: "0", minHeight: "0",
            fontFamily: "body", color: "fg", background: "bg.surface", isolation: "isolate",
        },
        /* The grid's own room: the Sheet's card scrolls its rows in it. */
        grid: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: "0", minWidth: "0" },

        /* The toolbar's lead: the title, then the count. */
        title: { flex: "none", display: "flex", alignItems: "center", gap: "8px" },
        titleText: {
            fontFamily: "mono", fontSize: "label.sm", fontWeight: 600, letterSpacing: "label", textTransform: "uppercase",
            color: "fg", whiteSpace: "nowrap",
        },
        titleCount: {
            height: "16px", boxSizing: "border-box", display: "inline-flex", alignItems: "center", paddingInline: "4px",
            borderRadius: "sm", background: "bg.subtle", fontFamily: "mono", fontSize: "label.sm", fontWeight: 600,
            fontFeatureSettings: '"tnum" 1', lineHeight: "1", color: "fg.strong",
        },
        /* The last gesture's words, one line, at the right of the slack. */
        status: {
            display: "block", width: "100%", minWidth: "0", textAlign: "right", fontFamily: "mono", fontSize: "label.lg",
            color: "fg.muted", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        },
        actions: { flex: "none", display: "flex", alignItems: "center", gap: "8px" },
        /* Add and Delete: the outline buttons, each icon the label's size; Delete off in `fg.faint` on the paper, no hover. */
        action: {
            "& > svg": fontAwesomeSize("1em"),
            _disabled: { background: "bg.surface", color: "fg.faint", cursor: "default", _hover: { background: "bg.surface" } },
        },

        /* The sticky head: the group row and the header row, with one rule under them. */
        head: { background: "bg.surface", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        groupRow: { display: "grid", height: "24px" },
        groupSeg: { minWidth: "0", display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingInline: "6px" },
        groupLabel: {
            textAlign: "center", fontFamily: "mono", fontSize: "label.xs", fontWeight: 600, letterSpacing: "label", textTransform: "uppercase",
            lineHeight: "18px", color: "fg.subtle", whiteSpace: "nowrap", overflow: "hidden",
        },
        groupRule: { height: "1px", background: "border.strong", "&[data-unlabelled]": { background: "transparent" } },
        headerRow: { display: "grid" },
        headerCell: {
            minWidth: "0", display: "flex", alignItems: "center", justifyContent: "flex-start", color: "fg.subtle", cursor: "default",
            ...CELL_PAD,
            /* The select column's box stays at the left as the columns scroll sideways under it. */
            "&[data-tick]": { cursor: "pointer", paddingInlineEnd: "12px", position: "sticky", left: "0", zIndex: "1", background: "bg.surface" },
        },
        headerLabel: {
            minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "mono", fontSize: "label.sm",
            fontWeight: 600, letterSpacing: "caps", textTransform: "uppercase", lineHeight: "14px",
        },

        /* A row: the DS Row card, its rule included in its height. */
        row: {
            display: "grid", boxSizing: "border-box", height: "100%", borderBottomWidth: "1px", borderBottomStyle: "solid",
            borderBottomColor: "border.subtle", background: "bg.surface", transitionProperty: "background-color", ...SETTLE,
            _hover: { background: "bg.canvas" },
            "&[data-selected]": { background: "bg.subtle", _hover: { background: "bg.subtle" } },
            "&[data-draft]": { background: DRAFT_WASH, _hover: { background: DRAFT_WASH } },
            "&[data-still]:not([data-selected]):not([data-draft])": { _hover: { background: "bg.surface" } },
        },
        cell: {
            position: "relative", minWidth: "0", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "flex-start",
            userSelect: "none", cursor: "default", outline: "none", transitionProperty: "background-color", ...SETTLE,
            ...CELL_PAD,
            /* The select column's cell: the whole cell ticks, takes no hover of its own, and stays at the left on the row's paper as the
               columns scroll sideways — above the cells' content and a ring scrolled under it (z 4), as the Sheet's gutter is. */
            "&[data-pick]": { cursor: "pointer", position: "sticky", left: "0", zIndex: "5", background: "inherit", _hover: { background: "inherit" } },
            "&[data-steps]": { cursor: "pointer", _hover: { background: "bg.subtle" } },
            "&[data-dirty]": { background: "brandTint", _hover: { background: "brandTint" } },
            "&[data-active]": { background: "bg.subtle", boxShadow: "{shadows.focusInset}", _hover: { background: "bg.subtle" } },
            "&[data-required]": { background: REQUIRED_WASH, _hover: { background: REQUIRED_WASH } },
            "&[data-still]": { cursor: "default", _hover: { background: "transparent" } },
            "&[data-still][data-dirty]": { _hover: { background: "brandTint" } },
            "&[data-still][data-active]": { _hover: { background: "bg.subtle" } },
            /* The editor of a Sheet kind lies over the cell, the cell's own box. */
            "& > [data-slot=editor]": { position: "absolute", inset: "0", zIndex: "10" },
        },
        /* The select column's box, 20 in; in the header, a pixel above the labels' line. */
        tick: { ...BOX, cursor: "pointer", "&[data-mixed]": { color: "fg.subtle" }, "[data-tick] > &": { marginBottom: "1px" } },
        /* A run of rows not read yet: the shared run's rows at the row's paper and rule, the select column's box in its place, each cell padded as a cell is. */
        run: { position: "relative" },
        runRow: { background: "bg.surface", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        runGutter: { paddingInlineStart: "20px", paddingInlineEnd: "12px", position: "sticky", left: "0", zIndex: "5", background: "bg.surface" },
        runCell: { paddingInline: "12px", "&:first-child": { paddingInlineStart: "20px" }, "&:last-child": { paddingInlineEnd: "20px" } },
        runActionCell: { paddingInline: "12px", "&:last-child": { paddingInlineEnd: "20px" } },
        titleCell: {
            flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "body", fontWeight: 500, color: "fg",
        },
        /* Neutral initials: never a colour per person. */
        avatar: {
            width: "24px", height: "24px", boxSizing: "border-box", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
            marginInlineEnd: "8px", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "full", background: "bg.subtle",
            fontFamily: "mono", fontSize: "label.sm", fontWeight: 600, letterSpacing: "0.04em", lineHeight: "1", textTransform: "uppercase", color: "fg.strong",
        },
        /* No one: a dashed ring. */
        nobody: {
            width: "24px", height: "24px", boxSizing: "border-box", flex: "none", marginInlineEnd: "8px", borderWidth: "1px", borderStyle: "dashed",
            borderColor: "border.strong", borderRadius: "full",
        },
        personLabel: {
            flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "body", color: "fg",
            "&[data-nobody]": { color: "fg.subtle" },
        },
        text: { flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "body", color: "fg" },
        /* A cycle's or a toggle's chip: one width per column, so the states line up. */
        chip: {
            height: "22px", minWidth: "var(--record-chip, 0px)", boxSizing: "border-box", paddingInline: "6px", display: "inline-flex",
            alignItems: "center", justifyContent: "center", lineHeight: "1", borderWidth: "1px", borderStyle: "solid", borderRadius: "sm",
            fontFamily: "mono", fontFeatureSettings: '"tnum" 1', fontSize: "label.md", fontWeight: 600, whiteSpace: "nowrap",
            transitionProperty: "background-color, color", ...SETTLE,
            ...LOOKS,
        },
        /* The mark look of a scale: one pip per member after the first. */
        pips: { display: "inline-flex", alignItems: "center", gap: "4px" },
        pip: {
            width: "8px", height: "8px", boxSizing: "border-box", borderRadius: "full", borderWidth: "1px", borderStyle: "solid",
            borderColor: "fg.faint", background: "transparent",
            "&[data-on]": { borderColor: "brand.solid", background: "brand.solid" },
        },
        /* The mark look of a valence: the Status idiom, quieter. */
        mark: { display: "inline-flex", alignItems: "center", gap: "8px", whiteSpace: "nowrap", ...MARK_TONES },
        markDot: {
            width: "8px", height: "8px", boxSizing: "border-box", flex: "none", borderRadius: "full", borderWidth: "1px", borderStyle: "solid",
            borderColor: "var(--record-mark-edge)", background: "var(--record-mark)",
        },
        markWord: {
            fontFamily: "mono", fontSize: "label.md", fontWeight: 600, letterSpacing: "caps", textTransform: "uppercase", color: "var(--record-mark-ink)",
        },
        box: BOX,
        /* Time since: mono, right-aligned, warn at its threshold. */
        age: {
            fontFamily: "mono", fontFeatureSettings: '"tnum" 1', fontSize: "body", fontWeight: 500, color: "fg", whiteSpace: "nowrap",
            "&[data-stale]": { color: "fg.warning" },
        },
        staleDot: { width: "8px", height: "8px", flex: "none", marginInlineEnd: "8px", borderRadius: "full", background: "status.warn" },
        absent: { textStyle: "absent", fontSize: "body", whiteSpace: "nowrap" },
        auditDate: {
            flex: "none", marginInlineEnd: "8px", fontFamily: "mono", fontFeatureSettings: '"tnum" 1', fontSize: "body", fontWeight: 500,
            color: "fg", whiteSpace: "nowrap",
        },
        auditMeta: { minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "body.sm", color: "fg.muted" },
        pending: {
            flex: "none", display: "inline-flex", alignItems: "center", gap: "8px", marginInlineEnd: "8px", fontFamily: "mono",
            fontSize: "label.md", fontWeight: 600, letterSpacing: "caps", textTransform: "uppercase", color: "brandPressed", whiteSpace: "nowrap",
        },
        pendingDot: { width: "8px", height: "8px", flex: "none", borderRadius: "full", background: "brandMark" },
        pendingMeta: { minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "body.sm", color: "brandPressed" },

        /* Nothing shown: the search, or the filters, match no row. */
        empty: { display: "grid", justifyItems: "center", gap: "8px", textAlign: "center", paddingBlock: "32px", paddingInline: "20px" },
        emptyMark: { fontFamily: "mono", fontSize: "num", lineHeight: "1", color: "border.strong" },
        emptyTitle: { fontFamily: "heading", fontSize: "title.xs", fontWeight: 700, letterSpacing: "snug", color: "fg" },
        emptyClear: {
            display: "flex", alignItems: "baseline", gap: "8px", padding: "0", border: "none", background: "transparent", cursor: "pointer",
            borderRadius: "sm", _focusVisible: { outline: "none", boxShadow: "{shadows.focus}" },
        },
        emptyBox: { fontFamily: "mono", fontSize: "body", color: "fg.subtle" },
        emptyLink: { fontSize: "body.sm", fontWeight: 500, color: "brand.solid" },

        /* The strip under the grid: its label, its words and its keys. */
        strip: {
            height: "32px", boxSizing: "border-box", flex: "none", display: "flex", alignItems: "center", gap: "12px", paddingInline: "16px",
            background: "bg.canvas", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle", position: "relative", overflow: "hidden",
        },
        stripLabel: {
            flex: "none", fontFamily: "mono", fontSize: "label.sm", fontWeight: 600, letterSpacing: "label", textTransform: "uppercase",
            color: "brand.solid", whiteSpace: "nowrap",
        },
        stripText: { flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "body.sm", color: "fg.strong" },
        stripKeys: { flex: "none", fontFamily: "mono", fontSize: "label.md", color: "fg.subtle", whiteSpace: "nowrap" },

        /* The footer: the rows shown, the stale count, and the legend. */
        footer: {
            height: "36px", boxSizing: "border-box", flex: "none", display: "flex", alignItems: "center", gap: "16px", paddingInline: "20px",
            borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle", background: "bg.surface", overflow: "hidden",
        },
        footerCount: {
            fontFamily: "mono", fontFeatureSettings: '"tnum" 1', fontSize: "label.md", color: "fg.muted", whiteSpace: "nowrap",
            "& b": { fontWeight: 600, color: "fg" },
        },
        footerNote: { fontFamily: "mono", fontFeatureSettings: '"tnum" 1', fontSize: "label.md", color: "fg.muted", whiteSpace: "nowrap" },
        footerSpacer: { flex: "1", minWidth: "0" },
        legend: { flex: "none", display: "flex", alignItems: "center", gap: "16px" },
        legendItem: { display: "inline-flex", alignItems: "center", gap: "8px", whiteSpace: "nowrap" },
        legendChip: {
            height: "15px", minWidth: "var(--record-chip, 0px)", boxSizing: "border-box", paddingInline: "4px", display: "inline-flex",
            alignItems: "center", justifyContent: "center", lineHeight: "1", borderWidth: "1px", borderStyle: "solid", borderRadius: "sm",
            fontFamily: "mono", fontSize: "label.xs", fontWeight: 600,
            ...LOOKS,
        },
        legendName: { fontFamily: "mono", fontSize: "label.md", color: "fg.muted" },
    },
    variants: {
        /* Rows 36 · 32 · 28: at compact and condensed the chips stand 15 tall and the initials 20. */
        density: {
            comfortable: {},
            compact: {
                chip: { height: "15px", fontSize: "label.xs" },
                avatar: { width: "20px", height: "20px", fontSize: "label.xs" },
                nobody: { width: "20px", height: "20px" },
            },
            condensed: {
                chip: { height: "15px", fontSize: "label.xs" },
                avatar: { width: "20px", height: "20px", fontSize: "label.xs" },
                nobody: { width: "20px", height: "20px" },
            },
        },
    },
    defaultVariants: { density: "comfortable" },
});
