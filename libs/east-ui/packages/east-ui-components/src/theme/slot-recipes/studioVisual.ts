/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio visual slot recipe — the parts a Studio visual's tile lays out
 * around the parts it draws with (#1671): its eyebrow strip, the spec's frame
 * eyebrow — its name, then its meta and its menu at the end (TIL-1, TIL-2) —
 * over its body; a KPI's number and unit, its change at their row's end, its
 * goal's bar with its tick, its trend and its one line of annotation; a
 * pivot's heat legend — its five steps on the
 * heat tokens, each 40 × 12 inside a `--rule`, their lower edges under them in
 * mono 9.5 `--ink-4` (TBL-4); the line that says what a visual holds of
 * how many; and its states (TIL-3) — its messages, each centred in its body
 * in one look: the checklist of the wells it needs, a follower's prompt to
 * pick on its leader (LNK-5), a field its source lacks, a source or a date
 * range it cannot read; and what stands where its drawing would: `no data`,
 * and the blocks in its shape while its answer is awaited. Every
 * numeral is mono and tabular, every label mono at the label sizes (TIL-5);
 * colour is the theme's alone.
 *
 * A KPI stands whole at every width a page gives its tile (#1692): its
 * number's row wraps — the change on a line of its own under the number, the
 * unit under the number where the two do not fit — and its number steps down
 * the design system's sizes, 26 to 20 to 16, as its own width narrows, so the
 * longest number a KPI prints (nine characters: a negative amount under ten
 * thousand, with its cents) is never cut. Its annotation stays one line,
 * ended in an ellipsis, its whole on hover.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { fontAwesomeSize } from "../icon-size.js";
import { centredLine } from "../one-line-box.js";

/** The room a tile's eyebrow strip centres its row in: its 36px less its rule and the pixel of padding over the row. */
const HEAD_ROOM = 34;

/**
 * Under these widths a KPI's number steps down a size: the longest number it prints — nine characters, a mono
 * face's 0.615em each — takes 144px at 26px and 111px at 20px (#1692).
 */
const KPI_AT_20 = "@container (max-width: 143.98px)";
const KPI_AT_16 = "@container (max-width: 110.98px)";

/**
 * Under this width a tile's foot stands its note and its pager on a line each (#1692): under 360px a pager draws its
 * readout (#1268), and its room beside a note would hold neither whole.
 */
const FOOT_STACKED = "@container (max-width: 359.98px)";

export const studioVisualSlotRecipe = defineSlotRecipe({
    className: "elara-studio-visual",
    slots: [
        "tile", "head", "name", "end", "meta", "follow", "body", "root", "caption", "note", "table", "foot",
        "kpi", "kpiRow", "kpiValue", "kpiNumber", "kpiUnit", "kpiChange", "absent", "goal", "goalTick", "trend", "anno",
        "heat", "heatRamp", "heatSwatch", "heatTicks",
        "list", "listRow", "listLine", "listText", "listName", "listCaption", "listValues", "listPair", "listValue", "listUnit", "listBar", "listBarFill",
        "state", "message", "empty", "emptyIcon", "emptyTitle", "emptyHint", "checks", "check", "checkMark", "missing", "missingLine", "missingIcon", "code", "link", "load", "loadBlock",
        "bell", "alerts", "alertRow", "alertName", "alertStatus", "alertNow", "alertNowHead", "alertNowLabel", "alertTable", "alertFoot",
    ],
    base: {
        /* A visual's tile: its eyebrow strip over its body, filling the frame, edge to edge. */
        tile: { display: "flex", flexDirection: "column", minWidth: "0", minHeight: "0", height: "100%" },
        /* The eyebrow strip: 36 on `--paper-2` over a `--rule`, padded 0 20. A pixel of padding over its row balances
           the rule under it (#1638), as a builder's toolbar does: its row is centred in an even 34px, so its 24px menu
           stands 6px under the strip's top edge and its words 12px. Centred in the 35px over the rule, as the mock
           draws it, each stood half a pixel off, and a page painted it a row higher or lower by where it stood the tile. */
        head: {
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "{spacing.1}",
            height: "36px", boxSizing: "border-box", paddingInline: "{spacing.5}", paddingTop: "1px", flexShrink: "0", minWidth: "0",
            background: "bg.canvas", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
        },
        /* Its name: mono 10 / 600, tracked 0.14em, uppercase, `--ink`, cut with an ellipsis; on a whole, even line; 12 before
           what follows it. */
        name: {
            fontFamily: "mono", fontSize: "label.sm", fontWeight: "semibold", letterSpacing: "label", textTransform: "uppercase", lineHeight: centredLine(HEAD_ROOM, 12),
            color: "fg", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: "0", marginInlineEnd: "{spacing.2}",
        },
        /* Its meta and its menu, at the end, 4 apart. It draws no box of its own, so each of its parts is the strip's own:
           where the strip is short its words give way before its name (#1692) — its meta, or what it follows, cut first,
           then its name — and its controls never. */
        end: { display: "contents", "& > :first-child": { marginInlineStart: "auto" } },
        /* Its meta: mono 9.5, `--ink-4`, on the name's line; cut with an ellipsis, its whole on hover. */
        meta: {
            fontFamily: "mono", fontSize: "label.xs", lineHeight: centredLine(HEAD_ROOM, 12), color: "fg.subtle",
            flexShrink: "100", minWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        },
        /* What it follows (LNK-4): the 10px link icon, 6 before the selected value, as its meta is set — in `--brand-d`
           while it is narrowed, `--ink-4` with nothing selected or its leader removed; cut with an ellipsis before its meta. */
        follow: {
            display: "inline-flex", alignItems: "center", gap: "6px", flexShrink: "100", minWidth: "0", maxWidth: "160px",
            fontFamily: "mono", fontSize: "label.xs", lineHeight: centredLine(HEAD_ROOM, 12), color: "fg.subtle", whiteSpace: "nowrap",
            "& > span": { overflow: "hidden", textOverflow: "ellipsis" },
            "& svg": { fontSize: "10px", flexShrink: "0" },
            "&[data-following='selected']": { color: "brand.solid" },
        },
        /* Its body, padded 20; its parts 12 apart. A table's or a list's rows run edge to edge, under the strip. */
        body: {
            display: "flex", flexDirection: "column", gap: "{spacing.3}", flex: "1", minWidth: "0", minHeight: "0", padding: "{spacing.5}",
            "&[data-flush]": { padding: "0", gap: "0" },
        },
        /* A visual's body: its part, then its note. */
        root: { display: "flex", flexDirection: "column", gap: "{spacing.2}", minWidth: "0", minHeight: "0", height: "100%" },
        /* A line over a chart's plot that says what its axes are, where a legend would sit: mono 10.5 / 500 `--ink-4` on
           the legend's 13px line, 12 over the plot with the body's gap. */
        caption: { fontFamily: "mono", fontSize: "label.md", fontWeight: "500", lineHeight: "13px", color: "fg.subtle", flexShrink: "0", marginBottom: "{spacing.1}" },
        /* What it holds of how many — `Showing 500 of 1,240 groups`: mono 10 `--ink-4`, on a whole 12px line; one line, ended in
           an ellipsis where its tile is too narrow for it, its whole on hover (#1692). */
        note: {
            fontFamily: "mono", fontSize: "label.sm", fontVariantNumeric: "tabular-nums", lineHeight: "12px", color: "fg.subtle", flexShrink: "0",
            minWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        },
        /* A table, taking the room its foot leaves; a wide one scrolls inside it (TBL-5). */
        table: { flex: "1", minWidth: "0", minHeight: "0", display: "flex", flexDirection: "column" },
        /* Under a table: where its page stands, and its pages — the Frame's footer band, 37 with its `--rule`, on the
           strip's paper, padded 0 20. Its 24px pager and its 12px line are each centred in the even 36 under the rule, on
           one line: the pager's room the rest of the line — the room it reads to draw its strip or its readout (#1268) —
           and its strip at the room's end, as the room's justification places it. In a foot under 360px the note and the
           pager each take a line, 4 apart, the pager's room the whole line (#1692). */
        foot: {
            display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", justifyContent: "flex-end", columnGap: "{spacing.3}", rowGap: "{spacing.1}",
            flexShrink: "0", minHeight: "37px", boxSizing: "border-box", paddingInline: "{spacing.5}", paddingBlock: "6px",
            background: "bg.canvas", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle",
            containerType: "inline-size",
            [FOOT_STACKED]: { "& > *": { gridColumn: "1 / -1" } },
        },
        /* A KPI (KPI-1, KPI-3): its number's row, its goal's bar, its trend and its annotation, 8 apart, each gone with its well.
           Its width is what its number's size answers (#1692). */
        kpi: { display: "flex", flexDirection: "column", gap: "{spacing.2}", minWidth: "0", containerType: "inline-size" },
        /* The number's row: the number with its unit, and the change at the row's end, on one baseline — the change on a
           line of its own, at the start, where the row has no room for it beside them. */
        kpiRow: { display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", columnGap: "{spacing.2}", rowGap: "6px", minWidth: "0" },
        /* The number with its unit: the unit under the number where the two do not fit on a line. */
        kpiValue: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: "{spacing.1}", minWidth: "0" },
        /* The number: mono 26 / 600, tabular, on its own 26px line at the body's top; narrower, 20 on 20, then 16 on 16. */
        kpiNumber: {
            textStyle: "num-lg", fontSize: "{fontSizes.num}", lineHeight: "26px", color: "fg", whiteSpace: "nowrap",
            [KPI_AT_20]: { fontSize: "{fontSizes.title.lg}", lineHeight: "20px" },
            [KPI_AT_16]: { fontSize: "{fontSizes.title.sm}", lineHeight: "16px" },
        },
        /* Its unit: a small label, mono 10.5 `--ink-4`, 4 after it. */
        kpiUnit: { fontFamily: "mono", fontSize: "label.md", lineHeight: "13px", color: "fg.subtle", whiteSpace: "nowrap" },
        /* The change: the DeltaPill, kept whole. */
        kpiChange: { display: "inline-flex", flexShrink: "0" },
        /* A value with none to show, in words: mono 14 italic `--ink-4`, on the number's line. */
        absent: { fontFamily: "mono", fontSize: "14px", fontStyle: "italic", fontWeight: "400", lineHeight: "26px", color: "fg.subtle", whiteSpace: "nowrap" },
        /* The goal: the progress bar's square 6px track, a 1 × 12 `--ink-3` tick at the goal — the track's end — 3 past it either way. */
        goal: { position: "relative", flexShrink: "0" },
        goalTick: { position: "absolute", insetInlineEnd: "0", top: "-3px", width: "1px", height: "12px", background: "fg.muted", pointerEvents: "none" },
        trend: { height: "36px", width: "100%", flexShrink: "0" },
        /* The annotation: one line, mono 10 `--ink-4`, on a 15px line; where it runs past its width, ended in an ellipsis, its
           whole on hover. */
        anno: {
            fontFamily: "mono", fontSize: "label.sm", lineHeight: "15px", color: "fg.subtle",
            minWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        },
        /* A pivot's heat legend (TBL-4): under the grid on the tile's own surface, over a `--rule`, padded 12 20 16 —
           its ramp over its steps' lower edges, 4 apart. */
        heat: {
            display: "flex", flexDirection: "column", gap: "{spacing.1}", flexShrink: "0", minWidth: "0", padding: "12px 20px 16px",
            borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle",
        },
        /* Its five steps, 40 each inside its `--rule`; in a tile too narrow for them, each an equal share of its room (#1692). */
        heatRamp: { display: "flex", width: "100%", maxWidth: "202px", boxSizing: "border-box", borderWidth: "1px", borderStyle: "solid", borderColor: "border.subtle" },
        heatSwatch: {
            flex: "1 1 0", minWidth: "0", height: "12px",
            "&[data-step='1']": { background: "heat.1" },
            "&[data-step='2']": { background: "heat.2" },
            "&[data-step='3']": { background: "heat.3" },
            "&[data-step='4']": { background: "heat.4" },
            "&[data-step='5']": { background: "heat.5" },
        },
        /* The steps' lower edges, each at its swatch's start; as wide as the ramp. */
        heatTicks: {
            display: "flex", width: "100%", maxWidth: "202px", columnGap: "{spacing.1}", justifyContent: "space-between",
            fontFamily: "mono", fontSize: "label.xs", lineHeight: "11px", color: "fg.subtle", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
        },
        /* A state that stands in for the visual's own drawing (TIL-3) — `no data` where its value would be, the blocks in its
           shape while it is awaited — where the drawing would stand. A table's or a list's body runs edge to edge: its state
           pads itself as any other body is padded. */
        state: { display: "flex", flexDirection: "column", minWidth: "0", "[data-flush] > &": { padding: "{spacing.5}" } },
        /* A message in place of the visual's drawing (TIL-3) — the wells it needs, a follower's prompt (LNK-5), a field its
           source lacks, a source or a date range it cannot read — centred in the body at whatever height its tile stands:
           every visual's message, one look. In a tile its own height, as the spec draws it, its own padding stands it 28 or
           32 under the eyebrow and over the foot. */
        message: {
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: "1", minWidth: "0", minHeight: "0",
            "[data-flush] > &": { padding: "{spacing.5}" },
        },
        /* Wells it needs: the view's icon at 28 in `--rule-strong`, the words, and the checklist — centred, 12 apart, 32 from the
           body's top and bottom (12 past its padding). A follower's prompt (LNK-5) is the smaller of the two: a pointer's hand
           at 24, what to pick and what it then shows — 10 apart, 28 from the body's top and bottom, each line centred. */
        empty: {
            display: "flex", flexDirection: "column", alignItems: "center", gap: "{spacing.3}", paddingBlock: "{spacing.3}",
            "&[data-prompt]": { gap: "10px", paddingBlock: "{spacing.2}", textAlign: "center" },
        },
        emptyIcon: { color: "border.strong", ...fontAwesomeSize("28px"), "[data-prompt] > &": fontAwesomeSize("24px") },
        emptyTitle: { fontFamily: "heading", fontSize: "{fontSizes.title.xs}", fontWeight: "700", letterSpacing: "-0.01em", lineHeight: "20px", color: "fg", margin: "0" },
        /* What a prompt's visual then shows: 12.5 on a whole 15px line, `--ink-4`. */
        emptyHint: { fontSize: "{fontSizes.body.sm}", lineHeight: "15px", color: "fg.subtle", margin: "0" },
        /* The checklist: a 16px line each, 6 apart — what is chosen in `--ink` after a 14px `--pos` check, what is missing in
           `--ink-3` after a 10px `--ink-5` dot, each mark centred in 14. */
        checks: { display: "flex", flexDirection: "column", gap: "6px", margin: "0", padding: "0", listStyle: "none" },
        check: { display: "flex", alignItems: "center", gap: "{spacing.2}", fontSize: "{fontSizes.body}", lineHeight: "16px", color: "fg.muted", "&[data-done]": { color: "fg" } },
        /* Font Awesome sizes its mark in ems, outside the recipes' layer: the mark's size is this box's font size. */
        checkMark: {
            display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", width: "14px", height: "14px", color: "fg.faint",
            fontSize: "10px", lineHeight: 1, "--fa-width": "1em",
            "[data-done] > &": { color: "status.pos", fontSize: "14px" },
        },
        /* A field its source lacks: a 16px line — a 14px `--neg` exclamation, the words, the field's name as code — over the link that mends it, 6 apart. */
        missing: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px" },
        missingLine: { display: "flex", alignItems: "center", gap: "{spacing.2}", minWidth: "0", fontSize: "{fontSizes.body}", lineHeight: "16px", color: "fg" },
        missingIcon: { flex: "none", color: "status.neg", ...fontAwesomeSize("14px") },
        /* On a 14px line of its own: with its pixel of padding over and under, the 16 of the line it stands in — the
           line's own 16 would stand the mono face's box half a pixel past it. */
        code: { fontFamily: "mono", fontSize: "0.92em", lineHeight: "14px", background: "bg.subtle", borderRadius: "sm", padding: "1px 5px" },
        /* The link role: 12.5 / 500 `--brand-d`, underlined on hover. */
        link: {
            all: "unset", cursor: "pointer", fontSize: "{fontSizes.body.sm}", fontWeight: "500", lineHeight: "15px", color: "brand.solid",
            _hover: { textDecoration: "underline" }, _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "2px" },
        },
        /* While its answer is awaited: Skeleton blocks in the visual's own shape, 10 apart — a KPI's number 112 × 26 over a 192 × 10
           line; a chart's plot; a table's or a list's rows, a 10px bar in each 36. */
        load: { display: "flex", flexDirection: "column", gap: "10px", minWidth: "0", "&[data-shape=rows]": { gap: "26px", paddingBlock: "13px" } },
        loadBlock: {
            flex: "none", maxWidth: "100%", borderRadius: "sm",
            "&[data-block=number]": { width: "112px", height: "26px" },
            "&[data-block=line]": { width: "192px", height: "10px" },
            "&[data-block=plot]": { width: "100%", height: "96px" },
            /* A row's bar: no two the same width, as a table's values are not. */
            "&[data-block=row]": { height: "10px", width: "62%", "&[data-row='1']": { width: "84%" }, "&[data-row='2']": { width: "48%" }, "&[data-row='3']": { width: "71%" } },
        },
        /* A list (LST-1): its rows, edge to edge, scrolling inside its tile. */
        list: { display: "flex", flexDirection: "column", flex: "1", minWidth: "0", minHeight: "0", overflowY: "auto" },
        /* A row: 48 at least, padded 0 20, over a `--rule`; with the ranking bar (LST-2), its line over the bar, 6 apart, padded 10 20.
           Its words stand a whole number of pixels under its top edge, never centred (#1638): a name alone 16 under it, a
           name over its caption 8 — the middle of the 47 over the rule for the 16px line and for the 31px pair. Centred,
           the 32px pair of an Inter name stood half a pixel off, and so did every pair in the last row, which has no rule. */
        listRow: {
            display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: "6px", flexShrink: "0", minHeight: "48px", boxSizing: "border-box",
            /* 8 under its words where they run past one line — its values under its name (#1692): a row of one line stands its
               48 still. */
            paddingInline: "{spacing.5}", paddingTop: "16px", paddingBottom: "{spacing.2}",
            borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
            "&[data-caption]": { paddingTop: "8px" },
            "&:last-of-type": { borderBottomWidth: "0" },
            "&[data-bar]": { paddingBlock: "10px" },
            /* A row a click selects, filters or opens by: a button. Selected, `--paper-3` (LST-3). */
            "&[data-clickable]": {
                cursor: "pointer",
                _hover: { background: "bg.canvas" },
                _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "-2px" },
            },
            "&[data-selected], &[data-selected]:hover": { background: "bg.subtle" },
        },
        /* Its line: its name and caption, then its values with their units, 12 apart. Where the row has no room for its words
           beside its values, the values take a line of their own under them, 4 apart (#1692): the words keep their whole
           width before they are cut — the row's whole, past which they end in an ellipsis. */
        listLine: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: "{spacing.3}", rowGap: "{spacing.1}", minWidth: "0" },
        listText: { display: "flex", flexDirection: "column", gap: "1px", flex: "1 0 auto", minWidth: "0", maxWidth: "100%" },
        /* Its values, at the line's end, or the end of a line of their own: each with its unit, and where the line has no room
           for them all, on as many lines as they need, never a value apart from its unit. */
        listValues: {
            display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "flex-end", columnGap: "{spacing.3}", rowGap: "{spacing.1}",
            marginInlineStart: "auto", minWidth: "0", maxWidth: "100%",
        },
        listPair: { display: "flex", alignItems: "baseline", gap: "{spacing.3}", flexShrink: "0", whiteSpace: "nowrap" },
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
        /* A visual's bell (#1674): the menu's ghost icon button beside it — in `--neg` while one of its alerts fires. */
        bell: { "&[data-firing]": { color: "status.neg" } },
        /* Its popover's list of the visual's alerts: rows edge to edge, as the popover's flush body runs them. */
        alerts: { display: "flex", flexDirection: "column", margin: "0", padding: "0", listStyle: "none" },
        /* An alert's row: its name over where it stands, a button — 48 at least, padded 8 14, over a `--rule`. */
        alertRow: {
            all: "unset", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "2px", width: "100%", minHeight: "48px",
            paddingBlock: "8px", paddingInline: "14px", cursor: "pointer",
            borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
            _hover: { background: "bg.canvas" },
            _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "-2px" },
        },
        /* Its name: 13 / 500 on a 16px line, `--ink`, cut with an ellipsis; where it stands, mono 10 on a 12px line, `--ink-4`,
           `--neg` while it fires. */
        alertName: { fontSize: "body", lineHeight: "16px", fontWeight: "500", color: "fg", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
        alertStatus: { fontFamily: "mono", fontSize: "label.sm", lineHeight: "12px", color: "fg.subtle", "&[data-status='firing']": { color: "status.neg" } },
        /* Now: its eyebrow and Run on one line, over the rows that meet the condition now, then how many — 8 apart. */
        alertNow: { display: "flex", flexDirection: "column", gap: "{spacing.2}", minWidth: "0" },
        alertNowHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "{spacing.2}", minHeight: "24px" },
        /* Its eyebrow: as a tile's name is set, `--ink-4`. */
        alertNowLabel: {
            fontFamily: "mono", fontSize: "label.sm", fontWeight: "semibold", letterSpacing: "label", textTransform: "uppercase", lineHeight: "12px", color: "fg.subtle",
        },
        /* Its table: 180 tall inside a `--rule`, scrolling inside it. */
        alertTable: {
            display: "flex", flexDirection: "column", height: "180px", minWidth: "0",
            borderWidth: "1px", borderStyle: "solid", borderColor: "border.subtle",
        },
        /* Where an alert's editor draws its foot's actions: no box of its own, so they lie in the foot's own row. */
        alertFoot: { display: "contents" },
    },
});
