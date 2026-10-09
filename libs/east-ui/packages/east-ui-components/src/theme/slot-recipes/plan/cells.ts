/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan recipe's CELLS — what is quantised to a bucket: heat, weight and
 * segment cells, bucket cells and their tiles, cards chips, and table numerals.
 *
 * One part of the Plan slot recipe (`../plan.ts`, #817), over semantic tokens
 * and the canvas's geometry variables (e3-ui-components' `plan/geometry.ts`).
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";
import { coarseHitArea } from "../../../style/hit-area.js";
import { lifecycleStates } from "./states.js";
import { PLAN_OVERLAP_RING, planElementDrafted, planElementFocus, planElementSelected } from "./focus.js";

/** The slots this part styles. */
export const cellsSlots = [
    "heatCell", "heatLabel", "weightBar", "segmentTrack", "segmentPart", "cellWash", "cell", "cellTiles",
    "tile", "tileLabel", "tileMore", "laneLabel", "markerIcon", "cardChip", "cardChipIcon", "cardChipLabel", "tableCellText", "tableCellGroup", "tableCellPart",
] as const;

/**
 * A cell that draws a number whole or not at all (#1269): a wrapping row whose
 * first line a strut holds at the cell's height, so a number wider than the
 * line wraps below it, out of sight in the cell's clip — never cut, never
 * ellipsized. The cell's hover then says it.
 */
const wholeOrNone = {
    flexWrap: "wrap",
    alignContent: "flex-start",
    "&::before": { content: '""', height: "100%" },
} satisfies SystemStyleObject;

