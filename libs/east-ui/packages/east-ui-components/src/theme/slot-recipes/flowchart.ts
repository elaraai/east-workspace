/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Flowchart slot recipe — the state-transition flowchart per the
 * `Flowchart` design spec, in its builder frame (#1245): the root holding the
 * frame and the colours the canvas draws with; the freshness chip's dot (the
 * chip, a toolbar item, is the shared `chip`); the canvas filling main (lane
 * bands, node cards, H/V links), scrolling both ways in its own box and
 * selecting no text — a drag on it is a gesture — but its editors'; and the
 * 38px derived-count footer in the frame's footer, its rule its own, the
 * shared loading line at its trailing end (#1502). Node cards are 116×40 r6
 * with a mono 12/700 code line and a 10.5px muted label. It has no hover card
 * (#1250): the inspector (`flowchartInspector`) shows what is selected. The
 * selection (#1250) is marked here: a selected state's card and ↻ badge in
 * the brand's rule, a selected decision's diamond in the brand's tint and a
 * heavier rule, and a selected lane — a click on its header — ringed inside
 * its band, the ring under the states and the transitions' hit paths. A
 * flowchart with nothing to draw, and no gesture to start one, is the shared
 * empty state, centred in main. Where it edits (#1247), its gestures' controls are Font
 * Awesome's solid icons in the canvas's HTML layer: each lane's × beside its
 * header (off, dimmed, while the lane holds states; a 44px target on a coarse
 * pointer, by its halo), "+ LANE" at the band row's tail, its plus over its
 * word, and the "+ STATE" ghost's plus beside its word. The frame's own
 * regions are the `builderFrame` recipe's. Where a library card drops on the
 * canvas (#1249), the canvas is one drop cell whose own marks stand in for
 * the shared stage frame — the lane it lands in washed in the brand's tint,
 * dashed, with a brand line where the state lands; the state, the transition
 * (the brand wash) or the diamond it sets in the brand — each shown only while
 * the drag rests there and the drop lands; a refusal is the ghost's red
 * caption, and the not-allowed cursor. A library tab over a source of the
 * rail (#1346) is the shared schedule pane's body (`pane`), busy and taking
 * no gesture while its source resolves.
 *
 * Zoomed (`Flowchart Records Spec.md` R42), the canvas is drawn scaled from
 * its top-left corner (`canvasWrap`) inside a box of the size it is drawn at
 * (`canvasZoom`), which is what main scrolls; the View's controls — the zoom's
 * strip, with LR · TD where a rail folds it there — stand one over another
 * over Find's box (`toolbarControls`).
 *
 * Where the details draw on the cards (#1510, `Flowchart Records Spec.md`
 * R22–R34, R39), a card is 272 wide and as tall as its reads, in the visual
 * spec's looks: its head 54 inside its edge — the label, its ×n and ↻ n, over
 * the key — a rule, then each read 12 apart inside 12 of padding: a figure's
 * line; a tag list beside its label, each tag 15 high in its look; a title
 * over bars 28 high on a rule and their axis; a title over a list's rows, each
 * its name, a 56 track filled to its share, and the share; *no data* and
 * *none* in italics. Hovered, the card is `--paper-2`; selected, `--paper-3`
 * in a 1px `--ink` edge, its chips and neutral tags on `--paper`. A
 * transition's label draws its lines under its evidence, `--brand-dd` while
 * it is selected; a line not landed is a placeholder bar. The legend's rows
 * gain a row for each read the cards and labels draw, its mark beside its
 * words, and beside the rows, one over another, a group for each tag list it
 * lists. A tag's look
 * is its definition's (`tagLooks`): subtle in a palette, a 6% wash of it on a
 * 1px rule of it in its text step; gray, neutral or undefined, the Tag's own
 * neutral look; any other variant, the Tag recipe's in its palette, at the card's size. A
 * hidden probe measures a label and a tag as the card draws them, so a card
 * is measured before the layout places it.
 */

import { defineSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { conflictRing } from "../conflict-ring.js";
import { coarseHitArea } from "../../style/hit-area.js";
import { FOOTER_FIT } from "./builder-footer.js";
import { schedulePaneBase } from "./schedule-pane.js";

/** Where a drop is taken, and not refused (#1249): the stage the canvas's marks show on. */
const TAKEN = "[data-drop-active]:not([data-drop-invalid])";

/** A selected card with details: what draws on `--paper` there (R39). */
const SELECTED_CARD = "[data-details][data-selected]";

/**
 * A tag's looks (#1510, R30), by its `data-look`, shared by the card, the
 * legend and the inspector, each at its own size: `wash`, the default subtle
 * in a palette — a 6% wash of the palette's solid on a 1px rule of it, its
 * text the palette's text step; `neutral`, gray, neutral or no definition —
 * `--paper-3` on a 1px `--rule` in `--ink-3`, `--paper` on a selected card;
 * `recipe`, any other variant — the Tag recipe's look in the palette, drawn
 * by the Tag itself as `colored`, these slots giving it its size alone.
 */
export const tagLooks = {
    "&[data-look=wash]": {
        background: "color-mix(in oklch, {colors.colorPalette.solid} 6%, transparent)",
        borderColor: "colorPalette.solid",
        color: "colorPalette.fg",
    },
    "&[data-look=neutral]": {
        background: "bg.subtle",
        borderColor: "border.subtle",
        color: "fg.muted",
    },
    [`${SELECTED_CARD} &`]: { "&[data-look=neutral]": { background: "bg.surface" } },
} as const satisfies SystemStyleObject;

/** A read's label, as a card draws it: mono 9.5/600, 0.14em apart, in capitals, `--ink-4` (the visual spec's). */
const READ_LABEL = {
    fontFamily: "mono",
    fontSize: "9.5px",
    fontWeight: "600",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    lineHeight: "14px",
    color: "fg.subtle",
    whiteSpace: "nowrap",
} as const satisfies SystemStyleObject;

/** A tag at the card's size, as the card and the legend draw it: 15 high, mono 9.5/500, 4 in, r4, a 1px rule (R30). */
const CARD_TAG = {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    boxSizing: "border-box",
    height: "15px",
    /* The Tag's own least height never grows it: Chakra's, 20 at its size md. */
    minHeight: "15px",
    paddingX: "4px",
    paddingY: "0",
    gap: "0",
    borderWidth: "1px",
    borderStyle: "solid",
    borderRadius: "4px",
    fontFamily: "mono",
    fontSize: "9.5px",
    fontWeight: "500",
    lineHeight: "9.5px",
    whiteSpace: "nowrap",
    ...tagLooks,
} as const satisfies SystemStyleObject;

export const flowchartSlotRecipe = defineSlotRecipe({
    className: "elara-flowchart",
    slots: [
        "root", "freshnessDot", "toolbarControls",
        "body", "scroll", "canvasZoom", "canvasWrap",
        "node", "ghostNode", "nodeCode", "nodeLabel", "nodeBadge",
        "cardHead", "cardTitle", "cardName", "cardChip", "cardKey", "cardBody",
        "readLabel", "figure", "figureValue", "figureNumber", "figureUnit", "noData",
        "tags", "tagLines", "tagLine", "tag",
        "histogram", "bars", "bar", "axis", "tick",
        "list", "listRow", "listName", "listTrack", "listFill", "listShare",
        "placeholder", "measure",
        "laneDelete", "addLane", "laneSelected",
        "stateGhost", "stateEditor", "moveClone",
        "dropLane", "dropSeam",
        "legend", "legendRows", "legendTitle", "legendRow", "legendMark", "legendFigure", "legendGroups", "legendTags", "legendTagList",
        "minimap",
        "footer", "footerStrong", "footerMessage", "footerSplit",
        "empty",
        "pane",
    ],
    base: {
        /* Fills the box it is given and draws no border: the frame inside it
         * fills it in turn (#1245). The --fc-* variables name the design
         * system's colours (--ink-2 / --ink-3 / --ink-4 / --paper / --paper-2
         * / --rule-strong / --info / --brand / --brand-d / --brand-dd / --neg)
         * through the theme's one token for each, so both modes follow it —
         * SVG geometry consumes them directly. */
        root: {
            "--fc-ink":         "{colors.fg.strong}",
            "--fc-ink3":        "{colors.fg.muted}",
            "--fc-ink4":        "{colors.fg.subtle}",
            "--fc-paper":       "{colors.bg.surface}",
            "--fc-lane":        "{colors.bg.canvas}",
            "--fc-rule-strong": "{colors.border.strong}",
            "--fc-info":        "{colors.status.info}",
            "--fc-brand":       "{colors.brandMark}",
            "--fc-brand-d":     "{colors.brand.solid}",
            "--fc-brand-dd":    "{colors.brandPressed}",
            "--fc-neg":         "{colors.status.neg}",
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            minWidth: 0,
            minHeight: 0,
            position: "relative",
        },

        /* ── the freshness chip's dot — the chip itself is the shared
         *    `chip` recipe's, a toolbar item (#1245) ───────────────────── */
        /* The View popover's controls (R42): the zoom's strip, with LR · TD where a rail folds it there, over Find's box. */
        toolbarControls: {
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            gap: "{spacing.2}",
            marginBottom: "{spacing.3}",
        },
        freshnessDot: {
            width: "6px",
            height: "6px",
            borderRadius: "full",
            background: "status.pos",
            flexShrink: 0,
        },

        /* ── body — main's whole box; the canvas scrolls inside it ─────── */
        body: {
            flex: "1 1 0%",
            minWidth: 0,
            minHeight: 0,
            position: "relative",
        },
        /* Focusable, so a press inside it takes its keys (Del, #1247); a
         * press draws no ring — the selection says what Del deletes. A drag on
         * it is a gesture, never a selection of its text, as on the
         * Schematic's canvas: a card's words selected — by a drag, or by a
         * double-click into its rename — would turn the next drag begun on
         * them into the browser's own drag of the words, and the state would
         * never land. The inline editors' fields keep their text. */
        scroll: {
            position: "absolute",
            inset: 0,
            overflow: "auto",
            userSelect: "none",
            "& input": { userSelect: "text" },
            _focus: { outline: "none" },
        },
        /* What main scrolls (R42): a box of the size the canvas is drawn at,
         * the zoom's — the drawing's own box scaled inside it reaches its
         * edge, and the scroll no further. */
        canvasZoom: {
            position: "relative",
            overflow: "clip",
        },
        /* The canvas, and its one drop cell (#1249): its own marks stand in for
         * the shared stage's frame and wash over the whole canvas — most of
         * which refuses a transition's card — so the stage keeps only its
         * not-allowed cursor; the ghost's red caption says why. Zoomed (R42),
         * it is scaled from its top-left corner. */
        canvasWrap: {
            position: "absolute",
            top: 0,
            left: 0,
            transformOrigin: "0 0",
            "&[data-drag-cell][data-drop-valid]::before, &[data-drag-cell][data-drop-active]::before, &[data-drag-cell][data-drop-invalid]::before": { content: "none" },
            "&[data-drag-cell][data-drop-active], &[data-drag-cell][data-drop-invalid]": { background: "transparent" },
            "&[data-drag-cell][data-drop-invalid]::after": { content: "none" },
            /* The transition a card retypes takes the brand wash (FB32): a wide,
             * soft stroke under its line, as the selection's halo is drawn. */
            "& [data-flowchart-dropwash]": {
                display: "none",
                fill: "none",
                stroke: "var(--fc-brand)",
                strokeWidth: "12px",
                opacity: 0.3,
                pointerEvents: "none",
            },
            [`&${TAKEN} [data-flowchart-dropwash]`]: { display: "inline" },
            /* The decision a card sets takes the brand: its diamond's fill tinted, its rule the brand's. */
            [`&${TAKEN} [data-flowchart-trigger][data-drop-target] > rect`]: { fill: "brandTint", strokeWidth: "2px" },
            /* The decision selected (#1250): its diamond's fill tinted, its rule heavier — the inspector shows it. */
            "& [data-flowchart-trigger][data-selected] > rect": { fill: "brandTint", strokeWidth: "2.4px" },
            /* A transition, or its diamond, the narrowing leaves out (#1502, R6): drawn as context, selected by no path. */
            "& g[data-context]": { pointerEvents: "none" },
            /* A lane's name over its band (#1520): mono 12/600 in `--ink-4`, its caps spaced 2.6px. */
            "& [data-flowchart-lane]": {
                fontFamily: "mono",
                fontSize: "12px",
                fontWeight: "600",
                letterSpacing: "2.6px",
                fill: "fg.subtle",
            },
            /* A label's details lines under its evidence (#1510, R32): mono 10 in `--ink-3`, `--brand-dd` while its
             * transition is selected (R39); a line not landed, a placeholder bar the loading recipe's fill (R34). */
            "& [data-flowchart-label] [data-line=detail]": {
                fontFamily: "mono",
                fontSize: "10px",
                fontWeight: "400",
                fill: "fg.muted",
            },
            "& [data-flowchart-label][data-selected] [data-line=detail]": { fill: "brandPressed" },
            "& [data-flowchart-label] [data-line=placeholder]": { fill: "bg.subtle" },
        },

        /* ── node cards — 116×40, r6, mono code + muted label ─────────── */
        node: {
            position: "absolute",
            boxSizing: "border-box",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "6px",
            padding: "4px 10px",
            cursor: "pointer",
            "&[data-selected]": {
                borderWidth: "1.5px",
                borderColor: "brand.600",
            },
            /* A conflict not yet chosen: the warn ring at the node's edge; a selection keeps its edge inside it. */
            ...conflictRing,
            /* The state an author's card sets (#1249, FB33): the brand's tint and rule. */
            "&[data-drop-target]": {
                [`${TAKEN} > &`]: {
                    borderWidth: "1.5px",
                    borderColor: "brand.solid",
                    background: "brandTint",
                },
            },
            /* A state the narrowing leaves out (#1502, R6): drawn as context, faded by the canvas, selected by no path. */
            "&[data-context]": { pointerEvents: "none", cursor: "default" },
            /* A card with details (#1510, R22, R39): its head over its reads, edge to edge; hovered `--paper-2`;
             * selected `--paper-3` in a 1px `--ink` edge. */
            "&[data-details]": {
                display: "flex",
                flexDirection: "column",
                padding: "0",
                overflow: "hidden",
            },
            "&[data-details]:not([data-selected]):hover": { background: "bg.canvas" },
            [`&${SELECTED_CARD}`]: { background: "bg.subtle", borderWidth: "1px", borderColor: "fg" },
        },
        /* ── a card with details (#1510, R22–R34): the visual spec's ─────── */
        /* The head, 54 inside the card's edge: its label line over its key, 4 apart, 12 in, centred down. */
        cardHead: {
            flexShrink: 0,
            boxSizing: "border-box",
            height: "54px",
            paddingX: "12px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "4px",
            minWidth: 0,
        },
        cardTitle: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            height: "16px",
            minWidth: 0,
        },
        cardName: {
            flex: "1 1 auto",
            minWidth: 0,
            fontFamily: "body",
            fontSize: "13px",
            fontWeight: "500",
            lineHeight: "16px",
            color: "fg",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        /* ×n: the class's count, mono 10/600 `--ink-2` on `--paper-3`, `--paper` on a selected card. */
        cardChip: {
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            boxSizing: "border-box",
            height: "16px",
            paddingX: "4px",
            borderRadius: "4px",
            background: "bg.subtle",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            lineHeight: "10px",
            color: "fg.strong",
            whiteSpace: "nowrap",
            [`${SELECTED_CARD} &`]: { background: "bg.surface" },
        },
        cardKey: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "400",
            lineHeight: "14px",
            color: "fg.subtle",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        /* Its reads, under a rule: 12 apart inside 12 of padding, each its block. */
        cardBody: {
            flex: "1 1 auto",
            minHeight: 0,
            borderTopWidth: "1px",
            borderTopStyle: "solid",
            borderTopColor: "border.subtle",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            /* Each read keeps the block the canvas gives it. */
            "& > *": { flexShrink: 0 },
        },
        /* A read's label — a figure's, a tag list's beside its tags (15 high there, its column's width the canvas's),
         * a title over bars or a list. */
        readLabel: {
            ...READ_LABEL,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            "[data-read=tags] > &": { flexShrink: 0, lineHeight: "15px", overflow: "visible" },
        },
        /* A figure's line, 16: its label, and its value with its unit at the end. */
        figure: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            height: "16px",
            minWidth: 0,
        },
        figureValue: {
            flexShrink: 0,
            display: "flex",
            alignItems: "baseline",
            gap: "4px",
            fontFamily: "mono",
            whiteSpace: "nowrap",
        },
        figureNumber: { fontFamily: "mono", fontSize: "11px", fontWeight: "500", color: "fg", fontVariantNumeric: "tabular-nums" },
        figureUnit: { fontFamily: "mono", fontSize: "10px", fontWeight: "400", color: "fg.subtle" },
        /* *No data* and *none* (R33, R41): mono 10 italic `--ink-4` — 16 under a title, 15 in a tag list's place. */
        noData: {
            flexShrink: 0,
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "400",
            fontStyle: "italic",
            lineHeight: "16px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            "[data-tag-lines] > &": { lineHeight: "15px" },
        },
        /* A tag list beside its label, its lines 4 apart, its tags 4 apart on a line (R30). */
        tags: {
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
            minWidth: 0,
        },
        tagLines: {
            flex: "1 1 auto",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: "4px",
        },
        tagLine: {
            display: "flex",
            alignItems: "center",
            gap: "4px",
            height: "15px",
            whiteSpace: "nowrap",
        },
        tag: CARD_TAG,
        /* A histogram: its title over its bars and their axis, each 4 apart (R26, R28). */
        histogram: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 },
        /* The bars' box: 28 high on its 1px `--rule`, each bar 2 short of the next, its place and height the canvas's. */
        bars: {
            position: "relative",
            boxSizing: "border-box",
            height: "28px",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderBottomColor: "border.subtle",
        },
        bar: { position: "absolute", bottom: 0, background: "brand.solid" },
        axis: { position: "relative", height: "12px" },
        tick: {
            position: "absolute",
            top: 0,
            fontFamily: "mono",
            fontSize: "9.5px",
            fontWeight: "400",
            lineHeight: "12px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        /* A list: its title over its rows, 4 apart, each 16 — its name, a 56 track filled to its share, the share (R29). */
        list: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 },
        listRow: {
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 56px 32px",
            columnGap: "8px",
            alignItems: "center",
            height: "16px",
        },
        listName: {
            minWidth: 0,
            fontFamily: "body",
            fontSize: "12.5px",
            fontWeight: "400",
            lineHeight: "16px",
            color: "fg.strong",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        listTrack: { position: "relative", height: "4px", background: "border.subtle", overflow: "hidden" },
        listFill: { position: "absolute", top: 0, bottom: 0, left: 0, background: "brand.solid" },
        listShare: {
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "500",
            color: "fg",
            textAlign: "right",
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
        },
        /* A read not landed (R34): the shared placeholder shapes in its place — a bar in a figure's or a list row's
         * place, a chip in a tag list's, its host's box under a title. */
        placeholder: {
            display: "flex",
            alignItems: "center",
            minWidth: 0,
            "&[data-place=figure]": { justifyContent: "flex-end", width: "48px", height: "16px" },
            "&[data-place=tags]": { height: "15px" },
            "&[data-place=bars]": { height: "44px", borderRadius: "2px" },
            "&[data-place=row]": { height: "16px" },
        },
        /* What measures a label and a tag as the card draws them (#1510): out of sight and out of the way, each
         * child its own width. */
        measure: {
            position: "absolute",
            top: 0,
            left: 0,
            width: 0,
            height: 0,
            overflow: "hidden",
            visibility: "hidden",
            pointerEvents: "none",
            "& > *": { width: "max-content" },
        },
        ghostNode: {
            position: "absolute",
            boxSizing: "border-box",
            background: "bg.surface",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "status.neg",
            borderRadius: "6px",
            padding: "4px 10px",
            cursor: "pointer",
            "& > div:first-of-type": { color: "status.neg" },
            "&[data-context]": { pointerEvents: "none", cursor: "default" },
        },
        nodeCode: {
            fontFamily: "mono",
            fontSize: "12px",
            fontWeight: "700",
            lineHeight: "1.3",
            color: "fg",
            display: "flex",
            alignItems: "center",
            gap: "6px",
        },
        nodeLabel: {
            fontSize: "10.5px",
            color: "fg.muted",
            lineHeight: "1.1",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        nodeBadge: {
            marginLeft: "auto",
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "600",
            color: "fg.subtle",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "3px",
            padding: "0 3px",
            lineHeight: "1.4",
            whiteSpace: "nowrap",
            "& + &": { marginLeft: "4px" },
            /* In the legend's row, centred in its mark's box: the push to the end of a card's line is the card's alone. */
            "[data-legend-line] &": { marginLeft: "0" },
            /* The ↻ badge doubles as the folded self-loop's selection
             * surface — mirror the selected-node treatment. */
            "&[data-flowchart-inplace]": { cursor: "pointer" },
            "&[data-selected]": {
                color: "brand.600",
                borderColor: "brand.600",
                borderWidth: "1.5px",
            },
        },

        /* ── a lane's × and "+ LANE" (#1247) ─────────────────────────── */
        /* A lane's ×: Font Awesome's xmark, 14px square beside its header,
         * in the header's ink; off — faded, never a click — while the lane
         * holds states, its tooltip saying why. */
        laneDelete: {
            position: "absolute",
            zIndex: 1,
            boxSizing: "border-box",
            width: "14px",
            height: "14px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0",
            border: "none",
            background: "transparent",
            color: "fg.subtle",
            fontSize: "10px",
            cursor: "pointer",
            _hover: { color: "fg.muted" },
            "&[data-disabled]": { opacity: 0.4, cursor: "not-allowed", _hover: { color: "fg.subtle" } },
            ...coarseHitArea(),
        },
        /* "+ LANE": the band row's tail, full lane height, dashed rule-strong
         * r6 — Font Awesome's plus over the word in LR's tall column, beside
         * it on TD's wide band; mono 9px caps, 2px tracking, the header's ink. */
        addLane: {
            position: "absolute",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            gap: "8px",
            paddingTop: "22px",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "border.strong",
            borderRadius: "6px",
            background: "transparent",
            color: "fg.subtle",
            fontFamily: "mono",
            fontSize: "9px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            cursor: "pointer",
            "& svg": { fontSize: "12px" },
            _hover: { borderColor: "brand.600", color: "fg.muted" },
            "&[data-orientation='TD']": { flexDirection: "row", justifyContent: "center", alignItems: "center", paddingTop: "0" },
        },
        /* The lane selected (#1250) — a click on its header: its band ringed
         * in the brand's rule just inside its edge, solid where a drop's lane
         * is dashed, and no wash; under the states, and never a pointer's. */
        laneSelected: {
            position: "absolute",
            boxSizing: "border-box",
            pointerEvents: "none",
            outlineWidth: "1.5px",
            outlineStyle: "solid",
            outlineColor: "brand.solid",
            outlineOffset: "-2px",
        },

        /* ── "+ STATE" ghost + inline node editor + move clone ────────── */
        /* The ghost is the placement preview — dashed rule-strong, the
         * exact node footprint, Font Awesome's plus and "state" centred
         * (spec Flowchart.Lane). */
        stateGhost: {
            position: "absolute",
            boxSizing: "border-box",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "border.strong",
            borderRadius: "6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "1px",
            color: "fg.subtle",
            cursor: "pointer",
            background: "bg.surface",
            _hover: { borderColor: "brand.600", color: "fg.muted" },
        },
        /* Editing flips the dashed border to brand-d: a new state's key
         * auto-focused, its label below; a rename's key shown fixed (#1503,
         * R9) over its label. A key the Flowchart holds already reads in the
         * negative tone, refused as it is typed. */
        stateEditor: {
            position: "absolute",
            zIndex: 11,
            boxSizing: "border-box",
            background: "bg.surface",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "brand.600",
            borderRadius: "6px",
            padding: "3px 9px",
            display: "flex",
            flexDirection: "column",
            gap: "1px",
            "& > input": {
                fontFamily: "mono",
                fontSize: "12px",
                fontWeight: "700",
                background: "transparent",
                outline: "none",
                width: "100%",
            },
            "& > input[aria-invalid]": { color: "status.neg" },
            "& > input[data-flowchart-label]": {
                fontFamily: "body",
                fontSize: "10.5px",
                fontWeight: "400",
                color: "fg.muted",
            },
        },
        /* ── where a dropped card lands (#1249) ─────────────────────────── */
        /* The lane a state lands in, or whose header a card sets: the band
         * washed in the brand's tint under the states, a dashed brand rule
         * inside its edge — the candidate band a moved state's is. */
        dropLane: {
            position: "absolute",
            display: "none",
            boxSizing: "border-box",
            pointerEvents: "none",
            background: "brandTint",
            outlineWidth: "1.5px",
            outlineStyle: "dashed",
            outlineColor: "brand.solid",
            outlineOffset: "-3px",
            [`${TAKEN} > &`]: { display: "block" },
        },
        /* Where the state lands: a 2px brand line across the node's footprint,
         * centred on the seam between the states either side of it — level in
         * LR, upright in TD. Where a lane lands (#1501, D5): the line runs the
         * gap between two lanes, or past the last, the band row's whole depth —
         * upright in LR, level in TD. A state moved between two cards (#1503,
         * D4) marks where it lands with the same line, shown while it moves.
         * Its place and length are the canvas's. */
        dropSeam: {
            position: "absolute",
            display: "none",
            pointerEvents: "none",
            zIndex: 2,
            background: "brand.solid",
            borderRadius: "full",
            height: "2px",
            marginTop: "-1px",
            "&[data-orientation='TD']": { height: "auto", width: "2px", marginTop: "0", marginLeft: "-1px" },
            "&[data-flowchart-gap]": { height: "auto", width: "2px", marginTop: "0", marginLeft: "-1px" },
            "&[data-flowchart-gap][data-orientation='TD']": { width: "auto", height: "2px", marginLeft: "0", marginTop: "-1px" },
            [`${TAKEN} > &`]: { display: "block" },
            "&[data-flowchart-move]": { display: "block" },
        },
        /* Translucent clone following the pointer during a cross-lane drag. */
        moveClone: {
            position: "absolute",
            zIndex: 12,
            pointerEvents: "none",
            boxSizing: "border-box",
            width: "116px",
            height: "40px",
            background: "bg.surface",
            opacity: 0.85,
            borderWidth: "1.5px",
            borderColor: "brand.600",
            borderRadius: "6px",
            padding: "4px 10px",
        },

        /* ── legend — its rows, and 24 beside them its groups of tags, a group
         *    for each tag list it lists, one over another (#1510, R31) ──────── */
        legend: {
            position: "absolute",
            left: "16px",
            bottom: "16px",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "6px",
            padding: "10px 14px",
            display: "flex",
            alignItems: "flex-start",
            gap: "24px",
        },
        legendRows: { display: "flex", flexDirection: "column", gap: "6px" },
        legendTitle: {
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "600",
            letterSpacing: "2px",
            textTransform: "uppercase",
            lineHeight: "11.25px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        /* A row, 16: its mark in a 28 × 16 box, then its words. */
        legendRow: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            height: "16px",
            fontSize: "10.5px",
            color: "fg.muted",
            whiteSpace: "nowrap",
        },
        /* A read's mark (R31): bars on a `--rule-strong` base, a list's lines and shares, a label's badge and its two lines. */
        legendMark: {
            flexShrink: 0,
            width: "28px",
            height: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            "& [data-mark=bar]": { fill: "brand.solid" },
            "& [data-mark=base]": { stroke: "border.strong", strokeWidth: "1px" },
            "& [data-mark=share]": { fill: "fg" },
            "& [data-mark=badge]": { fill: "bg.surface", stroke: "border.strong", strokeWidth: "1px" },
            "& [data-mark=line]": { stroke: "fg.strong", strokeWidth: "1.6px" },
            "& [data-mark=detail]": { stroke: "fg.muted", strokeWidth: "1.2px" },
        },
        /* A figure's mark: "123", mono 9.5/600 `--ink`. */
        legendFigure: { fontFamily: "mono", fontSize: "9.5px", fontWeight: "600", color: "fg" },
        /* Its groups of tags, one column: each under the last, 12 apart, the first level with the rows. */
        legendGroups: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 },
        legendTags: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 },
        /* A group's tags, at the card's size, wrapping 4 apart across at most 236. */
        legendTagList: { display: "flex", flexWrap: "wrap", gap: "4px", maxWidth: "236px" },

        /* ── minimap ──────────────────────────────────────────────────── */
        minimap: {
            position: "absolute",
            right: "16px",
            bottom: "16px",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "6px",
            padding: "6px",
            lineHeight: 0,
        },

        /* ── footer — 38px, derived counts, in the frame's footer; the shared
         *    loading line at its trailing end, fitted to what it leaves (#1502) ── */
        footer: {
            ...FOOTER_FIT,
            height: "38px",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: "1.5",
            paddingX: "3",
            borderTopWidth: "1px",
            borderColor: "border.subtle",
            fontFamily: "mono",
            fontSize: "10.5px",
            color: "fg.muted",
            whiteSpace: "nowrap",
            overflow: "hidden",
            /* A phone's: every count in sight, on as many lines as they take. */
            "[data-phone] &": { height: "auto", minHeight: "38px", flexWrap: "wrap", rowGap: "1", paddingY: "2", whiteSpace: "normal" },
        },
        footerStrong: { color: "fg", fontWeight: "700" },
        /* Why a card's ⏎ was refused (#1249): the footer's own ink, taking the rail's slack, cut short before the split. */
        footerMessage: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
        footerSplit: { marginLeft: "auto", color: "fg.subtle", flexShrink: 0, "[data-phone] &": { marginLeft: "0" } },

        /* Nothing to draw, and no gesture to start one: the shared empty state, centred in main. */
        empty: {
            flex: "1 1 0%",
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "auto",
        },

        /* ── a library tab over a source of the rail (#1346): the shared
         *    schedule pane's body, as the Sheet's tabs take it ──────────── */
        pane: schedulePaneBase.pane,
    },
});
