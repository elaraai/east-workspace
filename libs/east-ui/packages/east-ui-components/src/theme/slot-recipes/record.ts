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
 *     it on `bg.subtle`, inset on a phone's row as its pager is; the status
 *     line, mono 11 in `fg.muted`, right-aligned and one line; Add and Delete,
 *     the outline buttons, Delete off in `fg.faint` until rows are ticked.
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
 *   - Footer: 36 tall, padded 0 20, mono 10.5 counts in `fg.muted`, the
 *     legend's 15-tall chips cut whole where the rail is short of room, and
 *     the shared loading line at its end; on a phone, the status line's words
 *     beside the line, in the band the frame lays over main's foot.
 *   - A phone (the Sheet's phone grid): no select column; the title held at
 *     the left on its row's own paper, behind a `border.strong` rule, and the
 *     header's other cells the window's snap points; the pinned column's
 *     segment of the group row on the paper behind the same rule, and each
 *     group's label held over its columns in view, clear of the pinned column.
 *
 * Every value is a semantic token, so the dark theme comes for free; the
 * renderer sets data attributes and geometry alone.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fontAwesomeSize } from "../icon-size.js";
import { FOOTER_FIT } from "./builder-footer.js";

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

/** A phone's pinned column's edge, down the group row, the header and the rows: the strong rule the window pages under. */
const PINNED_EDGE = { borderInlineEndWidth: "1px", borderInlineEndStyle: "solid", borderInlineEndColor: "border.strong" } as const;

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
        "footer", "footerCount", "footerNote", "footerSpacer", "footerLive", "legend", "legendItem", "legendChip", "legendName",
    ],
    base: {
        /* Main: the grid, then the strip, then the footer. */
        root: {
            display: "flex", flexDirection: "column", flex: "1 1 auto", height: "100%", minWidth: "0", minHeight: "0",
            fontFamily: "body", color: "fg", background: "bg.surface", isolation: "isolate",
        },
        /* The grid's own room: the Sheet's card scrolls its rows in it. */
        grid: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: "0", minWidth: "0" },

        /* The toolbar's lead: the title, then the count — on a phone's row, which pads none of its items, inset as the pager is. */
        title: { flex: "none", display: "flex", alignItems: "center", gap: "8px", "[data-builder-frame][data-phone] &": { paddingInlineStart: "16px" } },
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
        groupSeg: {
            minWidth: "0", display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingInline: "6px",
            /* A phone's pinned column's: at the left on the paper, behind its strong rule, as the columns page under it. */
            "&[data-pinned]": { ...PINNED_EDGE, position: "sticky", left: "0", zIndex: "2", background: "bg.surface" },
        },
        groupLabel: {
            textAlign: "center", fontFamily: "mono", fontSize: "label.xs", fontWeight: 600, letterSpacing: "label", textTransform: "uppercase",
            lineHeight: "18px", color: "fg.subtle", whiteSpace: "nowrap", overflow: "hidden",
            /* On a phone, centred over its group while it is all in view, and held over the part of it in view as the window pages:
               past the pinned column (`--record-pin`, the renderer's geometry) and the group's own inset. */
            "[data-phone] &": {
                alignSelf: "center", maxWidth: "100%", position: "sticky", left: "calc(var(--record-pin, 0px) + 6px)", right: "6px",
            },
        },
        groupRule: { height: "1px", background: "border.strong", "&[data-unlabelled]": { background: "transparent" } },
        headerRow: { display: "grid" },
        headerCell: {
            minWidth: "0", display: "flex", alignItems: "center", justifyContent: "flex-start", color: "fg.subtle", cursor: "default",
            ...CELL_PAD,
            /* The select column's box stays at the left as the columns scroll sideways under it. */
            "&[data-tick]": { cursor: "pointer", paddingInlineEnd: "12px", position: "sticky", left: "0", zIndex: "1", background: "bg.surface" },
            /* On a phone each column's start is a place the window comes to rest — past the pinned column, which stays at the left. */
            "[data-phone] &": { scrollSnapAlign: "start" },
            "&[data-pinned]": { ...PINNED_EDGE, position: "sticky", left: "0", zIndex: "2", background: "bg.surface", scrollSnapAlign: "none" },
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
            /* A phone's pinned title: at the left on its row's paper, whatever wash the row wears — its own states over it — above a ring
               a cell scrolled under it draws, behind its strong rule. */
            "&[data-pinned]": { ...PINNED_EDGE, position: "sticky", left: "0", zIndex: "5", background: "inherit" },
            "&[data-steps]": { cursor: "pointer", _hover: { background: "bg.subtle" } },
            "&[data-dirty]": { background: "brandTint", _hover: { background: "brandTint" } },
            "&[data-active]": { background: "bg.subtle", boxShadow: "{shadows.focusInset}", _hover: { background: "bg.subtle" } },
            "&[data-required]": { background: REQUIRED_WASH, _hover: { background: REQUIRED_WASH } },
            "&[data-still]": { cursor: "default", _hover: { background: "transparent" } },
            /* …but a still pinned cell keeps its row's paper under the pointer: the columns scroll under it. */
            "&[data-pinned][data-still]": { _hover: { background: "inherit" } },
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
        /* A cycle's or a toggle's chip: one width per column — its widest label, in characters, with its padding and edge, and no
           narrower than a digit's chip — so the states line up. */
        chip: {
            height: "22px", minWidth: "max(28px, calc(var(--record-chip-ch, 0) * 1ch + 14px))", boxSizing: "border-box", paddingInline: "6px", display: "inline-flex",
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
        /* An absent value, one line: in a narrow column its words end in an ellipsis, never cut off at the start of an age's end-aligned cell. */
        absent: { minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", textStyle: "absent", fontSize: "body", whiteSpace: "nowrap" },
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

        /* The footer: the rows shown, the stale count, and the legend, cut whole where it is short of room, then the loading line. */
        footer: {
            ...FOOTER_FIT,
            height: "36px", boxSizing: "border-box", flex: "none", display: "flex", alignItems: "center", gap: "16px", paddingInline: "20px",
            borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle", background: "bg.surface", overflow: "hidden",
            "& > [data-footer-line]": { marginInlineStart: "0" },
        },
        footerCount: {
            fontFamily: "mono", fontFeatureSettings: '"tnum" 1', fontSize: "label.md", color: "fg.muted", whiteSpace: "nowrap",
            "& b": { fontWeight: 600, color: "fg" },
        },
        footerNote: { fontFamily: "mono", fontFeatureSettings: '"tnum" 1', fontSize: "label.md", color: "fg.muted", whiteSpace: "nowrap" },
        footerSpacer: { flex: "1", minWidth: "0" },
        /* The status line's words on a phone, whose toolbar has no room for them: unseen and unheard on a wider frame, where
           the toolbar's line says them. */
        footerLive: {
            display: "none",
            "[data-phone] &": { display: "block", flex: "1 1 auto", minWidth: "0", fontFamily: "mono", fontSize: "label.lg", color: "fg.muted" },
        },
        legend: { flex: "none", display: "flex", alignItems: "center", gap: "16px" },
        legendItem: { display: "inline-flex", alignItems: "center", gap: "8px", whiteSpace: "nowrap" },
        /* A legend chip: as wide as a cell's chip is, at its own face. */
        legendChip: {
            height: "15px", minWidth: "max(20px, calc(var(--record-chip-ch, 0) * 1ch + 10px))", boxSizing: "border-box", paddingInline: "4px", display: "inline-flex",
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
