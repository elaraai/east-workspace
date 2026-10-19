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
 * - `error`, `empty` — a refused action's words, and an empty main; `narrowedEmpty` — the shared empty state where the
 *   narrowing leaves nothing to show (#1336).
 * - The Timeline (A14–A21): `timeline`; the panes' one head row, `head`, `headCaption`; the lane pane, `lanePane`,
 *   `laneContent`, `laneHead`, `laneHeadCell`, `laneName`, `laneOffset`, `laneMeta`, `laneGrid`, `laneBand`, `laneHour`,
 *   `laneCell`; a bin's card, `card`, `cardTop`, `cardCode`, `cardQty`, `cardLine`, `cardTo`, `cardMark`, and its
 *   connector, `connector`, `connectorMark`; the link channel, `channel`, `channelHead`; the resource pane,
 *   `resourcePane`, `resourceHead`, `resourceCaption`, `ruler` and the shared ruler's `rulerRow`, `rulerTick`,
 *   `rulerLabel`; a resource row, `resourceRow`, `resourceLabel`, `resourceText`, `resourceName`, `resourceLine`, and
 *   its plot, `plot`, `shade`, `weekRule`, `span`, `bar`, `barLabel`, `overlap`; the now line's `nowLine`, `nowDot`,
 *   `nowChip`; the toolbar's focus chip's ×, `focusClear`; the focus's links over the panes, `links` (A65–A68: Plan's
 *   look, a draft's in the brand, the selected one in the ink, its captions taking the pointer; during a drag, the drag's
 *   families, a link into the target ink-2 where the drop fits and warn where it refuses, and nothing of them taking the
 *   pointer, A65, A69), each link's line and caption a grip (`data-allocation-grip`); and what follows the pointer during
 *   a drag, `linkLines` (a link drag's new line over the cards, A69; an event's lines into its best fits, A30).
 * - The drags (A24–A35, #1328): a free lane hour's target during a body's drag, `lanePlaceholder`; a ranked fit's
 *   badge, `rank`; a row's reason, `reason`; a refusing run's label, `runLabel`, `runMeta`; the fits marker,
 *   `fitsMarker`; and the shared move ghost's `moveGhost`, `moveGhostLabel`, `moveGhostSpan`. The board draws its
 *   own drop stages, as the mock does: the shared frames and washes are off on its targets.
 * - The Table (A41–A49, #1329): `table`, its scroll pane `tablePane`, its column heads `tableHead`; a band, the shared
 *   group band's `group`, `groupContent`, `groupLabel`, `groupMeta`, with its row count `bandCount`; a row,
 *   `tableRow`, its `tableTime`, `tableLane`, `tableCell` (a placeholder spanning the event's columns `tableSpan`, or
 *   the resource's and its load's `tableResourceSpan`), `tableUnits`, `tableValue`, `tableLoad`, `tableStatus` and its
 *   `tableStatusDot`; a chip, `tableChip`, `tableChipIcon`, `tableChipCode`, `tableChipMeta`, `tableChipButton`; and a
 *   dashed placeholder, `tablePlaceholder`, `tablePlaceholderText`; during a drag or a pick a cell says what a drop does
 *   (`data-verdict`: `fits`, `refused`, `pick`, A45), a resource card's drag on its resource cells too (A32).
 * - The Library (A50–A54, #1330): the shared pane part's `pane`, `paneFoot`, `paneHint` and `paneAction`; its cards are the
 *   shared Library's. A picked event marks the Timeline's free lane hours (`data-allocation-pick`, A11); a resource card's drag
 *   marks the bins that refuse it (`data-refuses`) and, when it would not take a reservation, the free lane hours (A32).
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fontAwesomeSize } from "../icon-size.js";
import { builderFooter, builderFooterItem } from "./builder-footer.js";
import { INSPECTOR_STATUS } from "./inspector.js";
import { linkRibbons } from "./links/ribbons.js";
import { planElementFocus, planRowFocus } from "./plan/focus.js";
import { moveGhostBase, moveGhostSlots } from "./time/move-ghost.js";
import { nowBase, nowSlots } from "./time/now.js";
import { scheduleGroupBase, scheduleGroupSlots } from "./schedule-group.js";
import { schedulePaneBase, schedulePaneSlots } from "./schedule-pane.js";
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
/** The shared drop stages' frames, washes and ⊘ badge, off on a target: the board draws its own (A29, A32), as the mock does. */
const ownStages = {
    "&[data-drag-cell][data-drop-valid]::before": { content: "none" },
    "&[data-drag-cell][data-drop-active]::before": { content: "none" },
    "&[data-drag-cell][data-drop-invalid]::before": { content: "none" },
    "&[data-drag-cell][data-drop-invalid]::after": { content: "none" },
    "&[data-drag-cell][data-drop-invalid]": { cursor: "no-drop" },
} as const;
/** A refusal's wash: warn at 6% on the paper, opaque so a sticky label over it hides what scrolls under it (A29). */
const warnWash = "color-mix(in oklch, {colors.status.warn} 6%, {colors.bg.surface})";
/** A row that refuses the drag recedes, unless the pointer is on it (A27). */
const receded = "[data-refused]:not([data-drop-invalid]) &";
/** The Table's columns: Time · Lane · Event · Quantity · the app's columns (72px each) · Resource · Load · Status (A43). */
const tableColumns = {
    display: "grid", gridTemplateColumns: "84px 64px minmax(200px, 1.3fr) 64px repeat(var(--allocation-columns), 72px) minmax(176px, 1fr) 144px 128px",
    "&[data-columns=none]": { gridTemplateColumns: "84px 64px minmax(200px, 1.3fr) 64px minmax(176px, 1fr) 144px 128px" },
} as const;
/** A Table cell's text: mono, one line, cut with an ellipsis. */
const tableText = { fontFamily: "mono", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 } as const;

export const allocationBuilderSlotRecipe = defineSlotRecipe({
    className: "east-allocation-builder",
    slots: [
        "root", "main", "status", "pickerDot", "controls", "footer", "footerItem", "legendItem", "legendSwatch", "error", "empty", "narrowedEmpty",
        "timeline", "head", "headCaption", "lanePane", "laneContent", "laneHead", "laneHeadCell", "laneName", "laneOffset", "laneMeta",
        "laneGrid", "laneBand", "laneHour", "laneCell", "card", "cardTop", "cardCode", "cardQty", "cardLine", "cardTo", "cardMark",
        "connector", "connectorMark", "channel", "channelHead", "resourcePane", "resourceHead", "resourceCaption", "ruler",
        "rulerRow", "rulerTick", "rulerLabel", "resourceRow", "resourceLabel", "resourceText", "resourceName", "resourceLine",
        "plot", "shade", "weekRule", "span", "bar", "barLabel", "overlap", "focusClear", "links", "linkLines", ...nowSlots,
        "lanePlaceholder", "rank", "reason", "runLabel", "runMeta", "fitsMarker", ...moveGhostSlots,
        ...scheduleGroupSlots, ...schedulePaneSlots, "bandCount", "table", "tablePane", "tableHead", "tableRow", "tableTime", "tableLane", "tableCell", "tableSpan",
        "tableResourceSpan", "tableUnits", "tableValue", "tableLoad", "tableStatus", "tableStatusDot", "tableChip", "tableChipIcon", "tableChipCode",
        "tableChipMeta", "tableChipButton", "tablePlaceholder", "tablePlaceholderText",
    ],
    base: {
        ...nowBase,
        ...moveGhostBase,
        ...scheduleGroupBase,
        ...schedulePaneBase,
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
        // The narrowing left nothing to show: the shared empty state, at the top of the area it empties.
        narrowedEmpty: { flex: 1, minHeight: 0, minWidth: 0, display: "flex", alignItems: "flex-start", justifyContent: "center", overflow: "auto", paddingTop: "24px", background: "bg.surface" },

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
            ...ownStages, "&[data-drag-cell][data-drop-active]": { background: "transparent" },
        },
        // During a body's, a Library card's or a resource card's drag every free lane hour is a dashed target, 4px in; the one under the
        // pointer brand-tint (A24, A32); a picked event's in the brand (A11); a resource that would not take a reservation's in warn (A32).
        lanePlaceholder: {
            display: "none", position: "absolute", inset: "4px", boxSizing: "border-box", borderWidth: "1px", borderStyle: "dashed",
            borderColor: "border.strong", borderRadius: "sm", pointerEvents: "none",
            "[data-allocation-drag=body] &, [data-allocation-drag=event] &, [data-allocation-drag=removed] &, [data-allocation-drag=resource] &": { display: "block" },
            "[data-allocation-pick] &": { display: "block", borderColor: "brand.solid" },
            "[data-allocation-drag=resource][data-reserve=refused] &": { borderColor: "status.warn", background: warnWash },
            "[data-drop-active] > &": { borderColor: "brand.solid", background: "brandTint" },
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
            ...ownStages,
            // Its body dragged, the card it leaves is a dashed brand hole (A24).
            "&[data-dragging]": { borderStyle: "dashed", borderColor: "brand.solid", background: "transparent" },
            // A body's drop on it: its slot, or the reservation it fills (A37, A38).
            "&[data-drag-cell][data-drop-active]": { borderStyle: "dashed", borderColor: "brand.solid", background: "brandTint" },
            "&[data-drag-cell][data-drop-invalid]": { borderColor: "status.warn", background: warnWash },
            // Its resource's row under a connector's or a link's drag: ink-3 when the drop fits, warn when it refuses (A29) —
            // over the focus's dimming too.
            "&[data-drop-target=fits]": { borderColor: "fg.muted" },
            "&[data-drop-target=refused]": { borderStyle: "solid", borderColor: "status.warn", background: warnWash },
            "&[data-dim][data-drop-target=fits]": { borderColor: "fg.muted" },
            "&[data-dim][data-drop-target=refused]": { borderColor: "status.warn", background: warnWash },
            // A resource card's drag: every bin that refuses it in warn on the warn wash (A32); the one under the pointer as a drop's.
            "&[data-refuses]": { borderStyle: "solid", borderColor: "status.warn", background: warnWash },
            "&[data-dim][data-refuses]": { borderColor: "status.warn", background: warnWash },
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
            ...ownStages,
            // Under the pointer during a drag: brand-tint when it fits, warn 6% when it refuses (A29).
            "&[data-drag-cell][data-drop-active]": { background: "brandTint" },
            "&[data-drag-cell][data-drop-invalid]": { background: warnWash },
        },
        resourceLabel: {
            position: "sticky", left: 0, zIndex: 3, flex: "none", width: "152px", boxSizing: "border-box", display: "flex", alignItems: "center",
            gap: "8px", padding: "0 12px 0 20px", background: "inherit", borderRightWidth: "1px", borderColor: "border.subtle",
        },
        resourceText: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" },
        resourceName: {
            fontFamily: "mono", fontSize: "label.lg", fontWeight: "semibold", lineHeight: "14px", color: "fg",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            [receded]: { color: "fg.subtle" },
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
            // A ranked fit's preview of the hold: brand-tint, dashed (A28).
            "&[data-kind=preview]": { zIndex: 3, background: "brandTint", borderWidth: "1px", borderStyle: "dashed", borderColor: "brand.solid" },
            // Receded (A27): the load on paper-3, the jobs on paper-2 and the rules.
            [receded]: {
                "&[data-kind=load]": { background: "bg.subtle", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong" },
                "&[data-kind=load][data-over]": { borderColor: "status.neg" },
                "&[data-kind=prior]": { background: "bg.canvas", borderColor: "border.subtle" },
                "&[data-kind=next]": { borderColor: "border.strong" },
            },
            // What a refusal is about — the load over max, the job in the way — outlined in warn (A27).
            "&[data-refusal]": { outline: "1px solid", outlineColor: "status.warn", outlineOffset: "2px" },
        },
        barLabel: {
            padding: "0 8px", fontFamily: "mono", fontSize: "label.sm", fontWeight: "semibold", lineHeight: "18px", fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap", color: "fg.muted",
            "[data-kind=next] > &": { color: "fg.subtle" },
            "[data-kind=load] > &": { color: "bg.surface" },
            "[data-kind=load][data-draft] > &": { color: "brandPressed" },
            "[data-kind=preview] > &": { color: "brandPressed" },
            // Receded, the load's figure in ink-4 and the jobs' names gone (A27).
            [receded]: {
                "[data-kind=load] > &": { color: "fg.subtle" },
                "[data-kind=prior] > &": { visibility: "hidden" },
                "[data-kind=next] > &": { visibility: "hidden" },
            },
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
            // During a drag, a link into the resource the drag rests on: ink-2 where the drop fits, warn where it refuses (A65).
            "& [data-tone=fits] [data-plan-ribbon-band]": { stroke: "fg.strong" },
            "& [data-tone=fits] [data-plan-ribbon-head]": { fill: "fg.strong" },
            "& [data-tone=refused] [data-plan-ribbon-band]": { stroke: "status.warn" },
            "& [data-tone=refused] [data-plan-ribbon-head]": { fill: "status.warn" },
            // The selected link, in the ink, at rest (A68); during a drag its caption keeps its outline alone.
            "[data-allocation-timeline]:not([data-allocation-drag]) > &": {
                "& [data-plan-link][data-selected] [data-plan-ribbon-band]": { stroke: "fg" },
                "& [data-plan-link][data-selected] [data-plan-ribbon-head]": { fill: "fg" },
            },
            // A caption takes the pointer as its line does, in the strong ink while lit; a grip, a hand to pick it up (A69).
            "& [data-plan-ribbon-label]": { pointerEvents: "auto", cursor: "pointer" },
            "& [data-plan-ribbon-label][data-allocation-grip]": { cursor: "grab", touchAction: "none" },
            "& [data-plan-ribbon-label][data-lit] [data-plan-ribbon-caption]": { fill: "fg.strong" },
            "& [data-link]": { ...linkRibbons["& [data-link]"], pointerEvents: "stroke" },
            "& [data-link][data-allocation-grip]": { touchAction: "none" },
            // Keyboard focus: a caption's knockout ringed in the focus ink; a reservation's line, which has no caption, in it.
            "& [data-plan-ribbon-label]:focus-visible, & [data-link]:focus-visible": { outline: "none" },
            "& [data-plan-ribbon-label]:focus-visible [data-plan-ribbon-knockout]": { stroke: "border.focus", strokeWidth: "2px" },
            "& [data-plan-link]:has(> [data-link]:focus-visible) [data-plan-ribbon-band]": { stroke: "border.focus" },
            // During a drag nothing of a link takes the pointer: what lies under it is the drop's target (A26).
            "[data-allocation-drag] > &": { "& [data-link], & [data-plan-ribbon-label]": { pointerEvents: "none" } },
        },
        // What follows the pointer during a drag (A69, A30), over the links: an event's lines into its best fits among them, as the
        // mock draws them, a link's or a connector's new line over the cards too, as the mock's own layer does.
        linkLines: {
            ...linkRibbons, position: "absolute", left: 0, right: 0, top: "48px", zIndex: 5, overflow: "hidden", pointerEvents: "none",
            "[data-allocation-drag=link] > &, [data-allocation-drag=port] > &": { zIndex: 7 },
        },
        // A ranked fit's badge, #1 #2 #3 before its name (A28).
        rank: {
            display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", minWidth: "16px", height: "16px", boxSizing: "border-box",
            padding: "0 4px", borderRadius: "sm", background: "brand.solid",
            fontFamily: "mono", fontSize: "label.sm", fontWeight: "semibold", fontVariantNumeric: "tabular-nums", color: "bg.surface",
        },
        // A row's reason at the plot's right: a ranked fit's always, any row's under the pointer (A29).
        reason: {
            display: "none", position: "absolute", right: "22px", top: "10px", zIndex: 5, padding: "0 4px", borderRadius: "sm", background: "bg.surface",
            fontFamily: "mono", fontSize: "label.xs", fontWeight: "semibold", lineHeight: "16px", fontVariantNumeric: "tabular-nums", color: "fg.strong",
            whiteSpace: "nowrap", pointerEvents: "none",
            "&[data-refused]": { color: "fg.warning" },
            "& svg": fontAwesomeSize("9.5px"),
            "[data-ranked] &": { display: "block" },
            "[data-drop-active] &": { display: "block" },
            "[data-drop-invalid] &": { display: "block" },
        },
        // A refusing run's label, over its rows at the plot's right; it steps aside while the pointer is in the run (A27).
        runLabel: {
            position: "absolute", right: "22px", zIndex: 5, height: "20px", display: "inline-flex", alignItems: "center", gap: "8px", padding: "0 8px",
            boxSizing: "border-box", borderWidth: "1px", borderStyle: "solid", borderColor: "status.warn", borderRadius: "sm", background: "bg.surface",
            fontFamily: "mono", fontSize: "label.sm", fontWeight: "semibold", fontVariantNumeric: "tabular-nums", color: "fg.warning",
            whiteSpace: "nowrap", pointerEvents: "none",
            "& svg": fontAwesomeSize("10px"),
            "&[data-pointer]": { visibility: "hidden" },
        },
        runMeta: { fontWeight: "medium", color: "fg.muted" },
        // The fits marker at the pane's edge, 12px in from the plot's start: a drop on it goes to the #1 (A31).
        fitsMarker: {
            position: "absolute", left: "calc(152px + 12px)", zIndex: 8, height: "28px", display: "inline-flex", alignItems: "center", gap: "8px",
            padding: "0 12px", boxSizing: "border-box", borderWidth: "1px", borderStyle: "dashed", borderColor: "brand.solid", borderRadius: "md",
            background: "bg.surface", fontFamily: "mono", fontSize: "label.md", fontWeight: "semibold", fontVariantNumeric: "tabular-nums",
            color: "brandPressed", whiteSpace: "nowrap", pointerEvents: "auto",
            "& svg": fontAwesomeSize("10.5px"),
            ...ownStages,
            "&[data-drag-cell][data-drop-active]": { background: "brandTint" },
            "&[data-drag-cell][data-drop-invalid]": { borderColor: "status.warn", background: warnWash },
        },
        // ── The Table ── at least 900px wide, scrolling inside main; the bands are the shared group band's.
        table: { position: "relative", flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: "bg.surface" },
        tablePane: { flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", overscrollBehavior: "contain" },
        bandCount: {
            display: "inline-flex", alignItems: "center", height: "16px", padding: "0 4px", borderRadius: "sm", background: "bg.subtle",
            fontFamily: "mono", fontSize: "label.sm", fontWeight: "semibold", fontVariantNumeric: "tabular-nums", color: "fg.strong",
        },
        // The column heads: 36px, mono 10px 600 uppercase, tracked, ink-4, over a rule.
        tableHead: {
            ...tableColumns, alignItems: "center", height: "36px", boxSizing: "border-box", borderBottomWidth: "1px", borderColor: "border.subtle", background: "bg.surface",
            fontFamily: "mono", fontSize: "label.sm", fontWeight: "semibold", letterSpacing: "label", textTransform: "uppercase", color: "fg.subtle",
            // A heading longer than its column — the app's own words (#1338) — ends in an ellipsis, its title the whole.
            "& > span": { padding: "0 12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
            "& > span:first-of-type": { paddingLeft: "20px" },
            "& > span:last-of-type": { paddingRight: "20px" },
            "& > [data-align=end]": { textAlign: "right" },
        },
        // A row, 36px over its rule: paper-2 under the pointer, paper-3 selected (A44).
        tableRow: {
            ...tableColumns, alignItems: "center", height: "36px", boxSizing: "border-box", borderBottomWidth: "1px", borderColor: "border.subtle",
            background: "bg.surface", cursor: "default",
            "&:hover": { background: "bg.canvas" },
            "&[data-selected]": { background: "bg.subtle" },
        },
        tableTime: { ...tableText, padding: "0 12px 0 20px", fontSize: "label.lg", fontWeight: "medium", color: "fg.muted", "&[data-holds]": { color: "fg" } },
        tableLane: { ...tableText, padding: "0 12px", fontSize: "label.md", fontWeight: "medium", color: "fg.muted" },
        tableCell: { minWidth: 0, height: "28px", padding: "0 12px", display: "flex", alignItems: "center", ...ownStages,
            "&[data-drag-cell][data-drop-active]": { background: "transparent" }, "&[data-drag-cell][data-drop-invalid]": { background: "transparent" } },
        tableSpan: { gridColumn: "span var(--allocation-event-span)" },
        tableResourceSpan: { gridColumn: "span 2" },
        tableUnits: { ...tableText, padding: "0 12px", textAlign: "right", fontSize: "label.lg", fontWeight: "medium", color: "fg" },
        // The app's column: its tone in warn-text 600 (A43).
        tableValue: { ...tableText, padding: "0 12px", fontSize: "label.lg", fontWeight: "medium", color: "fg", "&[data-tone=warning]": { color: "fg.warning", fontWeight: "semibold" } },
        // The load line, ink-2 500; neg-text over max, warn-text overlapping or under min, both 600 (A43, A19).
        tableLoad: {
            ...tableText, padding: "0 12px", display: "flex", alignItems: "center", gap: "4px", fontSize: "label.md", fontWeight: "medium", color: "fg.strong",
            "& > span:first-of-type": { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
            "&[data-tone=danger]": { color: "fg.danger", fontWeight: "semibold" },
            "&[data-tone=warning]": { color: "fg.warning", fontWeight: "semibold" },
        },
        // The status: an 8px dot and the word, mono 10.5px 600 uppercase, ink-3.
        tableStatus: {
            ...tableText, padding: "0 20px 0 12px", display: "flex", alignItems: "center", gap: "8px",
            fontSize: "label.md", fontWeight: "semibold", letterSpacing: "caps", textTransform: "uppercase", color: "fg.muted",
        },
        tableStatusDot: {
            flex: "none", width: "8px", height: "8px", borderRadius: "full", background: "fg.faint",
            "[data-status='Not linked'] > &": { background: "status.warn" },
            "[data-status=Check] > &": { background: "status.warn" },
            "[data-status=Draft] > &": { background: "fg.subtle" },
            "[data-status=Reserved] > &": { background: "brandMark" },
            "[data-status=Committed] > &": { background: "status.pos" },
        },
        // A chip, 28px on the rule-strong border: a draft dashed in the brand on brand-tint; dragged, a dashed hole (A16).
        tableChip: {
            flex: 1, minWidth: 0, height: "28px", boxSizing: "border-box", display: "flex", alignItems: "center", gap: "8px", padding: "0 4px 0 8px",
            borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "sm", background: "bg.surface",
            "&[data-draggable]": { cursor: "grab", touchAction: "none" },
            "&[data-draft]": { borderStyle: "dashed", borderColor: "brand.solid", background: "brandTint" },
            "&[data-dragging]": { borderStyle: "dashed", borderColor: "brand.solid", background: "transparent" },
            // A resource card's drag over a row's resource (A32): dashed in the brand when it takes it, warn when it refuses it.
            "&[data-verdict=fits]": { borderStyle: "dashed", borderColor: "brand.solid" },
            "&[data-verdict=refused]": { borderColor: "status.warn", background: warnWash },
            "[data-drop-active] > &": { borderStyle: "dashed", borderColor: "brand.solid", background: "brandTint" },
            ...planElementFocus,
        },
        tableChipIcon: {
            ...fontAwesomeSize("9.5px"), flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "fg.subtle",
            "&[data-icon-role=chevron]": { ...fontAwesomeSize("10px"), width: "20px", color: "fg.muted" },
            "[data-allocation-placeholder] > &": { ...fontAwesomeSize("10px"), "&[data-icon-role=refused]": { display: "none" } },
            "[data-allocation-cell-side][data-drop-invalid] > [data-allocation-placeholder] > &, [data-allocation-placeholder][data-verdict=refused] > &": {
                "&[data-icon-role=idle]": { display: "none" }, "&[data-icon-role=refused]": { display: "inline-flex", color: "fg.warning" },
            },
        },
        tableChipCode: { ...tableText, flex: "none", maxWidth: "60%", fontSize: "label.lg", fontWeight: "semibold", color: "fg", "[data-draft] > &": { color: "brandPressed" } },
        tableChipMeta: { ...tableText, flex: 1, fontSize: "label.sm", fontWeight: "normal", color: "fg.subtle" },
        // A chip's chevron and ×: 20px targets, ink-3.
        tableChipButton: {
            flex: "none", width: "20px", height: "20px", display: "grid", placeItems: "center", padding: 0, marginLeft: "auto", borderRadius: "sm",
            background: "transparent", color: "fg.muted", cursor: "pointer",
            "& + &": { marginLeft: 0 },
            "& svg": fontAwesomeSize("10px"),
            "&[data-allocation-chip-remove] svg": fontAwesomeSize("11px"),
            "&:hover": { background: "bg.canvas" },
            ...planElementFocus,
        },
        // A dashed placeholder (A45): `no event`, `no resource`, italic ink-4; during a body's drag a free row's says what a drop does.
        tablePlaceholder: {
            flex: 1, minWidth: 0, height: "28px", boxSizing: "border-box", display: "flex", alignItems: "center", gap: "8px", padding: "0 4px 0 8px",
            borderWidth: "1px", borderStyle: "dashed", borderColor: "border.strong", borderRadius: "sm", background: "transparent", textAlign: "left",
            fontFamily: "mono", fontSize: "label.md", fontWeight: "normal", fontStyle: "italic", color: "fg.subtle",
            "&:is(button)": { cursor: "pointer" },
            "&[data-open]": { borderColor: "brand.solid" },
            ...planElementFocus,
            // During a drag or a pick (A45): the brand where a drop or a click takes it, warn where it refuses; under the pointer, its words.
            "&[data-verdict=fits], &[data-verdict=pick]": { borderColor: "brand.solid" },
            "&[data-verdict=pick]": { color: "brandPressed", fontStyle: "normal" },
            "&[data-verdict=refused]": { borderColor: "status.warn", background: warnWash, color: "fg.warning", fontStyle: "normal" },
            "[data-allocation-cell-side][data-drop-valid] > &": { borderColor: "brand.solid" },
            "[data-allocation-cell-side][data-drop-active] > &": { background: "brandTint", color: "brandPressed", fontStyle: "normal" },
            "[data-allocation-cell-side][data-drop-invalid] > &": { borderColor: "status.warn", background: warnWash, color: "fg.warning", fontStyle: "normal" },
        },
        // Its words: idle; during a drag or a pick what a drop does, `doesn't fit`, or a pick's `click to book … here`; under the pointer
        // a drop's words, or a refusal's reason itself (A45).
        tablePlaceholderText: {
            flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            "&[data-say=drop], &[data-say=refused], &[data-say=reason], &[data-say=pick]": { display: "none" },
            "[data-verdict=refused] > &": { "&[data-say=idle]": { display: "none" }, "&[data-say=refused]": { display: "block" } },
            "[data-verdict=pick] > &": { "&[data-say=idle]": { display: "none" }, "&[data-say=pick]": { display: "block" } },
            "[data-allocation-cell-side][data-drop-active] > * > &": { "&[data-say=idle], &[data-say=pick]": { display: "none" }, "&[data-say=drop]": { display: "block" } },
            "[data-allocation-cell-side][data-drop-invalid] > * > &": { "&[data-say=idle], &[data-say=pick]": { display: "none" }, "&[data-say=refused]": { display: "block" } },
            "[data-allocation-cell-side][data-drop-invalid] > *:has([data-say=reason]) > &": { "&[data-say=refused]": { display: "none" }, "&[data-say=reason]": { display: "block" } },
        },
        // The focus chip's ×, a 16px target (A81).
        focusClear: {
            width: "16px", height: "16px", display: "grid", placeItems: "center", padding: 0, borderRadius: "sm", color: "inherit", cursor: "pointer",
            "&:hover": { background: "bg.surface" }, "& svg": fontAwesomeSize("10px"), ...planElementFocus,
        },
    },
});
