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
 *   (`data-stale`, P21). Its layout (`data-layout`: `roster`, `lanes`, `sheet`) lays out its rows; its kind sets the
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
 * - bar, barText, icon, shared: an entry on a lane at its place (`--pv-left`, `--pv-width`, `--pv-lane`): the
 *   Plan's committed bar `--brand-d` with `--paper` words (P19), an Allocation's bin (`data-shape="bin"`) the board's
 *   card, 1px `--rule-strong` on `--paper`, `--r-md`; its lock or its warning (`icon`, `data-tone="warn"`, P15, P17)
 *   and the `+N` chip of the other cases changing it (`shared`, `--paper`, 12 tall, P18).
 * - map, mapRow, mapLabel, mapTiles, mapTile: a builder's map (P5) — its resources as 22px tiles, eight a row, under
 *   their group's label; one the change touches on the dirty fill with the glow, one it moves off a ghost, the rest
 *   `--paper-3` on `--rule-strong`.
 * - when, whenLabel, whenStrip, whenTick: the when strip under a batch's map (P12): 12 tall, a 2px glowing tick at each
 *   change's new time.
 * - people, peopleRow, peopleDay, peopleName, mark: the Roster's map by people (P5): rows 16, its days' letters 12, a
 *   person's name and hours, and a day's mark, 12 tall, over the Roster's `mark`.
 * - count, countText, countFigure: what a map names beside its rows — `+ 16 more people` — and its count, `20 of 36`.
 * - sheetKey, sheetCell, guess: a Sheet's row — its first column's value mono `--fs-label-md` `--ink-3`, its changed
 *   cells' values on the dirty fill (`data-fill="cell"`), an empty one italic `--ink-4` — and a guessed cell's dot,
 *   6px `--warn`, 6 before its value (P26).
 * - pending, failed: the frame's place while its rows are read — the shared placeholder shapes in its layout (P23) —
 *   and a failed read's line.
 *
 * The marks over the entries, on the `elara` tokens and the attributes Optimise's landing reads (#1409): a proposed
 * entry (`data-op="add|chg"`) the steady highlight Optimise's result is drawn with (`ELARA_STEADY`, P13), on the
 * dirty fill unless the entry keeps its own (`data-fill="own"`), inset on a Sheet's cell (`data-fill="cell"`); a ghost
 * — an entry the change moves off (`data-op="from"`) or that is gone from its row (`data-op="del"`, struck through) —
 * dashed in `elara.edge`, unfilled, its words `--ink-4` (P14); an entry the option knocks on (`data-knock`) a dashed
 * `elara.edge` ring 3 out (P16); one that breaks a rule (`data-breach`) a `--warn` ring (P15); while stale the
 * proposal dashed on `--paper-3`, no glow (P21); once applied (`data-applied`) the glow settles to nothing over
 * `--dur-slow` and the ghosts go (P22).
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
    "& [data-op=add], & [data-op=chg]": {
        boxShadow: ELARA_STEADY,
        transitionProperty: "box-shadow",
        transitionDuration: "slow",
        transitionTimingFunction: "{easings.out}",
    },
    "& [data-op=add]:not([data-fill=own]):not([data-fill=cell]), & [data-op=chg]:not([data-fill=own]):not([data-fill=cell])": {
        backgroundColor: "brandTint",
    },
    "& [data-fill=cell][data-op=add], & [data-fill=cell][data-op=chg]": { backgroundColor: "brandTint", boxShadow: ELARA_STEADY_INSET },
    "& [data-op=from], & [data-op=del]": {
        ...GHOST,
        transitionProperty: "opacity",
        transitionDuration: "slow",
        transitionTimingFunction: "{easings.out}",
    },
    "& [data-op=del]": { textDecoration: "line-through" },
    "& [data-op=from] *, & [data-op=del] *": { color: "inherit" },
    "& [data-knock]": { outline: "1px dashed {colors.elara.edge}", outlineOffset: "3px" },
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
    // Applied (P22): the glow settles, the ghosts go.
    "&[data-applied] [data-op=add], &[data-applied] [data-op=chg]": { boxShadow: "none" },
    "&[data-applied] [data-op=from], &[data-applied] [data-op=del]": { opacity: 0 },
    _motionReduce: {
        "& [data-op]": { transition: "none" },
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

export const decisionPreviewSlotRecipe = defineSlotRecipe({
    className: "elara-decision-preview",
    slots: [
        "root",
        "header", "headerCell", "row", "rowHead", "rowName", "measure",
        "cell", "tile", "off",
        "lanes", "ruler", "rulerPlot", "tick", "plot", "gridLine", "now", "bar", "barText", "icon", "shared",
        "map", "mapRow", "mapLabel", "mapTiles", "mapTile",
        "when", "whenLabel", "whenStrip", "whenTick",
        "people", "peopleRow", "peopleDay", "peopleName", "mark",
        "count", "countText", "countFigure",
        "sheetKey", "sheetCell", "guess",
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
        },
        barText: { ...ELLIPSIS, flex: 1 },
        icon: {
            ...fontAwesomeSize("9.5px"),
            flex: "none",
            display: "inline-flex",
            color: "inherit",
            "&[data-tone=warn]": { color: "status.warn" },
        },
        shared: {
            flex: "none",
            height: "12px",
            display: "inline-flex",
            alignItems: "center",
            paddingInline: "4px",
            borderRadius: "2px",
            background: "bg.surface",
            color: "fg",
            fontSize: "label.xs",
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
        whenLabel: { ...CAPTION, letterSpacing: "wider", lineHeight: "12px", whiteSpace: "nowrap" },
        whenStrip: { position: "relative", height: "12px", boxSizing: "border-box", borderBottomWidth: "1px", borderBottomStyle: "solid", borderColor: "border.strong" },
        whenTick: { position: "absolute", top: "2px", bottom: 0, left: "var(--pv-at)", width: "2px", background: "brand.solid", boxShadow: ELARA_STEADY },

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
        sheetKey: { ...ELLIPSIS, display: "block", alignSelf: "center", padding: "0 8px 0 12px", fontFamily: "mono", fontSize: "label.md", fontWeight: "medium", color: "fg.muted" },
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
            "&[data-op]": { fontWeight: "semibold" },
            "&[data-empty]": { fontStyle: "italic", fontWeight: "normal", color: "fg.subtle" },
        },
        guess: { flex: "none", width: "6px", height: "6px", borderRadius: "full", background: "status.warn" },

        // ── A read in flight, or one that failed ──
        pending: { display: "flex", alignItems: "center", minWidth: 0, height: "100%" },
        failed: { display: "flex", alignItems: "center", minWidth: 0, flex: 1, padding: "0 12px" },
    },
});
