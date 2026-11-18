/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio visual slot recipe — the parts a Studio visual's tile lays out
 * around the parts it draws with (#1671): its eyebrow strip, the spec's frame
 * eyebrow — its name, then its meta and its menu at the end (TIL-1, TIL-2) —
 * over its body; a KPI's value, its change and what it is against, its trend
 * and its goal with the gap; a pivot's heat legend — its five steps on the
 * heat tokens, each 40 × 12 inside a `--rule`, their lower edges under them in
 * mono 9.5 `--ink-4` (TBL-4); and the line that says what a visual holds of
 * how many. Every numeral is mono and tabular, every label mono at the label
 * sizes (TIL-5); colour is the theme's alone.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { centredLine } from "../one-line-box.js";

/** The room a tile's eyebrow strip centres its row in: its 36px less its rule and the pixel of padding over the row. */
const HEAD_ROOM = 34;

export const studioVisualSlotRecipe = defineSlotRecipe({
    className: "elara-studio-visual",
    slots: [
        "tile", "head", "name", "end", "meta", "body", "root", "note", "table", "foot", "kpi", "change", "against", "trend", "goal", "gap",
        "heat", "heatRamp", "heatSwatch", "heatTicks",
        "list", "listRow", "listLine", "listText", "listName", "listCaption", "listValue", "listUnit", "listBar", "listBarFill",
    ],
    base: {
        /* A visual's tile: its eyebrow strip over its body, filling the frame, edge to edge. */
        tile: { display: "flex", flexDirection: "column", minWidth: "0", minHeight: "0", height: "100%" },
        /* The eyebrow strip: 36 on `--paper-2` over a `--rule`, padded 0 20. A pixel of padding over its row balances
           the rule under it (#1638), as a builder's toolbar does: its row is centred in an even 34px, so its 24px menu
           stands 6px under the strip's top edge and its words 12px. Centred in the 35px over the rule, as the mock
           draws it, each stood half a pixel off, and a page painted it a row higher or lower by where it stood the tile. */
        head: {
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "{spacing.3}",
            height: "36px", boxSizing: "border-box", paddingInline: "{spacing.5}", paddingTop: "1px", flexShrink: "0", minWidth: "0",
            background: "bg.canvas", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
        },
        /* Its name: mono 10 / 600, tracked 0.14em, uppercase, `--ink`, cut with an ellipsis; on a whole, even line. */
        name: {
            fontFamily: "mono", fontSize: "label.sm", fontWeight: "semibold", letterSpacing: "label", textTransform: "uppercase", lineHeight: centredLine(HEAD_ROOM, 12),
            color: "fg", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: "0",
        },
        /* Its meta and its menu, at the end. */
        end: { display: "flex", alignItems: "center", gap: "{spacing.1}", flexShrink: "0" },
        /* Its meta: mono 9.5, `--ink-4`, on the name's line. */
        meta: { fontFamily: "mono", fontSize: "label.xs", lineHeight: centredLine(HEAD_ROOM, 12), color: "fg.subtle", whiteSpace: "nowrap" },
        /* Its body, padded 20; its parts 12 apart. A table's or a list's rows run edge to edge, under the strip. */
        body: {
            display: "flex", flexDirection: "column", gap: "{spacing.3}", flex: "1", minWidth: "0", minHeight: "0", padding: "{spacing.5}",
            "&[data-flush]": { padding: "0", gap: "0" },
        },
        /* A visual's body: its part, then its note. */
        root: { display: "flex", flexDirection: "column", gap: "{spacing.2}", minWidth: "0", minHeight: "0", height: "100%" },
        /* What it holds of how many — `Showing 500 of 1,240 groups`. */
        note: { textStyle: "mono.xs", color: "fg.muted", flexShrink: "0" },
        /* A table, taking the room its foot leaves; a wide one scrolls inside it (TBL-5). */
        table: { flex: "1", minWidth: "0", minHeight: "0", display: "flex", flexDirection: "column" },
        /* Under a table: where its page stands, and its pages — on the strip's paper, over a `--rule`. */
        foot: {
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "{spacing.3}", flexShrink: "0", flexWrap: "wrap",
            paddingInline: "{spacing.5}", paddingBlock: "{spacing.2}",
            background: "bg.canvas", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle",
        },
        /* A KPI: the Stat's value, then its change, its trend and its goal, each gone with its well (KPI-3). */
        kpi: { display: "flex", flexDirection: "column", gap: "{spacing.2}", minWidth: "0" },
        change: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "{spacing.1.5}" },
        against: { textStyle: "mono.xs", color: "fg.muted" },
        trend: { height: "32px", width: "100%" },
        goal: { display: "flex", flexDirection: "column", gap: "{spacing.1}" },
        gap: { textStyle: "mono.xs", color: "fg.muted" },
        /* A pivot's heat legend (TBL-4): its ramp over its steps' lower edges. */
        heat: { display: "flex", flexDirection: "column", gap: "{spacing.1}", flexShrink: "0" },
        heatRamp: { display: "flex", width: "max-content", borderWidth: "1px", borderStyle: "solid", borderColor: "border.subtle" },
        heatSwatch: {
            width: "40px", height: "12px",
            "&[data-step='1']": { background: "heat.1" },
            "&[data-step='2']": { background: "heat.2" },
            "&[data-step='3']": { background: "heat.3" },
            "&[data-step='4']": { background: "heat.4" },
            "&[data-step='5']": { background: "heat.5" },
        },
        /* The steps' lower edges, each at its swatch's start; the ramp's two rules wide. */
        heatTicks: {
            display: "flex", width: "202px", justifyContent: "space-between", fontFamily: "mono", fontSize: "label.xs", color: "fg.subtle",
            fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
        },
        /* A list (LST-1): its rows, edge to edge, scrolling inside its tile. */
        list: { display: "flex", flexDirection: "column", flex: "1", minWidth: "0", minHeight: "0", overflowY: "auto" },
        /* A row: 48 at least, padded 0 20, over a `--rule`; with the ranking bar (LST-2), its line over the bar, 6 apart, padded 10 20.
           Its words stand a whole number of pixels under its top edge, never centred (#1638): a name alone 16 under it, a
           name over its caption 8 — the middle of the 47 over the rule for the 16px line and for the 31px pair. Centred,
           the 32px pair of an Inter name stood half a pixel off, and so did every pair in the last row, which has no rule. */
        listRow: {
            display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: "6px", flexShrink: "0", minHeight: "48px", boxSizing: "border-box",
            paddingInline: "{spacing.5}", paddingTop: "16px", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
            "&[data-caption]": { paddingTop: "8px" },
            "&:last-of-type": { borderBottomWidth: "0" },
            "&[data-bar]": { paddingBlock: "10px" },
        },
        /* Its line: its name and caption, then its values with their units, 12 apart. */
        listLine: { display: "flex", alignItems: "baseline", gap: "{spacing.3}", minWidth: "0" },
        listText: { display: "flex", flexDirection: "column", gap: "1px", flex: "1", minWidth: "0" },
        /* Its name: 13 / 500 on a 16px line, `--ink`; its caption 12.5 on a 15px line, `--ink-4`; each cut with an ellipsis. */
        listName: { fontSize: "body", lineHeight: "16px", fontWeight: "500", color: "fg", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
        listCaption: { fontSize: "12.5px", lineHeight: "15px", color: "fg.subtle", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
        /* The ranking bar (LST-2): 4px, square, its first value against the largest in `--brand-d` on `--paper-3`. */
        listBar: { height: "4px", flexShrink: "0", background: "bg.subtle" },
        listBarFill: { height: "100%", background: "brand.solid" },
        /* A value: mono 13 / 500 on a 15px line, tabular; its unit mono 10.5 on a 13px line, `--ink-4`. Each on its
           face's own whole line, on the name's baseline: a taller line stood the row a pixel over its 63. */
        listValue: { fontFamily: "mono", fontSize: "body", lineHeight: "15px", fontWeight: "500", fontVariantNumeric: "tabular-nums", color: "fg", whiteSpace: "nowrap" },
        listUnit: { fontFamily: "mono", fontSize: "label.md", lineHeight: "13px", color: "fg.subtle", whiteSpace: "nowrap" },
    },
});
