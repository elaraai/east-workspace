/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's own slots (`Allocation Spec.md` §8), built from the shared
 * builder parts — the footer rail, the inspector's status chip, the time
 * ruler's band and the now line — and the theme's tokens. The frame, the
 * toolbar, the panes and the session are the shared parts' and keep their own
 * recipes; this recipe owns only what is the board's.
 *
 * Sizes are the mock's, as it draws them (its labels the design system's
 * `label.*` sizes); the renderer passes only the indices its data gives —
 * a card's lane and grid row, a band's rows — as CSS variables.
 *
 * Slots:
 * - `root` — the board, filling its parent, no border.
 * - `main` — the main region's box.
 * - `status` — the day's status chip (`data-tone`).
 * - `pickerDot` — a day's mark in the date picker (`data-state`: `published`, `draft`, `empty`).
 * - `controls` — the controls the narrowest toolbar folds into one popover.
 * - `footer`, `footerItem` — the shared rail and its items.
 * - `legendItem`, `legendSwatch` — a legend entry and its swatch (`data-kind`).
 * - `error`, `empty` — a refused action's words, and an empty main.
 * - The Timeline (A14–A21): `timeline`; the panes' one head row, `head`, `headCaption`; the lane pane, `lanePane`,
 *   `laneContent`, `laneHead`, `laneHeadCell`, `laneName`, `laneOffset`, `laneMeta`, `laneGrid`, `laneBand`, `laneHour`,
 *   `laneCell`; a bin's card, `card`, `cardTop`, `cardCode`, `cardQty`, `cardLine`, `cardTo`, `cardMark`, and its
 *   connector, `connector`, `connectorMark`; the link channel, `channel`, `channelHead`; the resource pane,
 *   `resourcePane`, `resourceHead`, `resourceCaption`, `ruler` and the shared ruler's `rulerRow`, `rulerTick`,
 *   `rulerLabel`; a resource row, `resourceRow`, `resourceLabel`, `resourceText`, `resourceName`, `resourceLine`, and
 *   its plot, `plot`, `shade`, `weekRule`, `span`, `bar`, `barLabel`, `overlap`; the now line's `nowLine`, `nowDot`,
 *   `nowChip`; the toolbar's focus chip's ×, `focusClear`; the focus's links over the panes, `links` (A65–A68: Plan's
 *   look, a draft's in the brand, the selected one in the ink, its captions taking the pointer).
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fontAwesomeSize } from "../icon-size.js";
import { builderFooter, builderFooterItem } from "./builder-footer.js";
import { INSPECTOR_STATUS } from "./inspector.js";
import { linkRibbons } from "./links/ribbons.js";
import { planElementFocus, planRowFocus } from "./plan/focus.js";
import { nowBase, nowSlots } from "./time/now.js";
import { timeRulerBase } from "./time/axis.js";

/** A head's caption (`LANE`, `HOUR`, `WEEK`, `RESOURCE`, a week): mono 10 / 600, tracked 0.16em, uppercase, `--ink-4`. */
const headLabel = {
    fontFamily: "mono", fontSize: "label.sm", fontWeight: "semibold", letterSpacing: "wider2", textTransform: "uppercase",
    fontVariantNumeric: "tabular-nums", color: "fg.subtle", whiteSpace: "nowrap",
} as const;
/** A head block's two rows: 24px over its rule, then 23px. */
const headUpper = { height: "24px", flexShrink: 0, display: "flex", alignItems: "center", boxSizing: "border-box", borderBottomWidth: "1px", borderColor: "border.subtle" } as const;
const headLower = { height: "23px", flexShrink: 0, display: "flex", alignItems: "center" } as const;
/** A mark's icon, at the line's size. */
const markIcon = fontAwesomeSize("9.5px");

