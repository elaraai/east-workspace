/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A decision's preview (#1453; `Decision Queue Spec.md` §8, P1–P26): the frame a
 * case's change is drawn in, between its card's title and its chip line, and
 * what it draws there — a builder's crop, its map, a Sheet's rows — at the
 * builder's sizes, as the mock draws them. The Roster's tiles and marks are the
 * Roster recipe's own, which the preview's `tile`, `off` and `mark` size for the
 * crop and the map; every other part is this recipe's. The parts set data
 * attributes and geometry only.
 *
 * Slots:
 * - root: the frame — `role="img"`, 1px `--rule`, `--r-sm`, `--paper`, at its target's height (`data-kind`, P2): 120
 *   for a builder's and the zones', 116 for a projection, 112 otherwise; dashed `--rule-strong` while stale
 *   (`data-stale`, P21). Its layout (`data-layout`: `roster`, `people`, `cost`, `lanes`, `map`, `sheet`, `fields`, `mix`,
 *   `groups`, `projection`, `zones`) lays out its rows; its kind sets the
 *   lanes' measures — the lane head's least width (`--pv-lw`: the Plan's 72, the Allocation's 88, the Calendar's 96), a
 *   bar's height (the Plan's and the Calendar's 18, a bin's 24) and the gaps between stacked bars.
 * - lanes: the lanes' grid — its ruler and its lanes share its two columns, the head's and the plot's: the head as wide
 *   as its longest name and measure need, never under its kind's least nor over 144 or 40% of the frame
 *   (`--pv-lw-max`), past which a name ends in an ellipsis.
 * - header, headerCell: the crop's head row, 24 tall over `--rule-strong` — the Roster's days (the weekday's letter
 *   `--ink-4` and its date `--ink-2`, mono `--fs-label-xs` 600) or a Sheet's column heads (upper case, tracked 0.14em).
 * - row, rowHead, rowName, measure: a crop's row — the Roster's 36, a Sheet's 28, a lane as tall as its stacked bars
 *   need (`--pv-lanes`) and never under its kind's least — its head the name (`--fs-body-sm` 600; a lane's
 *   `--fs-body`, a bin resource's mono `--fs-label-lg`) over its measure before → after, mono `--fs-label-xs` 600 in
 *   its tone (`data-tone`: `better` `--pos-text`, `worse` `--warn-text`, `bad` `--neg-text`, else `--ink-3`, P24).
 * - cell, tile, off: a Roster day's cell and its duty's tile over the Roster's `tile` (its shift's colour token,
 *   `--roster-fill`), or the Roster's `assign` wash on an off day.
 * - ruler, rulerPlot, tick, plot, gridLine, now: the lanes' time ruler, 20 tall, its ticks mono `--fs-label-xs` 500
 *   `--ink-4` (`--pv-at`; the first set in 4 from the start, the last 4 from the end, `data-edge`); a lane's plot, its
 *   grid lines and the now line, 1px `--brand-d` (P20).
 * - bar, barText, icon: an entry on a lane at its place (`--pv-left`, `--pv-width`, `--pv-lane`): the
 *   Plan's committed bar `--brand-d` with `--paper` words (P19), an Allocation's bin (`data-shape="bin"`) the board's
 *   card, 1px `--rule-strong` on `--paper`, `--r-md`, and a resource's job as the board's row draws it (`data-look`):
 *   the one under way on the day on `--paper-3`, one planned after it dashed `--ink-4`, unfilled, its words `--ink-4`;
 *   and its lock or its warning (`icon`, `data-tone="warn"`, P15, P17).
 * - map, mapRow, mapLabel, mapTiles, mapTile: a builder's map (P5) — its resources as 22px tiles, eight a row, under
 *   their group's label; one the change touches on the dirty fill with the glow, one it moves off a ghost, the rest
 *   `--paper-3` on `--rule-strong`; the rest of a group past a row its count (`data-more`).
 * - when, whenLabel, whenStrip, whenTick: the when strip under a batch's map (P12): its window's words, cut with an
 *   ellipsis past its 52, over a strip 12 tall, its grid lines and a 2px glowing tick at each change's new time.
 * - people, peopleRow, peopleDay, peopleName, mark: the Roster's map by people (P5): rows 16, its days' letters 12, a
 *   person's name and hours, and a day's mark, 12 tall, over the Roster's `mark`.
 * - count, countText, countFigure: what a map names beside its rows — `+ 16 more people` — and its count, `20 of 36`.
 * - sheetKey, sheetCell, guess: a Sheet's row — its first column's value mono `--fs-label-md` `--ink-3`, then its
 *   lock; its cells, a quantity's figures at the end (`data-numeric`) and a date's in place (`data-mono`) in
 *   mono, its changed cells' values on the dirty fill (`data-fill="cell"`), a cleared one the Sheet's blank, italic
 *   `--ink-4` (`data-empty`) — and a guessed cell's dot, Font Awesome's `circle` 6px in `--warn`, 6 before its value
 *   (P26).
 * - field, fieldName, fieldLine, fieldWas, fieldNow: a record's field (P6) — its name, the caption's mono
 *   `--fs-label-xs` 600 upper case tracked 0.12em, over its line: the value it held, mono `--fs-label-md` 500 `--ink-4`
 *   struck through, then its value as a chip 22 tall, mono `--fs-body-sm` 600 — a changed one (`data-op="chg"`) on the
 *   dirty fill with the glow, one left as it is 1px `--rule-strong` on `--paper`, `--ink-3`. Rows 54, a rule between.
 * - chart, chartHead, chartCaption, chartTicks, chartRow, chartName, chartPlot, chartFigure: a row per key on a shared
 *   axis — the Roster's cost by pay code (P7; `104px` name, `52px` change), a record's mix (P10; `80px`, `48px`) and its
 *   groups (P11; `76px`, `36px` count, `48px` net): a head 16 tall (the cost's 14) of upper-case captions and the axis's
 *   ticks, mono `--fs-label-xs` 500 `--ink-4`, spaced to its ends; rows 17, the name `--fs-body-sm`, the figures mono
 *   `--fs-label-md` 600 in their tone (`data-tone`: `better` `--pos-text`, `worse` `--warn-text`, `bad` `--neg-text`,
 *   `neither` `--ink-3`; `data-same`, a row its change leaves as it is, `--ink-4`), a trend's arrow (`trend`) before one.
 * - zero, delta: the cost's zero, 1px `--rule-strong` at the plot's middle, and a code's change as a bar from it, 9
 *   tall (`--pv-left`, `--pv-width`): a saving a ghost (`data-op="from"`), an added cost `--brand-d` with the glow
 *   (`data-op="add"`, `data-fill="own"`).
 * - rail, span, dot: a mix's row — its 1px `--rule` across the plot's middle, the 2px `elara.edge` line from the value it
 *   holds to its proposed one, and their dots, 8 across (`--pv-at`): the value held (`data-at="was"`) hollow, 1px
 *   `--ink-3` on `--paper`, drawn only where it changes; the proposed `--brand-d` with the glow where it changes
 *   (`data-op="chg"`, `data-fill="own"`), `--ink-4` where it does not.
 * - track, part: a group's size, `--paper-3`, and its rows the change touches, `--brand-d` with the glow — each 8
 *   tall, its width (`--pv-width`) its share of the largest group.
 * - projection, yAxis, yLabel, projPlot, wash, limit, lines, line, lineLabel, xAxis: a projection (P8) — its plot 84
 *   tall beside a 36 axis, `--rule` on its left and `--rule-strong` along its foot, its ticks (`tick`, `gridLine`)
 *   under it; the limit a dashed `--warn` rule (`--pv-at`) over a 6% `--warn` wash below it, its label `--warn-text`;
 *   a line per option, drawn in a 100 × 100 box at any size, its stroke kept: the chosen 2px `--brand-d`
 *   (`data-line="chosen"`), glowing (`data-glow` on its box) unless it is the option that changes nothing, which, not
 *   chosen, is a dashed 1.5px `elara.edge` ghost (`data-line="asis"`); the others 1px `--ink-5`. Each line's label,
 *   mono `--fs-label-xs` 600 (`--pv-x`, `--pv-y`), at its rise and left of it, or over its run (`data-place="run"`),
 *   `--ink` for the chosen (`data-chosen`), else `--ink-4`.
 * - zones, zoneKey, zoneItem, swatch, zoneName, zoneCount, zoneTiles, zoneTile, depot: a map of zones (P9) — the key,
 *   each zone's swatch, its name and its count before → after; the areas as tiles 16 tall, at least twelve a row
 *   (`--pv-columns`), each filled from its zone's colour (`--pv-zone`: its edge 70%, its fill 32% on `--paper`), a
 *   cell no area holds empty (`data-empty`), one the change moves taking its new zone's fill and the glow
 *   (`data-op="chg"`, `data-fill="own"`), and a depot a 6px `--ink` dot.
 * - pending, failed: the frame's place while its rows are read — the shared placeholder shapes in its layout (P23) —
 *   and a failed read's line.
 *
 * The marks over the entries, on the `elara` tokens and the attributes Optimise's landing reads (#1409): a proposed
 * entry (`data-op="add|chg"`) the steady highlight Optimise's result is drawn with (`ELARA_STEADY`, P13), on the
 * dirty fill unless the entry keeps its own (`data-fill="own"`), inset on a Sheet's cell (`data-fill="cell"`); a ghost
 * — an entry the change moves off (`data-op="from"`) or that is gone from its row (`data-op="del"`, struck through) —
 * dashed in `elara.edge`, unfilled, its words `--ink-4` (P14); an entry the option knocks on (`data-knock`) a dashed
 * `elara.edge` ring 3 out, 3 in on a Sheet's cell (P16); one that breaks a rule (`data-breach`) a `--warn` ring (P15); while stale the
 * proposal dashed on `--paper-3`, no glow (P21); once applied (`data-applied`), over `--dur-slow` while its card stands,
 * the glow — a when tick's and a chosen line's too — settles into the builder's own fill, and the rings and the ghosts
 * go (P22).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { ELARA_STEADY, ELARA_STEADY_INSET } from "../elara-marks.js";
import { fontAwesomeSize } from "../icon-size.js";

/** A ghost: dashed `elara.edge`, unfilled, its words `--ink-4`. */
const GHOST = {
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: "elara.edge",
    background: "transparent",
    boxShadow: "none",
    color: "fg.subtle",
} satisfies SystemStyleObject;

/** The marks over a preview's entries (P13–P22). */
const MARKS = {
    "& [data-op], & [data-knock], & [data-breach]": {
        transitionProperty: "box-shadow, opacity, outline-color",
        transitionDuration: "slow",
        transitionTimingFunction: "{easings.out}",
    },
    "& [data-op=add], & [data-op=chg]": { boxShadow: ELARA_STEADY },
    "& [data-op=add]:not([data-fill=own]):not([data-fill=cell]), & [data-op=chg]:not([data-fill=own]):not([data-fill=cell])": {
        backgroundColor: "brandTint",
    },
    "& [data-fill=cell][data-op=add], & [data-fill=cell][data-op=chg]": { backgroundColor: "brandTint", boxShadow: ELARA_STEADY_INSET },
    "& [data-op=from], & [data-op=del]": GHOST,
    "& [data-op=del]": { textDecoration: "line-through" },
    "& [data-op=from] *, & [data-op=del] *": { color: "inherit" },
    "& [data-knock]": { outline: "1px dashed {colors.elara.edge}", outlineOffset: "3px" },
    "& [data-fill=cell][data-knock]": { outlineOffset: "-3px" },
    "& [data-breach]": { outline: "1px solid {colors.status.warn}", outlineOffset: "3px" },
    // Stale (P21): the proposal dashed on `--paper-3`, its words `--ink-3`, no glow.
    "&[data-stale] [data-op=add], &[data-stale] [data-op=chg]": {
        borderWidth: "1px",
        borderStyle: "dashed",
        borderColor: "fg.subtle",
        backgroundColor: "bg.subtle",
        boxShadow: "none",
        color: "fg.muted",
    },
    // Applied (P22): the glow settles into the builder's own fill, the rings and the ghosts go. A cell's inset glow goes
    // too: its rule ties with this one, which comes later.
    "&[data-applied] [data-op=add], &[data-applied] [data-op=chg]": { boxShadow: "none" },
    "&[data-applied] [data-op=from], &[data-applied] [data-op=del]": { opacity: 0 },
    "&[data-applied] [data-knock], &[data-applied] [data-breach]": { outlineColor: "transparent" },
    _motionReduce: {
        "& [data-op], & [data-knock], & [data-breach]": { transition: "none" },
    },
} satisfies SystemStyleObject;

/** One line, cut with an ellipsis. */
const ELLIPSIS = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
/** A rule on an edge, `--rule`. */
const RULE = { borderStyle: "solid", borderColor: "border.subtle" } as const;
/** A head's caption: mono `--fs-label-xs` 600, `--ink-4`. */
const CAPTION = { fontFamily: "mono", fontSize: "label.xs", fontWeight: "semibold", color: "fg.subtle" } as const;
/** A lane's height: its stacked bars and its padding, never under its kind's least. */
const LANE_HEIGHT = "max(var(--pv-lane-min), calc(2 * var(--pv-lane-pad) + var(--pv-lanes, 1) * var(--pv-bar-h) + (var(--pv-lanes, 1) - 1) * var(--pv-bar-gap)))";
/** A bar's top: its stack centred in the lane, then its place in the stack. */
const BAR_TOP = "calc((100% - (var(--pv-lanes, 1) * var(--pv-bar-h) + (var(--pv-lanes, 1) - 1) * var(--pv-bar-gap))) / 2 + var(--pv-lane, 0) * (var(--pv-bar-h) + var(--pv-bar-gap)))";
/** A head's upper-case caption, tracked 0.12em. */
const HEAD_CAPTION = { ...CAPTION, letterSpacing: "widest", textTransform: "uppercase" } as const;
/** A figure: mono `--fs-label-md` 600, its digits tabular. */
const FIGURE = { fontFamily: "mono", fontSize: "label.md", fontWeight: "semibold", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
/** A chart's columns, by its layout: the name, the plot, then its figures. */
const CHART_COLUMNS = {
    "[data-layout=cost] &": { gridTemplateColumns: "104px minmax(0, 1fr) 52px", paddingRight: "8px" },
    "[data-layout=mix] &": { gridTemplateColumns: "80px minmax(0, 1fr) 48px" },
    "[data-layout=groups] &": { gridTemplateColumns: "76px minmax(0, 1fr) 36px 48px" },
} as const;
/** A zone's fill, from its colour (`--pv-zone`): its edge 70% of it on `--paper`, its fill 32%. */
const ZONE_FILL = {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "color-mix(in oklch, var(--pv-zone) 70%, {colors.bg.surface})",
    background: "color-mix(in oklch, var(--pv-zone) 32%, {colors.bg.surface})",
} as const;

export const decisionPreviewSlotRecipe = defineSlotRecipe({
    className: "elara-decision-preview",
    slots: [
        "root",
        "header", "headerCell", "row", "rowHead", "rowName", "measure",
        "cell", "tile", "off",
        "lanes", "ruler", "rulerPlot", "tick", "plot", "gridLine", "now", "bar", "barText", "icon",
        "map", "mapRow", "mapLabel", "mapTiles", "mapTile",
        "when", "whenLabel", "whenStrip", "whenTick",
        "people", "peopleRow", "peopleDay", "peopleName", "mark",
        "count", "countText", "countFigure",
        "sheetKey", "sheetCell", "guess",
        "field", "fieldName", "fieldLine", "fieldWas", "fieldNow",
        "chart", "chartHead", "chartCaption", "chartTicks", "chartRow", "chartName", "chartPlot", "chartFigure", "trend",
        "zero", "delta", "rail", "span", "dot", "track", "part",
        "projection", "yAxis", "yLabel", "projPlot", "wash", "limit", "lines", "line", "lineLabel", "xAxis",
        "zones", "zoneKey", "zoneItem", "swatch", "zoneName", "zoneCount", "zoneTiles", "zoneTile", "depot",
        "pending", "failed",
    ],
    base: {
        root: {
            position: "relative",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            height: "112px",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.subtle",
            borderRadius: "sm",
            background: "bg.surface",
            color: "fg",
            overflow: "hidden",
            "--pv-lw": "72px",
            "--pv-lw-max": "min(144px, 40%)",
            "--pv-bar-h": "18px",
            "--pv-bar-gap": "3px",
            "--pv-lane-pad": "5px",
            "--pv-lane-min": "40px",
            "&[data-kind=roster], &[data-kind=plan], &[data-kind=calendar], &[data-kind=allocation], &[data-kind=zones]": { height: "120px" },
            "&[data-kind=projection]": { height: "116px" },
            "&[data-kind=calendar]": { "--pv-lw": "96px" },
            "&[data-kind=allocation]": { "--pv-lw": "88px", "--pv-bar-h": "24px", "--pv-bar-gap": "4px", "--pv-lane-pad": "4px", "--pv-lane-min": "36px" },
            "&[data-stale]": { borderStyle: "dashed", borderColor: "border.strong" },
            ...MARKS,
        },

        // ── A crop's rows ──
        header: {
            display: "grid",
            flexShrink: 0,
            height: "24px",
            boxSizing: "border-box",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderColor: "border.strong",
            gridTemplateColumns: "84px repeat(7, minmax(0, 1fr))",
            "[data-layout=sheet] &": { gridTemplateColumns: "72px repeat(var(--pv-columns, 1), minmax(0, 1fr))" },
        },
        headerCell: {
            ...CAPTION,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "2px",
            minWidth: 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            letterSpacing: "0.08em",
            borderLeftWidth: "1px",
            ...RULE,
            "& > b": { fontWeight: "semibold", color: "fg.strong" },
            // The gutter's head, or a Sheet's first column's: the frame's own edge, no rule of its own.
            "&:first-of-type": { borderLeftWidth: 0 },
            "[data-layout=sheet] &": {
                justifyContent: "flex-start",
                padding: "0 8px",
                letterSpacing: "label",
                textTransform: "uppercase",
                "&:first-of-type": { paddingLeft: "12px" },
                "&[data-align=end]": { justifyContent: "flex-end" },
            },
        },
        row: {
            display: "grid",
            flexShrink: 0,
            minWidth: 0,
            boxSizing: "border-box",
            borderBottomWidth: "1px",
            ...RULE,
            "&:last-child": { borderBottomWidth: 0 },
            "[data-layout=roster] &": { gridTemplateColumns: "84px repeat(7, minmax(0, 1fr))", height: "36px" },
            "[data-layout=lanes] &": { gridColumn: "1 / -1", gridTemplateColumns: "subgrid", height: LANE_HEIGHT },
            "[data-layout=sheet] &": { gridTemplateColumns: "72px repeat(var(--pv-columns, 1), minmax(0, 1fr))", height: "28px" },
        },
        rowHead: {
            display: "grid",
            alignContent: "center",
            gap: "2px",
            minWidth: 0,
            padding: "0 8px 0 12px",
            "[data-layout=lanes] &": { minWidth: "var(--pv-lw)" },
        },
        rowName: {
            ...ELLIPSIS,
            justifySelf: "start",
            maxWidth: "100%",
            fontSize: "body.sm",
            fontWeight: "semibold",
            color: "fg",
            "[data-layout=lanes] &": { fontSize: "body" },
            "[data-kind=allocation] &": { fontFamily: "mono", fontSize: "label.lg" },
        },
        measure: {
            justifySelf: "start",
            whiteSpace: "nowrap",
            fontFamily: "mono",
            fontSize: "label.xs",
            fontWeight: "semibold",
            fontVariantNumeric: "tabular-nums",
            color: "fg.muted",
            "&[data-tone=better]": { color: "fg.success" },
            "&[data-tone=worse]": { color: "fg.warning" },
            "&[data-tone=bad]": { color: "fg.danger" },
            "[data-stale] &": { color: "fg.subtle" },
        },

        // ── The Roster's crop: a day's cell, its duty over the Roster's tile, an off day over its `+ Assign` wash ──
        cell: { display: "flex", alignItems: "center", gap: "2px", minWidth: 0, padding: "0 2px", borderLeftWidth: "1px", ...RULE },
        tile: { justifyContent: "center", gap: "2px", padding: "0 2px", overflow: "hidden", cursor: "default", "& > [data-tile-label]": { fontWeight: "semibold" } },
        off: { cursor: "default" },

        // ── The lanes: the Plan's, the Calendar's and the Allocation's crop ──
        lanes: { display: "grid", gridTemplateColumns: "fit-content(var(--pv-lw-max)) minmax(0, 1fr)", alignContent: "start", minWidth: 0 },
        ruler: {
            display: "grid",
            gridColumn: "1 / -1",
            gridTemplateColumns: "subgrid",
            height: "20px",
            boxSizing: "border-box",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderColor: "border.strong",
        },
        rulerPlot: { position: "relative", minWidth: 0, borderLeftWidth: "1px", ...RULE },
        tick: {
            position: "absolute",
            top: "4px",
            left: "var(--pv-at)",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            fontFamily: "mono",
            fontSize: "label.xs",
            fontWeight: "medium",
            fontVariantNumeric: "tabular-nums",
            lineHeight: "12px",
            color: "fg.subtle",
            "&[data-edge=first]": { transform: "translateX(4px)" },
            "&[data-edge=last]": { transform: "translateX(calc(-100% - 4px))" },
        },
        plot: { position: "relative", minWidth: 0, overflow: "hidden", borderLeftWidth: "1px", ...RULE },
        gridLine: { position: "absolute", top: 0, bottom: 0, left: "var(--pv-at)", borderLeftWidth: "1px", ...RULE, pointerEvents: "none" },
        now: {
            position: "absolute",
            top: 0,
            bottom: 0,
            zIndex: 1,
            left: "var(--pv-at)",
            borderLeftWidth: "1px",
            borderLeftStyle: "solid",
            borderColor: "brand.solid",
            pointerEvents: "none",
        },
        bar: {
            position: "absolute",
            zIndex: 2,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            top: BAR_TOP,
            left: "var(--pv-left)",
            width: "var(--pv-width)",
            height: "var(--pv-bar-h)",
            padding: "0 6px",
            overflow: "hidden",
            whiteSpace: "nowrap",
            borderRadius: "sm",
            background: "brand.solid",
            color: "bg.surface",
            fontFamily: "mono",
            fontSize: "label.sm",
            fontWeight: "semibold",
            fontVariantNumeric: "tabular-nums",
            "&[data-shape=bin]": { borderRadius: "md", color: "fg" },
            "&[data-shape=bin]:not([data-op])": { borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", background: "bg.surface" },
            // A resource's job, as the board's row draws it: the one under way on the day, or one planned after it.
            "&[data-shape=bin][data-look=prior]": { background: "bg.subtle" },
            "&[data-shape=bin][data-look=next]": { borderStyle: "dashed", borderColor: "fg.subtle", background: "transparent", color: "fg.subtle" },
        },
        barText: { ...ELLIPSIS, flex: 1 },
        icon: {
            ...fontAwesomeSize("9.5px"),
            flex: "none",
            display: "inline-flex",
            color: "inherit",
            "&[data-tone=warn]": { color: "status.warn" },
        },

        // ── A builder's map (P5) ──
        map: { display: "grid", alignContent: "start", gap: "4px", padding: "12px" },
        mapRow: { display: "grid", gridTemplateColumns: "52px minmax(0, 1fr)", alignItems: "center", gap: "4px" },
        mapLabel: { ...CAPTION, ...ELLIPSIS, letterSpacing: "widest", textTransform: "uppercase" },
        mapTiles: { display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: "4px" },
        mapTile: {
            ...ELLIPSIS,
            height: "22px",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "2px",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "sm",
            background: "bg.subtle",
            fontFamily: "mono",
            fontSize: "label.xs",
            fontWeight: "semibold",
            color: "fg.muted",
            "&[data-op=add], &[data-op=chg]": { borderWidth: 0, color: "brandPressed" },
        },
        when: { display: "grid", gridTemplateColumns: "52px minmax(0, 1fr)", alignItems: "center", gap: "4px", paddingTop: "4px" },
        whenLabel: { ...CAPTION, ...ELLIPSIS, letterSpacing: "wider", lineHeight: "12px" },
        whenStrip: { position: "relative", height: "12px", boxSizing: "border-box", borderBottomWidth: "1px", borderBottomStyle: "solid", borderColor: "border.strong" },
        whenTick: {
            position: "absolute",
            top: "2px",
            bottom: 0,
            left: "var(--pv-at)",
            width: "2px",
            background: "brand.solid",
            boxShadow: ELARA_STEADY,
            transitionProperty: "box-shadow",
            transitionDuration: "slow",
            transitionTimingFunction: "{easings.out}",
            "[data-applied] &": { boxShadow: "none" },
            _motionReduce: { transition: "none" },
        },

        // ── The Roster's map by people (P5) ──
        people: { display: "grid", alignContent: "start", gap: "4px", padding: "8px" },
        peopleRow: {
            display: "grid",
            gridTemplateColumns: "96px repeat(7, minmax(0, 1fr))",
            columnGap: "2px",
            alignItems: "center",
            height: "16px",
            "&[data-head]": { height: "12px" },
        },
        peopleDay: { ...CAPTION, textAlign: "center", letterSpacing: "0.08em", lineHeight: "12px" },
        peopleName: { display: "flex", alignItems: "baseline", gap: "4px", minWidth: 0, overflow: "hidden" },
        mark: { height: "12px", boxSizing: "border-box", borderRadius: "2px", fontSize: "label.xs", lineHeight: 1 },
        count: { display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0, lineHeight: "16px" },
        countText: { ...ELLIPSIS, flex: 1, fontSize: "body.sm", color: "fg.strong" },
        countFigure: { fontFamily: "mono", fontSize: "label.md", fontWeight: "semibold", fontVariantNumeric: "tabular-nums", color: "fg", whiteSpace: "nowrap" },

        // ── A Sheet's rows ──
        sheetKey: {
            display: "flex",
            alignItems: "center",
            gap: "4px",
            minWidth: 0,
            overflow: "hidden",
            padding: "0 8px 0 12px",
            fontFamily: "mono",
            fontSize: "label.md",
            fontWeight: "medium",
            color: "fg.muted",
            "& > [data-value]": ELLIPSIS,
        },
        sheetCell: {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            minWidth: 0,
            overflow: "hidden",
            padding: "0 8px",
            borderLeftWidth: "1px",
            ...RULE,
            fontSize: "body.sm",
            color: "fg",
            "& > [data-value]": ELLIPSIS,
            "&[data-numeric]": { justifyContent: "flex-end", fontFamily: "mono", fontVariantNumeric: "tabular-nums" },
            "&[data-mono]": { fontFamily: "mono", fontVariantNumeric: "tabular-nums" },
            "&[data-op]": { fontWeight: "semibold" },
            "&[data-empty]": { fontStyle: "italic", fontWeight: "normal", color: "fg.subtle" },
        },
        guess: { ...fontAwesomeSize("6px"), flex: "none", display: "inline-flex", color: "status.warn" },

        // ── A record's changed fields (P6) ──
        field: {
            display: "grid",
            flexShrink: 0,
            gap: "4px",
            minWidth: 0,
            padding: "8px 12px",
            borderBottomWidth: "1px",
            ...RULE,
            "&:last-child": { borderBottomWidth: 0 },
        },
        fieldName: { ...HEAD_CAPTION, ...ELLIPSIS, lineHeight: "12px" },
        fieldLine: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0 },
        fieldWas: { ...FIGURE, fontWeight: "medium", color: "fg.subtle", textDecoration: "line-through" },
        fieldNow: {
            ...FIGURE,
            height: "22px",
            boxSizing: "border-box",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            minWidth: 0,
            overflow: "hidden",
            padding: "0 6px",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "sm",
            background: "bg.surface",
            fontSize: "body.sm",
            color: "fg.muted",
            "&[data-op]": { borderWidth: 0, color: "fg" },
        },

        // ── A row per key on a shared axis: the Roster's cost (P7), a record's mix (P10) and its groups (P11) ──
        chart: { display: "grid", alignContent: "start", padding: "4px 0 8px", "[data-layout=cost] &": { paddingBottom: "4px" } },
        chartHead: {
            display: "grid",
            columnGap: "8px",
            alignItems: "center",
            height: "16px",
            padding: "0 12px",
            ...CHART_COLUMNS,
            "[data-layout=cost] &": { ...CHART_COLUMNS["[data-layout=cost] &"], height: "14px" },
        },
        chartCaption: { ...HEAD_CAPTION, ...ELLIPSIS, "&[data-align=end]": { textAlign: "right" } },
        chartTicks: {
            display: "flex",
            justifyContent: "space-between",
            minWidth: 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            fontFamily: "mono",
            fontSize: "label.xs",
            fontWeight: "medium",
            fontVariantNumeric: "tabular-nums",
            color: "fg.subtle",
        },
        chartRow: { display: "grid", columnGap: "8px", alignItems: "center", height: "17px", padding: "0 12px", ...CHART_COLUMNS },
        chartName: { ...ELLIPSIS, fontSize: "body.sm", color: "fg" },
        chartPlot: { position: "relative", height: "100%", minWidth: 0, "[data-layout=groups] &": { height: "8px" } },
        chartFigure: {
            ...FIGURE,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "2px",
            minWidth: 0,
            color: "fg",
            "&[data-tone=better]": { color: "fg.success" },
            "&[data-tone=worse]": { color: "fg.warning" },
            "&[data-tone=bad]": { color: "fg.danger" },
            "&[data-tone=neither]": { color: "fg.muted" },
            "&[data-same]": { color: "fg.subtle" },
            "[data-stale] &": { color: "fg.subtle" },
        },
        trend: { ...fontAwesomeSize("8px"), flex: "none", display: "inline-flex", color: "inherit" },
        zero: { position: "absolute", top: 0, bottom: 0, left: "50%", borderLeftWidth: "1px", borderLeftStyle: "solid", borderColor: "border.strong", pointerEvents: "none" },
        delta: {
            position: "absolute",
            top: "4px",
            left: "var(--pv-left)",
            width: "var(--pv-width)",
            height: "9px",
            boxSizing: "border-box",
            borderRadius: "2px",
            background: "brand.solid",
        },
        rail: { position: "absolute", left: 0, right: 0, top: "50%", borderTopWidth: "1px", ...RULE, pointerEvents: "none" },
        span: { position: "absolute", top: "50%", left: "var(--pv-left)", width: "var(--pv-width)", height: "2px", transform: "translateY(-50%)", background: "elara.edge" },
        dot: {
            position: "absolute",
            top: "50%",
            left: "var(--pv-at)",
            width: "8px",
            height: "8px",
            boxSizing: "border-box",
            borderRadius: "full",
            transform: "translate(-50%, -50%)",
            background: "fg.subtle",
            "&[data-at=was]": { borderWidth: "1px", borderStyle: "solid", borderColor: "fg.muted", background: "bg.surface" },
            "&[data-op]": { background: "brand.solid" },
        },
        track: { position: "absolute", left: 0, top: 0, bottom: 0, width: "var(--pv-width)", borderRadius: "2px", background: "bg.subtle" },
        part: { position: "absolute", left: 0, top: 0, bottom: 0, width: "var(--pv-width)", borderRadius: "2px", background: "brand.solid" },

        // ── A projection (P8) ──
        projection: { display: "grid", gridTemplateColumns: "36px minmax(0, 1fr)", gridTemplateRows: "84px 16px", padding: "8px 12px 4px 0" },
        yAxis: { position: "relative" },
        yLabel: {
            position: "absolute",
            right: "6px",
            top: "var(--pv-at)",
            transform: "translateY(-50%)",
            whiteSpace: "nowrap",
            fontFamily: "mono",
            fontSize: "label.xs",
            fontWeight: "semibold",
            fontVariantNumeric: "tabular-nums",
            lineHeight: "12px",
            color: "fg.subtle",
            "&[data-tone=warn]": { color: "fg.warning" },
        },
        projPlot: {
            position: "relative",
            minWidth: 0,
            borderLeftWidth: "1px",
            borderBottomWidth: "1px",
            borderStyle: "solid",
            borderLeftColor: "border.subtle",
            borderBottomColor: "border.strong",
        },
        wash: { position: "absolute", left: 0, right: 0, bottom: 0, top: "var(--pv-at)", background: "color-mix(in oklch, {colors.status.warn} 6%, transparent)", pointerEvents: "none" },
        limit: { position: "absolute", left: 0, right: 0, top: "var(--pv-at)", borderTopWidth: "1px", borderTopStyle: "dashed", borderColor: "status.warn", pointerEvents: "none" },
        lines: {
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
            pointerEvents: "none",
            transitionProperty: "filter",
            transitionDuration: "slow",
            transitionTimingFunction: "{easings.out}",
            "&[data-glow]": { filter: "drop-shadow(0 0 2px {colors.elara.soft})" },
            "[data-stale] &, [data-applied] &": { "&[data-glow]": { filter: "none" } },
            _motionReduce: { transition: "none" },
        },
        line: {
            fill: "none",
            vectorEffect: "non-scaling-stroke",
            strokeLinejoin: "round",
            stroke: "fg.faint",
            strokeWidth: "1px",
            "&[data-line=asis]": { stroke: "elara.edge", strokeWidth: "1.5px", strokeDasharray: "3 3" },
            "&[data-line=chosen]": { stroke: "brand.solid", strokeWidth: "2px" },
            "[data-stale] &": { "&[data-line=chosen]": { stroke: "fg.subtle", strokeDasharray: "4 3" } },
        },
        lineLabel: {
            position: "absolute",
            left: "var(--pv-x)",
            top: "var(--pv-y)",
            transform: "translate(calc(-100% - 4px), -50%)",
            whiteSpace: "nowrap",
            fontFamily: "mono",
            fontSize: "label.xs",
            fontWeight: "semibold",
            fontVariantNumeric: "tabular-nums",
            lineHeight: "12px",
            color: "fg.subtle",
            "&[data-place=run]": { transform: "translate(-50%, calc(-100% - 2px))" },
            "&[data-chosen]": { color: "fg" },
        },
        xAxis: { position: "relative", minWidth: 0 },

        // ── A map of zones (P9) ──
        zones: { display: "grid", alignContent: "start", gap: "8px", padding: "8px 12px 12px" },
        zoneKey: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 16px", minHeight: "16px" },
        zoneItem: { display: "inline-flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" },
        swatch: { ...ZONE_FILL, width: "10px", height: "10px", boxSizing: "border-box", borderRadius: "2px" },
        zoneName: { fontSize: "body.sm", fontWeight: "semibold", color: "fg" },
        zoneCount: { ...FIGURE, color: "fg.muted" },
        zoneTiles: { display: "grid", gridTemplateColumns: "repeat(var(--pv-columns, 12), minmax(0, 1fr))", gap: "2px" },
        zoneTile: {
            ...ZONE_FILL,
            height: "16px",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "2px",
            "&[data-empty]": { borderWidth: 0, background: "transparent" },
        },
        depot: { width: "6px", height: "6px", borderRadius: "full", background: "fg" },

        // ── A read in flight, or one that failed ──
        pending: { display: "flex", alignItems: "center", minWidth: 0, height: "100%" },
        failed: { display: "flex", alignItems: "center", minWidth: 0, flex: 1, padding: "0 12px" },
    },
});