/** Their base styles — typed whole: the shared tap halo's style object is too wide to infer into them. */
export const cellsBase: Record<(typeof cellsSlots)[number], SystemStyleObject> = {
    // ── Heat rows (min-height 16, r2, 3px margins; depth is data-driven) ──
    heatCell: {
        position: "absolute",
        top: "var(--plan-heat-inset-h)",
        bottom: "var(--plan-heat-inset-h)",
        borderRadius: "2px",
        minHeight: "var(--plan-heat-cell-min-h)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        // Its value whole, or not drawn (#1269).
        ...wholeOrNone,
        zIndex: 2,
        // No-data: 45° hatch + the em-dash (content set by the renderer).
        "&[data-nodata]": {
            backgroundImage:
                "repeating-linear-gradient(45deg, transparent 0 3px, color-mix(in srgb, {colors.fg} 7%, transparent) 3px 4px)",
        },
        "&[data-warn]": { boxShadow: "inset 0 0 0 1.5px {colors.status.warn}" },
        // The cell's step on the design system's heat ramp (#949) — five
        // steps, `--heat-1` … `--heat-5`, in each theme; `heatLabel` inks the
        // value to match. A level counts from 0, a step from 1.
        "&[data-level='0']": { background: "heat.1" },
        "&[data-level='1']": { background: "heat.2" },
        "&[data-level='2']": { background: "heat.3" },
        "&[data-level='3']": { background: "heat.4" },
        "&[data-level='4']": { background: "heat.5" },
        // ── R2 VALUE → TONE STRIP — the reference case (#591) ──
        // A heat row IS the tone strip that chart and table collapse INTO,
        // so there is nothing to convert: drop the 3px inset and centre a
        // 7px band. The colour ramp — the whole information — survives.
        "&[data-ctx]": {
            top: "50%",
            bottom: "auto",
            transform: "translateY(-50%)",
            height: "var(--plan-strip-mark-h)",
            minHeight: 0,
            borderRadius: "1px",
            transition: "height 380ms cubic-bezier(0.16, 1, 0.3, 1)",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        },
        ...planElementFocus,
    },
    // A heat value (#949) — 10.5px, in the ink the design system pairs with
    // its cell's step: `--ink` on steps 1–3, `--paper` on 4–5 (charts.md ›
    // Sequential ramp), at least 4.5:1 on that step in both themes.
    heatLabel: {
        fontFamily: "mono",
        fontSize: "10.5px",
        fontWeight: "semibold",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        "&[data-level='0'], &[data-level='1'], &[data-level='2']": { color: "fg" },
        "&[data-level='3'], &[data-level='4']": { color: "bg.surface" },
        // No data: the em-dash on the hatch, in the label ink.
        "&:not([data-level])": { color: "fg.subtle" },
        "&[data-ctx]": { display: "none" },
    },
    // The Matrix `.wbar`: a single left-anchored bar (no track) at the
    // span-bar height; planned buckets render pale.
    weightBar: {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        height: "var(--plan-weight-h)",
        borderRadius: "2px",
        background: "{colors.brand.solid}",
        zIndex: 2,
        "&[data-planned]": {
            background: "color-mix(in srgb, {colors.brand.solid} 45%, {colors.bg.surface})",
        },
        ...planElementFocus,
    },
    segmentTrack: {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        height: "var(--plan-segment-h)",
        borderRadius: "2px",
        display: "flex",
        overflow: "hidden",
        zIndex: 2,
        ...planElementFocus,
    },
    segmentPart: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "semibold",
        color: "bg.surface",
        overflow: "hidden",
        whiteSpace: "nowrap",
        // Its label whole, or not drawn (#1269).
        ...wholeOrNone,
        // The fill names its meaning (the Matrix `.segbar` vocabulary on
        // tokens, #949): slack is the 45° hatch and free the faint wash, both
        // light enough that their label prints in the muted ink.
        "&[data-fill='brand']":   { background: "brand.solid" },
        "&[data-fill='success']": { background: "{colors.status.pos}" },
        "&[data-fill='warning']": { background: "{colors.status.warn}" },
        "&[data-fill='danger']":  { background: "{colors.status.neg}" },
        "&[data-fill='info']":    { background: "{colors.status.info}" },
        "&[data-fill='neutral']": { background: "fg.subtle" },
        "&[data-fill='slack']": {
            backgroundImage: "repeating-linear-gradient(45deg, transparent 0 3px, {colors.border.strong} 3px 4px)",
            color: "fg.muted",
        },
        "&[data-fill='free']": { background: "color-mix(in srgb, {colors.fg} 5%, transparent)", color: "fg.muted" },
    },
    // ── Bucket rows (K2) — the Planner `.pcell` grid, verbatim ──
    // One washed sub-cell per bucket × lane; content (lane caption +
    // chips) flows inline, left-aligned. A marker rings the CELL
    // (`data-over`) and pins the corner status icon.
    //
    // EMPTY cells of an equal-bucket captionless lane do not mount (#616):
    // their wash paints as ONE gradient band per lane (`cellWash` — the
    // renderer sets the lane's top/height and the tile size), and real
    // cells mount only where content, a caption or a marker exists,
    // covering their gradient tile exactly.
    cellWash: {
        position: "absolute",
        left: 0,
        right: 0,
        pointerEvents: "none",
    },
    cell: {
        position: "absolute",
        background: "bg.panel",
        borderRadius: "2px",
        display: "flex",
        alignItems: "center",
        gap: "5px",
        padding: "0 6px",
        // Its padding at least — a link meets the cell as it draws (#1258).
        minWidth: "var(--plan-cell-min-w)",
        overflow: "hidden",
        boxSizing: "border-box",
        zIndex: 2,
        "&[data-over='warning']": { boxShadow: "inset 0 0 0 1.5px {colors.status.warn}" },
        "&[data-over='danger']":  { boxShadow: "inset 0 0 0 1.5px {colors.status.neg}" },
        "&[data-over='info']":    { boxShadow: "inset 0 0 0 1.5px {colors.status.info}" },
        "&[data-over='success']": { boxShadow: "inset 0 0 0 1.5px {colors.status.pos}" },
        "&[data-over='neutral']": { boxShadow: "inset 0 0 0 1.5px {colors.fg.subtle}" },
    },
    // A cell's tiles, in the room its lane caption leaves them (#1266): a
    // tile's 20px floor, and how far it shrinks, are this box's, so a tile in
    // a captioned lane never runs past its cell. As tall as the cell, so a
    // tile stretched on the block axis fills its lane.
    cellTiles: {
        display: "flex",
        alignItems: "center",
        alignSelf: "stretch",
        gap: "5px",
        flex: "1 1 0%",
        minWidth: 0,
        // Holding a `+n` chip on a coarse pointer, it is a layer of its own,
        // where the chip's tap halo lies beneath the tiles (#1267).
        "&:has(> [data-tile-more])": { _coarse: { isolation: "isolate" } },
    },
    // The tile chip inside a cell — the `.chk` / `.pchip` looks on the
    // lifecycle axis: confirmed/actual = the solid ink ✓ chip; proposals
    // = the paper-bg brand-dashed italic chip (grip glyph on the resting
    // `plan` form); removed / estimated / rejected extend the §4.3 table.
    //
    // A tile is never wider than its cell (#1266): it shrinks to the room
    // the cell leaves it, its 20px floor where the cell has that, and in a
    // room narrower than its padding the padding gives way, down to its rings
    // (`--plan-tile-least-w`, #1276) — a cell with less room than that draws
    // no tile, and shows its `+n` alone. Its parts
    // sit on ONE line of its own height, which the strut before them holds,
    // and a part with no room on that line wraps below it, where the tile
    // clips it whole: its icon goes once the tile is narrower inside than
    // the icon, its label once it would show less than a letter and the
    // ellipsis, and a label never shows without the icon before it. A
    // tile's width is its content's, so no size query could choose this.
    tile: {
        display: "inline-flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        height: "var(--plan-tile-h)",
        // Its floor, the geometry's (`--plan-tile-min-w`), which a folding cell keeps too (#1267).
        minWidth: "min(var(--plan-tile-min-w, 20px), 100%)",
        flex: "0 1 auto",
        borderRadius: "3px",
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "semibold",
        overflow: "hidden",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
        // 5px either side, or what the room leaves beside the widest ring a
        // state draws (a proposal's 1.5px, half the least a tile draws): a
        // percentage here is of the tiles' box, the room.
        paddingBlock: 0,
        paddingInline: "min(5px, calc(50% - var(--plan-tile-least-w) / 2))",
        // The strut: the line's height, and no width.
        "&::before": { content: '""', height: "100%" },
        // Its parts 4px apart — a margin, which the strut, being no element,
        // never takes, where a gap would follow it.
        "& > * + *": { marginInlineStart: "4px" },
        // Each icon at its own width (#1263), never Font Awesome's 1.25em
        // cell: the room a tile has is its parts'.
        "& svg": { fontSize: "8px", "--fa-width": "auto" },
        // The lifecycle axis (§4.3), shared (`states.ts`). A tile at rest is
        // the ONE committed fill (#949) ✓ chip; confirmed rests on paper in a
        // solid brand ring, as a bar does; its other states take a tighter
        // 2px radius, a proposal sits on the tint and its grip glyph dims.
        ...lifecycleStates({
            obs: { background: "brand.emphasized", color: "bg.surface" },
            appr: { background: "bg.surface", color: "fg.default", boxShadow: "inset 0 0 0 1px {colors.brand.solid}" },
            marked: { borderRadius: "2px" },
            prop: { background: "{colors.brandTint}", "& svg": { opacity: 0.8 } },
            propRemoved: { background: "bg.surface", color: "fg.muted" },
        }),
        // An event its drafts changed (#1196): the tint in a brand border, in its state's place.
        ...planElementDrafted,
        "&[data-tone='warning']": { boxShadow: "0 0 0 1.5px {colors.status.warn}" },
        "&[data-tone='danger']":  { boxShadow: "0 0 0 1.5px {colors.status.neg}" },
        "&[data-tone='success']": { boxShadow: "0 0 0 1.5px {colors.status.pos}" },
        "&[data-tone='info']":    { boxShadow: "0 0 0 1.5px {colors.status.info}" },
        // An event in an overlap pair (#1198): the warn ring, in a tone's
        // place — a confirmed tile keeps its inset brand ring inside it, and a
        // danger tone, the worse, keeps its own (the worst wins, as a cell's
        // marker does, #615).
        "&[data-overlap]": { boxShadow: PLAN_OVERLAP_RING },
        "&[data-overlap][data-state='appr']": { boxShadow: `inset 0 0 0 1px {colors.brand.solid}, ${PLAN_OVERLAP_RING}` },
        "&[data-overlap][data-tone='danger']": { boxShadow: "0 0 0 1.5px {colors.status.neg}" },
        "&[data-pulse]": {
            animation: "elara-pulse 1.6s ease-in-out infinite",
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        },
        // A tile that moves (#825) is picked up where it sits.
        "&[data-draggable]": { cursor: "grab" },
        // A cell measuring its fold draws every tile whole, at its own width
        // (#1267); a tile it folds is out of the cell, counted in its `+n`.
        "[data-tile-measure] > &": { flexShrink: 0 },
        "&[data-folded]": { display: "none" },
        // ── R1 GEOMETRY SHRINKS — the bucket case ──
        // A tile is already quantised to its cell; collapsing keeps the
        // cell and flattens the tile inside it. `minWidth` has to go with
        // it or a 20px floor would fight the 7px block.
        "&[data-ctx]": {
            height: "var(--plan-strip-mark-h)",
            minWidth: 0,
            color: "transparent",
            padding: 0,
            "& > * + *": { marginInlineStart: 0 },
            borderRadius: "1px",
            transition: "height 380ms cubic-bezier(0.16, 1, 0.3, 1)",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        },
        ...planElementSelected,
        ...planElementFocus,
    },
    // A tile's label (`data-plan-label`) — a labelled tile's, or a resting
    // proposal's `plan`. Its own flex item, so a label wider than the tile
    // ellipsizes instead of the centred text clipping on both sides ("MIXED"
    // read "IXE"). It takes the room its line leaves, from a letter and the
    // ellipsis — 2ch in the tile's mono face — up to its whole text; with
    // less, it wraps off the line, out of sight (#1266), and its hover says it
    // in the canvas's tooltip.
    tileLabel: {
        flex: "1 1 2ch",
        minWidth: 0,
        maxWidth: "max-content",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    // A cell's `+n` chip (#1267): the tiles it has no room for, counted — a
    // button whose anchored menu lists them. On a tile's metrics (mono 9.5px,
    // its height and radius), in the muted ink on paper; it never shrinks, so
    // a tile squeezed beside it gives the room — but in a cell narrower than
    // the chip (`data-cramped`) it shrinks to the room and draws no count, its
    // name still saying what it holds. The stand-in a cell measures beside its
    // tiles is never seen. A cell with no room for one tile (`data-no-room`,
    // #1276) draws the chip alone across the whole cell — its padding and its
    // caption too — so what the cell holds is never unseen; its menu lists
    // every tile.
    //
    // On a coarse pointer its tap target is its cell, less the tiles in it
    // (#346's halo, held to the cell): the halo lies beneath the tiles in their
    // box's layer, so a tile beside the chip keeps its own taps, and the cell
    // clips it, so it never reaches another cell's tiles. It takes the box's
    // empty room, the cell's padding and its caption.
    tileMore: {
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        height: "var(--plan-tile-h)",
        boxSizing: "border-box",
        padding: "0 4px",
        borderRadius: "3px",
        background: "bg.surface",
        color: "fg.muted",
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "semibold",
        whiteSpace: "nowrap",
        cursor: "pointer",
        _hover: { color: "fg" },
        // Cramped, it is the cell's one part: it fills the room.
        "&[data-cramped]": {
            flex: "1 1 0%",
            minWidth: 0,
            padding: 0,
            "& > [data-tile-more-count]": { display: "none" },
        },
        // No room for a tile: across the cell, out of its tiles' box, so the
        // room the cell measures never changes with it.
        "&[data-no-room]": {
            position: "absolute",
            insetInline: 0,
            top: "50%",
            transform: "translateY(-50%)",
        },
        "&[data-tile-more-measure]": { visibility: "hidden" },
        ...coarseHitArea(),
        // The halo (its `::before`, drawn on a coarse pointer alone) beneath the tiles.
        "&::before": { zIndex: -1 },
        ...planElementFocus,
    },
    // The per-cell lane caption (`.bl`) — printed at each cell's left.
    laneLabel: {
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "semibold",
        letterSpacing: "0.06em",
        color: "fg.subtle",
        flex: "none",
    },
    // Corner status icon of a marked cell (the Planner marker, verbatim).
    markerIcon: {
        position: "absolute",
        top: "1px",
        right: "1px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "9px",
        lineHeight: 1,
        cursor: "help",
        zIndex: 4,
        "&[data-status='warning']": { color: "{colors.status.warn}" },
        "&[data-status='danger']":  { color: "{colors.status.neg}" },
        "&[data-status='info']":    { color: "{colors.status.info}" },
        "&[data-status='success']": { color: "{colors.status.pos}" },
        "&[data-status='neutral']": { color: "fg.subtle" },
        // Its message is a hover's tooltip, which a coarse pointer has none of:
        // there it takes no tap from the `+n` chip's halo, which its cell is (#1267).
        "[data-plan-cell]:has(> [data-plan-cell-tiles] > [data-tile-more]) > &": { _coarse: { pointerEvents: "none" } },
    },
    // ── Cards chips (K6) — the Roster `.shift` chip, verbatim: 5px
    //    radius, brand tint + 1px brand ring, mono 10/500, text left ──
    // A chip too short for its padding draws the canvas's narrowest chip, and
    // a link meets it where it ends as drawn (#1258). A container, so its
    // icon and its label read the width inside it (#1264).
    cardChip: {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        height: "var(--plan-chip-h)",
        minWidth: "var(--plan-chip-min-w)",
        containerType: "inline-size",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: "4px",
        borderRadius: "5px",
        fontFamily: "mono",
        fontSize: "10px",
        fontWeight: "medium",
        whiteSpace: "nowrap",
        overflow: "hidden",
        boxSizing: "border-box",
        zIndex: 2,
        padding: "0 9px",
        // The lifecycle axis (§4.3), shared (`states.ts`). The tint means
        // selected or dirty only (#949): a chip at rest is the ONE committed
        // fill, confirmed rests on paper in a solid brand ring, a proposal
        // sits on the tint in its dashed ring, and a removal on paper in the
        // warn ink.
        ...lifecycleStates({
            obs: { background: "brand.emphasized", color: "bg.surface" },
            appr: { background: "bg.surface", color: "fg.default", boxShadow: "inset 0 0 0 1px {colors.brand.solid}" },
            prop: { background: "{colors.brandTint}" },
            propRemoved: { background: "bg.surface", color: "{colors.status.warn}" },
        }),
        // An event its drafts changed (#1196): the tint in a brand border, in its state's place.
        ...planElementDrafted,
        // An event in an overlap pair (#1198): the warn ring — a confirmed
        // chip keeps its inset brand ring inside it.
        "&[data-overlap]": { boxShadow: PLAN_OVERLAP_RING },
        "&[data-overlap][data-state='appr']": { boxShadow: `inset 0 0 0 1px {colors.brand.solid}, ${PLAN_OVERLAP_RING}` },
        // A chip that moves (#825) is picked up anywhere but its ends.
        "&[data-draggable]": { cursor: "grab" },
        // ── R1 GEOMETRY SHRINKS (#591) ──
        // The mark already owns a position and a width on the axis, so it
        // keeps both and drops to 7px. Ink goes `transparent` rather than
        // `display: none` — the box, and therefore the geometry, is
        // unchanged, and it takes any FA icon inside with it for free
        // (FA paints with `fill: currentColor`).
        "&[data-ctx]": {
            height: "var(--plan-strip-mark-h)",
            color: "transparent",
            padding: "0 2px",
            gap: 0,
            transition: "height 380ms cubic-bezier(0.16, 1, 0.3, 1), padding 380ms cubic-bezier(0.16, 1, 0.3, 1)",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        },
        ...planElementSelected,
        ...planElementFocus,
    },
    // A chip's icon (`data-plan-icon`) — Font Awesome's, 1.25em wide in the
    // chip's font; a chip narrower inside than that draws none, never a part
    // of it (#1264).
    cardChipIcon: {
        display: "inline-flex",
        flex: "none",
        "@container (width < 1.25em)": { display: "none" },
    },
    // A chip's label — whole, or ellipsized when it does not fit. Below a
    // letter and the ellipsis — in the chip's mono face each one `ch` wide,
    // after the icon and the gap when the chip has one (`data-icon`) — it is
    // not drawn at all, never a sliver of a glyph (#1264), and its hover says
    // it in the canvas's tooltip.
    cardChipLabel: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        "@container (width < 2ch)": { display: "none" },
        "[data-icon] > &": { "@container (width < calc(1.25em + 4px + 2ch))": { display: "none" } },
    },
    // ── Table cells (K5) — mono numerals per bucket, CENTRED in their
    //    column as the ruler's ticks and the heat values are (#949); the
    //    renderer sets left/width per bucket; footer = bold ink, header =
    //    caption-styled numerals ──
    // A table cell: its bucket's column, the row's height, its numerals centred
    // in it together (`tableCellGroup`) — whole, or wrapped off its line and
    // out of sight where the column is narrower than they are (#1269).
    tableCellText: {
        position: "absolute",
        top: 0,
        bottom: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...wholeOrNone,
        padding: "0 4px",
        boxSizing: "border-box",
        overflow: "hidden",
        fontFamily: "mono",
        fontSize: "10.5px",
        fontWeight: "medium",
        color: "fg.muted",
        whiteSpace: "nowrap",
        zIndex: 2,
        // A 356px card body gives a bucket ~25px. The desktop's 10px
        // right inset and 10.5px numerals were sized for 54px columns —
        // a three-digit numeral clipped its first digit — so a card cell
        // keeps a 2px inset at 9.5px (§10: density relaxes, the vocabulary
        // does not); its parts' layout is the group's, below.
        "[data-plan-narrow] &": {
            padding: "0 2px",
            fontSize: "9.5px",
        },
        "[data-emphasis='footer'] &": { fontWeight: "semibold", color: "fg.default" },
        "[data-emphasis='header'] &": {
            fontSize: "9.5px",
            fontWeight: "semibold",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        ...planElementFocus,
    },
    // One value position inside a table cell — tone derives per cell
    // (neg / em-dash) or from the SERIES' declaration; `strong` is the
    // series' weight emphasis.
    // A table cell's numerals, together: one line, or one line per series on a
    // vertical split — side by side, or stacked lines. Two numerals side by
    // side overlap in a card's ~25px bucket, so the narrow layout stacks a
    // horizontal split the way `vertical` does; the row's `split` is a DESKTOP
    // layout choice and the mobile answer is one column.
    tableCellGroup: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        whiteSpace: "nowrap",
        "[data-split='horizontal'] > &": { gap: "6px" },
        "[data-split='vertical'] > &, [data-plan-narrow] [data-split='horizontal'] > &": {
            flexDirection: "column",
            gap: "1px",
            lineHeight: "var(--plan-table-line-h)",
        },
    },
    tableCellPart: {
        "&[data-tone='neg']":   { color: "{colors.status.neg}" },
        "&[data-tone='muted']": { color: "fg.subtle" },
        "&[data-strong]":       { fontWeight: "semibold", color: "fg.default" },
    },
};