export const allocationBuilderSlotRecipe = defineSlotRecipe({
    className: "east-allocation-builder",
    slots: [
        "root", "main", "status", "pickerDot", "controls", "footer", "footerItem", "legendItem", "legendSwatch", "error", "empty",
        "timeline", "head", "headCaption", "lanePane", "laneContent", "laneHead", "laneHeadCell", "laneName", "laneOffset", "laneMeta",
        "laneGrid", "laneBand", "laneHour", "laneCell", "card", "cardTop", "cardCode", "cardQty", "cardLine", "cardTo", "cardMark",
        "connector", "connectorMark", "channel", "channelHead", "resourcePane", "resourceHead", "resourceCaption", "ruler",
        "rulerRow", "rulerTick", "rulerLabel", "resourceRow", "resourceLabel", "resourceText", "resourceName", "resourceLine",
        "plot", "shade", "weekRule", "span", "bar", "barLabel", "overlap", "focusClear", "links", ...nowSlots,
    ],
    base: {
        ...nowBase,
        root: { height: "100%", minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", background: "bg.surface", color: "fg" },
        main: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" },
        status: INSPECTOR_STATUS,
        // A day's mark under its number in the date picker: published, draft, or not started.
        pickerDot: {
            width: "6px", height: "6px", borderRadius: "50%", border: "1px solid", borderColor: "fg.subtle",
            "&[data-state=published]": { background: "fg.success", borderColor: "fg.success" },
            "&[data-state=draft]": { background: "brand.solid", borderColor: "brand.solid" },
        },
        controls: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 },
        footer: builderFooter,
        footerItem: builderFooterItem,
        legendItem: {
            display: "inline-flex", alignItems: "center", gap: "8px", flexShrink: 0,
            // Wrapped, an item wider than the rail wraps its own words (A79); the others keep theirs on one line.
            "[data-builder-narrow] > &": { flexShrink: 1, minWidth: 0, whiteSpace: "normal" },
        },
        // The mock's swatches, 16 × 10 (a link a 16 × 4 bar, a slot's status an 8px dot).
        legendSwatch: {
            width: "16px", height: "10px", flexShrink: 0, borderRadius: "sm", boxSizing: "border-box",
            "&[data-kind=bin]": { borderWidth: "1px", borderColor: "border.strong", background: "bg.surface" },
            "&[data-kind=draft]": { borderWidth: "1px", borderStyle: "dashed", borderColor: "brand.solid", background: "brandTint" },
            "&[data-kind=load]": { background: "brand.solid" },
            "&[data-kind=prior]": { borderWidth: "1px", borderColor: "border.strong", background: "bg.subtle" },
            "&[data-kind=next]": { borderWidth: "1px", borderStyle: "dashed", borderColor: "fg.subtle" },
            "&[data-kind=overlap]": { borderRadius: 0, borderLeftWidth: "1px", borderRightWidth: "1px", borderColor: "status.warn", background: "status.warnSubtle" },
            "&[data-kind=link]": { height: "4px", borderRadius: 0, background: "fg.muted" },
            "&[data-kind=draftLink]": { height: "4px", borderRadius: 0, background: "brand.solid" },
            "&[data-kind=empty]": { borderWidth: "1px", borderStyle: "dashed", borderColor: "border.strong" },
            "&[data-kind=reserved]": { width: "8px", height: "8px", borderRadius: "full", background: "brandMark" },
            "&[data-kind=free]": { width: "8px", height: "8px", borderRadius: "full", background: "fg.faint" },
        },
        error: { textStyle: "body.sm", color: "fg.danger", overflowWrap: "anywhere" },
        empty: { padding: "16px", textStyle: "body.sm", color: "fg.muted" },

        // ── The Timeline ── three panes side by side: the lane grid, the link channel, the resources.
        timeline: { position: "relative", flex: 1, minHeight: 0, minWidth: 0, display: "flex", overflow: "hidden", isolation: "isolate", background: "bg.surface" },
        // Each pane's head: one 48px row across the board, over its 1px rule; every block in it 47px, 24 + 23.
        head: {
            position: "sticky", top: 0, zIndex: 6, display: "flex", height: "48px", boxSizing: "border-box",
            borderBottomWidth: "1px", borderColor: "border.subtle", background: "bg.surface",
        },
        headCaption: {
            display: "flex", flexDirection: "column", flexShrink: 0,
            "& > span": headLabel, "& > span:first-of-type": headUpper, "& > span:last-of-type": headLower,
        },
        lanePane: {
            position: "relative", flex: "none", height: "100%", overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain",
            // Its scrollbar on the left, so the cards' right edge meets the link channel.
            direction: "rtl", scrollbarGutter: "stable", scrollSnapType: "y mandatory",
            // Rows snap under the pane's sticky head, never behind it.
            scrollPaddingTop: "48px",
            borderRightWidth: "1px", borderColor: "border.subtle",
        },
        laneContent: { position: "relative", direction: "ltr", width: "calc(48px + var(--allocation-lanes) * 96px)" },
        laneHead: {
            display: "grid", gridTemplateColumns: "48px repeat(var(--allocation-lanes), 96px)", gridTemplateRows: "47px",
            "& > [data-head-caption] > span": { justifyContent: "flex-end", paddingRight: "12px" },
        },
        laneHeadCell: {
            display: "flex", flexDirection: "column", minWidth: 0, borderLeftWidth: "1px", borderColor: "border.subtle",
        },
        laneName: {
            ...headUpper, gap: "8px", padding: "0 8px", whiteSpace: "nowrap",
            fontFamily: "mono", fontSize: "label.sm", fontWeight: "semibold", letterSpacing: "widest", fontVariantNumeric: "tabular-nums", color: "fg",
        },
        laneOffset: { fontWeight: "medium", letterSpacing: "normal", color: "fg.subtle" },
        laneMeta: {
            ...headLower, display: "block", minWidth: 0, padding: "0 4px", lineHeight: "23px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontFamily: "mono", fontSize: "label.xs", fontWeight: "medium", fontVariantNumeric: "tabular-nums", color: "fg.subtle",
        },
        laneGrid: { position: "relative", height: "calc(var(--allocation-rows) * 36px)" },
        // A slot index's band across the lanes: 36px a bin of its largest batch, its hour at the left.
        laneBand: {
            position: "absolute", left: 0, right: 0, top: "calc(var(--band-row) * 36px)", height: "calc(var(--band-span) * 36px)",
            boxSizing: "border-box", borderBottomWidth: "1px", borderColor: "border.subtle", pointerEvents: "none", scrollSnapAlign: "start",
        },
        laneHour: {
            position: "absolute", left: 0, top: "12px", width: "48px", boxSizing: "border-box", paddingRight: "12px", textAlign: "right", lineHeight: "12px",
            fontFamily: "mono", fontSize: "label.sm", fontWeight: "medium", fontVariantNumeric: "tabular-nums", color: "fg.subtle",
        },
        laneCell: {
            position: "absolute", left: "calc(48px + var(--cell-lane) * 96px)", top: "calc(var(--cell-row) * 36px)", width: "96px",
            height: "calc(var(--cell-span) * 36px)", boxSizing: "border-box", borderLeftWidth: "1px", borderColor: "border.subtle",
        },
        // A bin's card, 88 × 28 at its lane and grid row (A16).
        card: {
            position: "absolute", zIndex: 2, left: "calc(52px + var(--card-lane) * 96px)", top: "calc(4px + var(--card-row) * 36px)",
            width: "88px", height: "28px", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "center",
            padding: "0 8px", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "sm",
            background: "bg.surface", cursor: "pointer", textAlign: "left", outlineOffset: "4px",
            "&[data-draggable]": { cursor: "grab", touchAction: "none" },
            "&:hover": { background: "bg.canvas" },
            "&[data-reserved]": { borderStyle: "dashed", borderColor: "fg.subtle" },
            "&[data-draft]": { borderStyle: "dashed", borderColor: "brand.solid", background: "brandTint" },
            "&[data-selected]": { borderStyle: "solid", borderColor: "fg", background: "bg.subtle" },
            "&[data-selected][data-draft]": { borderStyle: "dashed" },
            // Outside the focus: the rule border and ink-4 words, unless the pointer is on it (A13).
            "&[data-dim]:not(:hover)": { borderColor: "border.subtle", background: "bg.surface" },
            // Hovered or selected, it rises over the link layer with its connector (A21).
            "&:hover, &[data-selected], &:focus-within": { zIndex: 6 },
            // A lit link's halo round its bin (A67): 1px of the strong ink, 4 outside it.
            "&[data-link-lit]": { outline: "1px solid", outlineColor: "fg.strong", outlineOffset: "4px" },
            ...planElementFocus,
        },
        cardTop: { display: "flex", alignItems: "baseline", gap: "4px", minWidth: 0, lineHeight: "12px" },
        cardCode: {
            flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontFamily: "mono", fontSize: "label.md", fontWeight: "semibold", color: "fg",
            "[data-reserved] &": { color: "fg.muted" },
            "[data-draft] &": { color: "brandPressed" },
            "[data-dim]:not(:hover) &": { color: "fg.subtle" },
        },
        cardQty: {
            flex: "none", whiteSpace: "nowrap", fontFamily: "mono", fontSize: "label.md", fontWeight: "medium", fontVariantNumeric: "tabular-nums",
            color: "fg.strong", "[data-dim]:not(:hover) &": { color: "fg.subtle" },
        },
        cardLine: { display: "flex", alignItems: "center", gap: "4px", minWidth: 0, lineHeight: "12px" },
        cardTo: {
            flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontFamily: "mono", fontSize: "label.xs", fontVariantNumeric: "tabular-nums", color: "fg.subtle",
            "& > svg, & > [data-icon]": { ...markIcon, display: "inline-block", verticalAlign: "-1px", marginRight: "4px" },
            "& [data-unlinked]": { fontStyle: "italic", fontWeight: "normal" },
        },
        // A card's marks (A16): the app's flags, ⚠ overlap, ● over max, ↓ under min.
        cardMark: {
            ...markIcon, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
            "&[data-mark=overlap], &[data-mark=under]": { color: "status.warn" },
            "&[data-mark=over]": { color: "status.neg" },
            "&[data-mark=flag]": { width: "auto", height: "auto", fontFamily: "mono", fontSize: "label.xs", fontWeight: "semibold", lineHeight: "12px", color: "fg.warning", whiteSpace: "nowrap" },
        },
        // The connector: a 22px target on the card's right edge, centred where the link leaves; shown hovered or selected (A21).
        connector: {
            position: "absolute", right: "-12px", top: "2px", zIndex: 3, width: "22px", height: "22px", display: "none", placeItems: "center",
            padding: 0, cursor: "crosshair", touchAction: "none", background: "transparent",
            "[data-allocation-card]:hover > &": { display: "grid" },
            "[data-allocation-card][data-selected] > &": { display: "grid" },
            "&:focus-visible": { display: "grid" },
            ...planElementFocus,
        },
        // Inside it a 10px square in a 1.5px paper ring: filled linked, hollow not linked.
        connectorMark: {
            width: "10px", height: "10px", boxSizing: "border-box", borderWidth: "1.5px", borderStyle: "solid", borderRadius: 0,
            borderColor: "fg.muted", background: "fg.muted", boxShadow: "0 0 0 1.5px {colors.bg.surface}",
            "&[data-state=unlinked]": { borderColor: "status.warn", background: "bg.surface" },
            "&[data-state=draft]": { borderColor: "brand.solid", background: "brand.solid" },
            "[data-dim]:not(:hover) &": { borderColor: "fg.faint", background: "fg.faint", "&[data-state=unlinked]": { background: "bg.surface" } },
        },
        // The link channel, 48px of paper-2 from the head to the bottom.
        channel: {
            flex: "none", width: "48px", height: "100%", boxSizing: "border-box", borderRightWidth: "1px", borderColor: "border.subtle", background: "bg.canvas",
            display: "flex", flexDirection: "column",
        },
        channelHead: {
            flexShrink: 0, height: "48px", boxSizing: "border-box", display: "flex", flexDirection: "column",
            borderBottomWidth: "1px", borderColor: "border.subtle",
            "& > span:first-of-type": headUpper,
            "& > span:last-of-type": { ...headLower, justifyContent: "center", color: "fg.subtle", "& svg": fontAwesomeSize("10px") },
        },
        resourcePane: {
            position: "relative", flex: 1, minWidth: 0, height: "100%", overflow: "auto", overscrollBehavior: "contain", scrollSnapType: "y mandatory", scrollPaddingTop: "48px",
            // A scroll the board makes to a row lands on it before the rows there are mounted: no snap until they are.
            "&[data-snap-suspended]": { scrollSnapType: "none" },
        },
        resourceHead: {
            "& > [data-head-caption]": {
                position: "sticky", left: 0, zIndex: 2, width: "152px", boxSizing: "border-box", background: "bg.surface",
                borderRightWidth: "1px", borderColor: "border.subtle", "& > span": { padding: "0 12px 0 20px" },
            },
        },
        // The ruler over the plot: the weeks over the days, on the plot's own scale.
        ruler: { position: "relative", flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
        rulerRow: {
            ...timeRulerBase.rulerRow,
            "&[data-time-ruler=units]": { height: "24px", boxSizing: "border-box", borderBottomWidth: "1px" },
            "&[data-time-ruler=ticks]": { height: "23px", borderBottomWidth: 0 },
        },
        rulerTick: {
            ...timeRulerBase.rulerTick, fontWeight: "medium", textTransform: "none", color: "fg.subtle", borderLeftWidth: 0,
            "[data-time-ruler=units] > &": {
                ...headLabel, justifyContent: "flex-start", padding: "0 12px", overflow: "hidden", borderLeftWidth: "1px", borderColor: "border.subtle",
            },
            // The focus's hold, in ink (A13).
            "&[data-marked]": { color: "fg", fontWeight: "semibold" },
            // The plan day: its tick on a 16px brand badge.
            "&[data-now] > [data-tick-label]": {
                height: "16px", display: "inline-flex", alignItems: "center", padding: "0 4px", borderRadius: "sm",
                background: "brand.solid", color: "bg.surface", fontWeight: "semibold", lineHeight: 1,
            },
        },
        rulerLabel: { ...timeRulerBase.rulerLabel, padding: 0, background: "transparent" },
        // A resource row, 36px (A18–A20).
        resourceRow: {
            position: "relative", display: "flex", height: "36px", boxSizing: "border-box", borderBottomWidth: "1px", borderColor: "border.subtle",
            cursor: "pointer", scrollSnapAlign: "start", background: "bg.surface",
            "&:hover": { background: "bg.canvas" },
            "&[data-selected]": { background: "bg.subtle" },
            ...planRowFocus,
        },
        resourceLabel: {
            position: "sticky", left: 0, zIndex: 3, flex: "none", width: "152px", boxSizing: "border-box", display: "flex", alignItems: "center",
            gap: "8px", padding: "0 12px 0 20px", background: "inherit", borderRightWidth: "1px", borderColor: "border.subtle",
        },
        resourceText: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" },
        resourceName: {
            fontFamily: "mono", fontSize: "label.lg", fontWeight: "semibold", lineHeight: "14px", color: "fg",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        },
        // Its line: ink-4; neg-text over max, warn-text overlapping or under min, both 600 (A19).
        resourceLine: {
            fontFamily: "mono", fontSize: "label.xs", fontWeight: "medium", lineHeight: "12px", fontVariantNumeric: "tabular-nums", color: "fg.subtle",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            "&[data-tone=danger]": { color: "fg.danger", fontWeight: "semibold" },
            "&[data-tone=warning]": { color: "fg.warning", fontWeight: "semibold" },
        },
        plot: { position: "relative", flex: 1, minWidth: 0 },
        shade: { position: "absolute", top: 0, bottom: 0, background: "bg.canvas", pointerEvents: "none" },
        weekRule: { position: "absolute", top: 0, bottom: 0, width: "1px", background: "border.subtle", pointerEvents: "none" },
        // The focus's hold, banded across the plot (A13).
        span: { position: "absolute", top: 0, bottom: 0, background: "brandTint", opacity: 0.7, pointerEvents: "none" },
        // A row's bars, top 8px, 20px tall (A20).
        bar: {
            position: "absolute", top: "8px", height: "20px", boxSizing: "border-box", display: "flex", alignItems: "center", overflow: "hidden",
            borderRadius: "sm", pointerEvents: "none",
            "&[data-kind=prior]": { zIndex: 1, background: "bg.subtle", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong" },
            "&[data-kind=next]": { zIndex: 1, borderWidth: "1px", borderStyle: "dashed", borderColor: "fg.subtle" },
            "&[data-kind=load]": { zIndex: 2, background: "brand.solid" },
            "&[data-kind=load][data-draft]": { background: "brandTint", borderWidth: "1px", borderStyle: "dashed", borderColor: "brand.solid" },
            "&[data-kind=load][data-over]": { borderWidth: "1px", borderStyle: "solid", borderColor: "status.neg" },
            "&[data-kind=load][data-focus]": { outline: "2px solid", outlineColor: "fg", outlineOffset: "1px" },
            // A lit link's halo round its resource's load (A67).
            "&[data-kind=load][data-link-lit]": { outline: "1px solid", outlineColor: "fg.strong", outlineOffset: "4px" },
        },
        barLabel: {
            padding: "0 8px", fontFamily: "mono", fontSize: "label.sm", fontWeight: "semibold", lineHeight: "18px", fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap", color: "fg.muted",
            "[data-kind=next] > &": { color: "fg.subtle" },
            "[data-kind=load] > &": { color: "bg.surface" },
            "[data-kind=load][data-draft] > &": { color: "brandPressed" },
        },
        // A hold running into the next job: the warn wash, its sides ruled, the full row high.
        overlap: {
            position: "absolute", top: 0, bottom: 0, zIndex: 0, boxSizing: "border-box", background: "status.warnSubtle",
            borderLeftWidth: "1px", borderRightWidth: "1px", borderColor: "status.warn", pointerEvents: "none",
        },
        // The focus's links (§11), from the cards through the channel to each row's leading edge, over the panes' rows.
        links: {
            // As wide as the board: the links keep to their bounds, and a selected caption's × may overhang the resource rows' edge, as the mock's does.
            ...linkRibbons, position: "absolute", left: 0, right: 0, top: "48px", zIndex: 5, overflow: "hidden", pointerEvents: "none",
            // A draft link is the brand's; a lit one the brand's darker step.
            "& [data-tone=draft] [data-plan-ribbon-band]": { stroke: "brand.solid" },
            "& [data-tone=draft] [data-plan-ribbon-head]": { fill: "brand.solid" },
            "& [data-tone=draft][data-lit] [data-plan-ribbon-band]": { stroke: "brandPressed" },
            "& [data-tone=draft][data-lit] [data-plan-ribbon-head]": { fill: "brandPressed" },
            // The selected link, in the ink (A68).
            "& [data-plan-link][data-selected] [data-plan-ribbon-band]": { stroke: "fg" },
            "& [data-plan-link][data-selected] [data-plan-ribbon-head]": { fill: "fg" },
            // A caption takes the pointer as its line does, in the strong ink while lit.
            "& [data-plan-ribbon-label]": { pointerEvents: "auto", cursor: "pointer" },
            "& [data-plan-ribbon-label][data-lit] [data-plan-ribbon-caption]": { fill: "fg.strong" },
            "& [data-link]": { ...linkRibbons["& [data-link]"], pointerEvents: "stroke" },
        },
        // The focus chip's ×, a 16px target (A81).
        focusClear: {
            width: "16px", height: "16px", display: "grid", placeItems: "center", padding: 0, borderRadius: "sm", color: "inherit", cursor: "pointer",
            "&:hover": { background: "bg.surface" }, "& svg": fontAwesomeSize("10px"), ...planElementFocus,
        },
    },
});
