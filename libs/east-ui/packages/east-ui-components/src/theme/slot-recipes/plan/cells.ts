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
import { fontAwesomeSize } from "../../icon-size.js";
import { centredLine } from "../../one-line-box.js";
import { CONFLICT_RING_INSET, CONFLICT_RING_INSIDE_FOCUS } from "../../conflict-ring.js";
import { fieldInRingedControl } from "../../field-chrome.js";
import { STATE_EDGE, lifecycleStates } from "./states.js";
import { planElementConflicts, planElementOverlap, planElementStatus } from "./status.js";
import { planElementDrafted, planElementFocus, planElementSelected } from "./focus.js";
import { PLAN_LOCK_W, planLabelAfterLock } from "./elements.js";

/**
 * The no-data hatch (#1039): a 45° rule in the ink at 7% across what no value shades — a heat cell, and the Calendar's
 * period no summary shades (#1424).
 */
export const NO_DATA_HATCH = "repeating-linear-gradient(45deg, transparent 0 3px, color-mix(in srgb, {colors.fg} 7%, transparent) 3px 4px)";

/** A booked-vs-free bar's fill (#1039): the brand's solid — the Plan's weight bar, and the Calendar's shading (#1424). */
export const BOOKED_FILL = "{colors.brand.solid}";

/** The slots this part styles. */
export const cellsSlots = [
    "heatCell", "heatLabel", "weightBar", "segmentTrack", "segmentPart", "cellsMeasure", "cell", "cellTiles",
    "tile", "tileLabel", "tileMore", "markerIcon", "cardChip", "cardChipIcon", "cardChipLabel", "tableCellText", "tableCellGroup", "tableCellPart", "tableCellDot", "tableCellMeasure",
    "tableCellInput", "tableCellField", "tableCellFieldInput", "tableCellRefusal", "tableCellPopover",
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

/** The inset ring a confirmed tile and a confirmed chip draw: 1px of the brand, which every ring round it keeps inside. */
const CONFIRMED = "inset 0 0 0 1px {colors.brand.solid}";

/** The inset ring an observed tile draws (#1735): 1px of the strong rule. */
const OBSERVED = "inset 0 0 0 1px {colors.border.strong}";

/**
 * The line of a chip's words (#1638): the chip's height less 4px. The chip
 * centres its line, so its words start half of what the line leaves under its
 * edge — 2px, whatever border its state draws, which takes as much of the room
 * above the line as below it — and a line 4px short lies inside the widest of
 * those borders, 1.5px.
 */
const PLAN_CHIP_LINE = "calc(var(--plan-chip-h) - 4px)";

/**
 * A lone tile's tap halo where its cell has no room for it (#1710), as the `+n` chip's is (#1267): on a coarse pointer
 * its `::after` — its `::before` is its line's strut — which the tile lets out, its parts unseen, and its cell clips.
 */
const LONE_MARK_HALO = coarseHitArea({ pseudo: "_after" }) as { readonly _coarse: SystemStyleObject };

/** Their base styles — typed whole: the shared tap halo's style object is too wide to infer into them. */
export const cellsBase: Record<(typeof cellsSlots)[number], SystemStyleObject> = {
    // ── Heat rows (min-height 16, r2, 3px margins; depth is data-driven) ──
    // A size container (#1638), as a bucket's cell is: its value's line is the
    // cell's own height (`100cqh`), whatever its row's.
    heatCell: {
        position: "absolute",
        containerType: "size",
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
        "&[data-nodata]": { backgroundImage: NO_DATA_HATCH },
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
    // Sequential ramp), at least 4.5:1 on that step in both themes. Its line is
    // its cell's own height (#1638). A cell is its row less 3px above and
    // below, and a row draws a rule on the canvas and none in a phone's card:
    // 25px in a canvas row, 26px in a card, 18px in a group's strip there. No
    // one line is centred at a whole pixel in all three — the theme's 15.75px
    // in none — and a line the cell's height has nothing to centre.
    heatLabel: {
        fontFamily: "mono",
        fontSize: "10.5px",
        lineHeight: "100cqh",
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
        background: BOOKED_FILL,
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
    // Its label's line is the track's own height (#1638), so nothing is centred at a fraction.
    segmentPart: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "mono",
        fontSize: "9.5px",
        lineHeight: "var(--plan-segment-h)",
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
    // ── Bucket rows (K2), to the task tiles' spec (#1735) ──
    // A cell is a day of a lane: the day's room in the lane's, which the
    // renderer places on whole pixels, the rules under the row its grid — it
    // draws no wash of its own, and mounts only where content or a marker is
    // (#616). Its tiles stand in its slots, set inline. A lane's caption is its
    // gutter line's, never a cell's (#1680's review). A marker rings the CELL
    // (`data-over`) and pins the corner status icon.
    //
    // What a buckets row measures its plot by: the plot's size, never seen.
    cellsMeasure: {
        position: "absolute",
        inset: 0,
        visibility: "hidden",
        pointerEvents: "none",
    },
    // It clips, so a chip's tap halo on a coarse pointer never reaches another
    // cell's tiles (#1267); a tile's rings stand inside the 2px it leaves them.
    cell: {
        position: "absolute",
        overflow: "hidden",
        boxSizing: "border-box",
        zIndex: 2,
        "&[data-over='warning']": { boxShadow: "inset 0 0 0 1.5px {colors.status.warn}" },
        "&[data-over='danger']":  { boxShadow: "inset 0 0 0 1.5px {colors.status.neg}" },
        "&[data-over='info']":    { boxShadow: "inset 0 0 0 1.5px {colors.status.info}" },
        "&[data-over='success']": { boxShadow: "inset 0 0 0 1.5px {colors.status.pos}" },
        "&[data-over='neutral']": { boxShadow: "inset 0 0 0 1.5px {colors.fg.subtle}" },
    },
    // A cell's tiles' box: the cell's room, which each slot is placed in.
    cellTiles: {
        position: "absolute",
        inset: 0,
        // Holding a `+n` chip on a coarse pointer, it is a layer of its own,
        // where the chip's tap halo lies beneath the tiles (#1267).
        "&:has(> [data-tile-more])": { _coarse: { isolation: "isolate" } },
    },
    // A tile (#1735): in its slot of its cell — the renderer sets its left
    // and width — 20 tall, centred in its lane's room on the whole pixel the
    // row works out (`--plan-tile-top`; unmeasured, by halves), 2px inside
    // every rule, its corners the gap's 2px. Its parts — its lock, its icon,
    // its label — stand from its left, 6px in with 6 clear on its right, the
    // border its state draws standing in that (`states.ts`), on ONE line of
    // its height which the strut before them holds: a part with no room on
    // that line wraps below it, where the tile clips it whole, so parts drop
    // from the end — a quarter holds a check but not `10m` — and the first
    // part can drop too, the strut, being no element, never taking a margin.
    tile: {
        position: "absolute",
        top: "var(--plan-tile-top, calc((100% - var(--plan-tile-h)) / 2))",
        height: "var(--plan-tile-h)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        alignContent: "flex-start",
        justifyContent: "flex-start",
        borderRadius: "2px",
        fontFamily: "mono",
        fontSize: "11px",
        fontWeight: "semibold",
        fontVariantNumeric: "tabular-nums",
        // The line's height is the tile's: a browser that cannot trim a label to its cap height centres its line box.
        lineHeight: "var(--plan-tile-h)",
        overflow: "hidden",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
        paddingBlock: 0,
        // 6px each side, or — a slot narrower than its padding (`--plan-slot-w`, the renderer's) — what the slot leaves
        // beside the least a tile draws, its two rings (#1276), so a tile is never wider than its slot.
        paddingInline: `max(0px, calc(min(6px, (var(--plan-slot-w, 100px) - var(--plan-tile-least-w)) / 2) - ${STATE_EDGE}))`,
        // The strut: the line's height, and no width.
        "&::before": { content: '""', height: "100%" },
        // Its parts 4px apart — a margin, which the strut, being no element,
        // never takes, where a gap would follow it.
        "& > * + *": { marginInlineStart: "4px" },
        // An icon 10px across and down (#1735), its glyph fitted to it: Font Awesome's own rule draws an icon `1em` tall
        // and `--fa-width` across, and comes after a recipe's, so the icon's face and that width are what set it. Its
        // lock as every element's is, 8px tall (#1541, U9), at the glyph's own width, as a tile's was (#1263).
        "& svg:not([data-plan-lock])": { ...fontAwesomeSize("10px"), flex: "none" },
        "& svg[data-plan-lock]": { fontSize: PLAN_LOCK_W, "--fa-width": "auto", flex: "none" },
        // The lifecycle axis (§4.3), shared (`states.ts`), to the spec's looks (#1735), every one upright in the label's
        // face. Observed: the third paper, the strong rule inside it, the ink. Confirmed: the paper, the brand's rule
        // inside it. A proposal — a removal too (ruled 23 Nov 2026) — the tint, 1.5px dashed in the brand, the brand's
        // pressed ink. An estimate: 1px dashed in the strong rule, the fourth ink. A rejection keeps its look (ruled).
        ...lifecycleStates({
            obs: { background: "bg.subtle", color: "fg", boxShadow: OBSERVED },
            appr: { background: "bg.surface", color: "fg.default", boxShadow: CONFIRMED },
            prop: { background: "{colors.brandTint}", color: "{colors.brandPressed}", fontStyle: "normal" },
            propRemoved: {
                background: "{colors.brandTint}", color: "{colors.brandPressed}", borderColor: "{colors.brand.solid}",
                fontStyle: "normal", textDecoration: "none",
            },
            estimated: { fontStyle: "normal" },
        }),
        // In progress, observed too, keeps its look of before (ruled 23 Nov 2026): the one committed fill, the paper's
        // ink. Only an observed tile is in progress; as one attribute, a draft's look and a status's ring draw over it.
        "&[data-progress]": { background: "brand.emphasized", color: "bg.surface", boxShadow: "none" },
        // Done: its check in the positive (ruled 23 Nov 2026) — but in a mark, whose ink is none.
        "& [data-plan-done]": { color: "{colors.status.pos}" },
        // Stretched down (#1735): its lane's room, 2px inside its rules.
        "&[data-stretch]": { top: "2px", height: "calc(100% - 4px)" },
        // An event its drafts changed (#1196): the tint in a brand border, in its state's place.
        ...planElementDrafted,
        // Its status (#1541, U8): its tone's ring, and the open ring a tentative one draws as. A confirmed tile
        // keeps its inset brand ring inside it, a done one its strong rule (#1735).
        ...planElementStatus(CONFIRMED, OBSERVED),
        // An event in an overlap pair (#1198): the warn ring, in its status's place — a danger status, the worse,
        // keeps its own (the worst wins, as a cell's marker does, #615).
        ...planElementOverlap(CONFIRMED, OBSERVED),
        "&[data-pulse]": {
            animation: "elara-pulse 1.6s ease-in-out infinite",
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        },
        // A tile that moves (#825) is picked up where it sits.
        "&[data-draggable]": { cursor: "grab" },
        // A tile the cell folds is out of it, counted in its `+n` (#1267).
        "&[data-folded]": { display: "none" },
        // A lone tile in a cell with no room for it (#1710): a mark across the whole day's room at its own height, in
        // its state's fill and rings, none of its parts drawn. Its ink goes `transparent`, as a strip's mark's does,
        // which takes an FA icon with it. On a coarse pointer its tap target is its cell, as the `+n` chip's is (#1267).
        "[data-no-room] > &": {
            insetInline: 0,
            padding: 0,
            color: "transparent",
            "& > * + *": { marginInlineStart: 0 },
            "& [data-plan-done]": { color: "transparent" },
            _coarse: { ...LONE_MARK_HALO._coarse, overflow: "visible" },
        },
        // ── R1 GEOMETRY SHRINKS — the bucket case ──
        // A tile is already quantised to its cell; collapsing keeps the
        // cell and flattens the tile inside it, centred in the strip.
        "&[data-ctx]": {
            top: "calc((100% - var(--plan-strip-mark-h)) / 2)",
            height: "var(--plan-strip-mark-h)",
            lineHeight: "var(--plan-strip-mark-h)",
            color: "transparent",
            padding: 0,
            "& > * + *": { marginInlineStart: 0 },
            "& [data-plan-done]": { color: "transparent" },
            borderRadius: "1px",
            transition: "height 380ms cubic-bezier(0.16, 1, 0.3, 1)",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        },
        // Selected and focused, its ring inside the 2px its cell leaves it (#1735), which clips.
        ...planElementSelected,
        "&[data-selected]": { outline: "1.5px solid", outlineColor: "brand.solid", outlineOffset: "0.5px" },
        ...planElementFocus,
        _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: 0 },
        // A conflict's ring, last: a confirmed tile keeps its inset brand ring inside the warn, a done one its strong
        // rule, an open one its own.
        ...planElementConflicts(CONFIRMED, OBSERVED),
    },
    // A tile's label (`data-plan-label`) — a labelled tile's, or a resting
    // proposal's `plan` — whole or not at all (#1735): with no room on its
    // line it wraps off it, out of sight, and its hover says it in the
    // canvas's tooltip. Trimmed to its cap height and its baseline where the
    // browser can, so its digits stand centred in the tile, 6 | 8 | 6 at 1×;
    // elsewhere its line box is centred, a pixel high.
    tileLabel: {
        flex: "none",
        whiteSpace: "nowrap",
        "@supports (text-box: trim-both cap alphabetic)": { textBox: "trim-both cap alphabetic" },
    },
    // A cell's `+n` chip (#1267): the tiles it has no slot for, counted — a
    // button whose anchored menu lists them — in the last slot (#1735), the
    // renderer setting its left and width: a tile's height, place and corners,
    // its count in the label's face, centred, in the muted ink on paper. Its
    // count draws whole or not at all: on a slot too narrow for it, a single
    // line of the chip's height with nothing on it, its name still saying what
    // it holds. A cell with no room for one of its several tiles
    // (`data-no-room`, #1276) draws the chip alone across the day's room, a
    // solid neutral mark, its count in the paper ink (#1710), so what the cell
    // holds is never unseen: on paper it read as an empty cell. Its menu lists
    // every tile.
    //
    // On a coarse pointer its tap target is its cell, less the tiles in it
    // (#346's halo, held to the cell): the halo lies beneath the tiles in their
    // box's layer, so a tile beside the chip keeps its own taps, and the cell
    // clips it, so it never reaches another cell's tiles.
    tileMore: {
        position: "absolute",
        top: "var(--plan-tile-top, calc((100% - var(--plan-tile-h)) / 2))",
        height: "var(--plan-tile-h)",
        display: "flex",
        boxSizing: "border-box",
        // 4px each side, or what a slot narrower than that leaves (`--plan-slot-w`), as a tile's padding gives way.
        paddingBlock: 0,
        paddingInline: "max(0px, min(4px, (var(--plan-slot-w, 100px) - var(--plan-tile-least-w)) / 2))",
        borderRadius: "2px",
        background: "bg.surface",
        color: "fg.muted",
        fontFamily: "mono",
        fontSize: "11px",
        lineHeight: "var(--plan-tile-h)",
        fontWeight: "semibold",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        cursor: "pointer",
        _hover: { color: "fg" },
        // Its count on a line of the chip's height, which the count's strut holds, in a box of its own that clips —
        // never the chip, whose halo, its `::before`, reaches past it — so a count with no room wraps off that line,
        // out of sight. Its words trimmed as a tile's label is, its digits centred as the label's are.
        "& > [data-tile-more-count]": {
            flex: "1 1 0%",
            minWidth: 0,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            alignContent: "flex-start",
            justifyContent: "center",
            overflow: "hidden",
            "&::before": { content: '""', height: "100%" },
            "& > *": { flex: "none", "@supports (text-box: trim-both cap alphabetic)": { textBox: "trim-both cap alphabetic" } },
        },
        // No room for a tile: across the day's room, which has none for its padding either.
        "&[data-no-room]": {
            insetInline: 0,
            paddingInline: 0,
            background: "fg.subtle",
            color: "bg.surface",
            _hover: { color: "bg.surface" },
        },
        ...coarseHitArea(),
        // The halo (its `::before`, drawn on a coarse pointer alone) beneath the tiles.
        "&::before": { zIndex: -1 },
        ...planElementFocus,
        _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: 0 },
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
        // there it takes no tap from the `+n` chip's halo, which its cell is (#1267),
        // nor from a lone tile's drawn as a mark across its cell (#1710).
        "[data-plan-cell]:has(> [data-plan-cell-tiles] > [data-tile-more]) > &": { _coarse: { pointerEvents: "none" } },
        "[data-plan-cell]:has(> [data-plan-cell-tiles][data-no-room]) > &": { _coarse: { pointerEvents: "none" } },
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
        // Its line is its height less 4px (#1638), as a tile's is: whole, 2px under
        // its edge in every state, and inside the widest border a state draws.
        lineHeight: PLAN_CHIP_LINE,
        fontWeight: "medium",
        whiteSpace: "nowrap",
        overflow: "hidden",
        boxSizing: "border-box",
        zIndex: 2,
        // Less the border its state draws, which stands in it (`states.ts`).
        padding: `0 calc(9px - ${STATE_EDGE})`,
        // The lifecycle axis (§4.3), shared (`states.ts`). The tint means
        // selected or dirty only (#949): a chip at rest is the ONE committed
        // fill, confirmed rests on paper in a solid brand ring, a proposal
        // sits on the tint in its dashed ring, and a removal on paper in the
        // warn ink.
        ...lifecycleStates({
            obs: { background: "brand.emphasized", color: "bg.surface" },
            appr: { background: "bg.surface", color: "fg.default", boxShadow: CONFIRMED },
            prop: { background: "{colors.brandTint}" },
            propRemoved: { background: "bg.surface", color: "{colors.status.warn}" },
        }),
        // An event its drafts changed (#1196): the tint in a brand border, in its state's place.
        ...planElementDrafted,
        // Its status (#1541, U8): its tone's ring, and the open ring a tentative one draws as. A confirmed chip
        // keeps its inset brand ring inside it.
        ...planElementStatus(CONFIRMED),
        // An event in an overlap pair (#1198): the warn ring, in its status's place.
        ...planElementOverlap(CONFIRMED),
        // A chip that moves (#825) is picked up anywhere but its ends.
        "&[data-draggable]": { cursor: "grab" },
        // Locked (#1541, U9): 6px either side, so the least chip the canvas draws (`--plan-chip-min-w`, 22px) holds
        // its 8px lock whole. Before the strip's rule, which sets its own.
        "&[data-locked]": { paddingInline: `calc(6px - ${STATE_EDGE})` },
        // ── R1 GEOMETRY SHRINKS (#591) ──
        // The mark already owns a position and a width on the axis, so it
        // keeps both and drops to 7px. Ink goes `transparent` rather than
        // `display: none` — the box, and therefore the geometry, is
        // unchanged, and it takes any FA icon inside with it for free
        // (FA paints with `fill: currentColor`).
        "&[data-ctx]": {
            height: "var(--plan-strip-mark-h)",
            lineHeight: "var(--plan-strip-mark-h)",
            color: "transparent",
            padding: "0 2px",
            gap: 0,
            transition: "height 380ms cubic-bezier(0.16, 1, 0.3, 1), padding 380ms cubic-bezier(0.16, 1, 0.3, 1)",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        },
        ...planElementSelected,
        ...planElementFocus,
        // A conflict's ring, last: a confirmed chip keeps its inset brand ring inside the warn, an open one its own.
        ...planElementConflicts(CONFIRMED),
    },
    // A chip's icon (`data-plan-icon`) — Font Awesome's, 1.25em wide in the
    // chip's font; a chip narrower inside than that draws none, never a part
    // of it (#1264).
    cardChipIcon: {
        display: "inline-flex",
        flex: "none",
        "@container (width < 1.25em)": { display: "none" },
        // After a lock and the gap (#1541, U9): whole beside them, or not drawn.
        "[data-locked] > &": { [`@container (width < calc(${PLAN_LOCK_W} + 4px + 1.25em))`]: { display: "none" } },
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
        // After a lock and the gap too (#1541, U9), as a bar's label is — and after both where it has an icon.
        ...planLabelAfterLock,
        "[data-locked][data-icon] > &": { [`@container (width < calc(${PLAN_LOCK_W} + 4px + 1.25em + 4px + 2ch))`]: { display: "none" } },
    },
    // ── Table cells (K5) — mono numerals per bucket, CENTRED in their
    //    column as the ruler's ticks and the heat values are (#949); the
    //    renderer sets left/width per bucket; footer = bold ink, header =
    //    caption-styled numerals ──
    // A table cell: its bucket's column, the row's height, its numerals centred
    // in it together (`tableCellGroup`) — whole, or wrapped off its line and
    // out of sight where the column is narrower than they are (#1269). Their
    // line is a whole 15px (#1638): the cell is its row less the rule, an odd
    // height — 31px in a 32px row — so an odd line leaves a whole number of
    // pixels over it, where the theme's 15.75px left a fraction.
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
        lineHeight: centredLine(31, 15),
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
        // A cell taking a typed number (#1438) wears a faint well, about a paper step of ink, inside its edges: the
        // column's rule shows around it and the row's wash — selected, drafted — through it. Hovered, an input's edge.
        // A summary — a parent's subtotal, or any cell coarser than the Plan's finest zoom — takes none, and stays plain.
        "&[data-typed]::after": {
            content: '""',
            position: "absolute",
            inset: "1px",
            borderRadius: "2px",
            background: "color-mix(in oklch, {colors.fg} 3%, transparent)",
            pointerEvents: "none",
            zIndex: -1,
        },
        "&[data-typed]:hover:not(:focus-visible)": { boxShadow: "inset 0 0 0 1px {colors.border.strong}" },
        // A cell holding a conflict not yet chosen wears the warn ring inside it, hovered too; focused, just inside the
        // focus's 2px of brand. It sits on its row's plain surface: the row's selection tint under it greyed the ring's
        // warm glow, where the Sheet's cell, on its paper, reads warm.
        "&[data-conflict]": { boxShadow: CONFLICT_RING_INSET, background: "bg.surface" },
        "&[data-conflict][data-typed]:hover:not(:focus-visible)": { boxShadow: CONFLICT_RING_INSET },
        "&[data-conflict]:focus-visible": { boxShadow: `inset 0 0 0 2px {colors.brand.solid}, ${CONFLICT_RING_INSIDE_FOCUS}` },
        // Focused, the ring its input draws while open, and the Sheet's cell: 2px of brand INSIDE the cell. A cell is
        // its row's whole height, so a ring outside it, as other elements draw theirs, lost its top and bottom to the
        // row (#1438).
        _focusVisible: { outline: "none", boxShadow: "inset 0 0 0 2px {colors.brand.solid}" },
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
        // A dotted cell's numerals (#1438): kept for its hover to say, never drawn.
        "[data-plan-dotted] > &": { display: "none" },
    },
    tableCellPart: {
        "&[data-tone='neg']":   { color: "{colors.status.neg}" },
        "&[data-tone='muted']": { color: "fg.subtle" },
        "&[data-strong]":       { fontWeight: "semibold", color: "fg.default" },
    },
    // A cell's value wider than its column (#1269, #1438): a dot in its place, in its numerals' ink, so a value never
    // leaves its cell looking empty — its numerals kept, hidden, and the cell's hover saying them. At the cell's
    // centre, off its line: a 9px column's padding leaves the line less room than the dot, which would wrap off it,
    // out of sight, as numerals do.
    tableCellDot: {
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "4px",
        height: "4px",
        borderRadius: "full",
        background: "fg.muted",
        "&[data-tone='neg']": { background: "{colors.status.neg}" },
        "&[data-strong]":     { background: "fg.default" },
    },
    // What a table row measures its plot's width by, beside its cells: the plot's width, no height, never seen.
    tableCellMeasure: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 0,
        visibility: "hidden",
        pointerEvents: "none",
    },
    // ── Typing a number into a table cell (#1436, #1438) — the cell's field
    //    over its bucket's column at the row's height, the brand ring its
    //    chrome (the neg ring while its text is refused), its text in the
    //    table's numerals; the renderer sets left/width per bucket ──
    tableCellInput: {
        position: "absolute",
        top: 0,
        bottom: 0,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        boxSizing: "border-box",
        paddingX: "2px",
        borderRadius: "2px",
        background: "bg.surface",
        boxShadow: "inset 0 0 0 2px {colors.brand.solid}",
        "&[data-invalid]": { boxShadow: "inset 0 0 0 2px {colors.status.neg}" },
        // Below 480px of main it opens in a popover anchored to its cell (#1438): a field of its own at a row's height.
        "&[data-popover]": { position: "relative", height: "32px", width: "100%" },
        "&[data-popover] input": { fontSize: "13px", _coarse: { fontSize: "16px" } },
    },
    // The common number field inside the ring: no border, no focus ring of its own.
    tableCellField: {
        flex: "1",
        minWidth: "0",
        height: "100%",
        borderWidth: "0",
        borderRadius: "0",
        boxShadow: "none",
        background: "transparent",
        _focusWithin: { boxShadow: "none", borderColor: "transparent" },
        _hover: { borderColor: "transparent" },
    },
    tableCellFieldInput: {
        ...fieldInRingedControl,
        width: "100%",
        height: "100%",
        minWidth: "0",
        padding: "0",
        border: "none",
        outline: "none",
        background: "transparent",
        textAlign: "center",
        fontFamily: "mono",
        fontSize: "10.5px",
        fontWeight: "medium",
        color: "fg",
        // A phone zooms into type under 16 px.
        _coarse: { fontSize: "16px" },
    },
    // The popover a tap opens the field in below 480px of main, anchored to its cell: the design system's smallest, xs
    // 240 — the width the frame's bounds weigh before it is drawn (`frameBounds`) the width it is drawn at.
    tableCellPopover: {
        padding: "8px",
        width: "240px",
    },
    // Why its text was refused: under the field, on the surface, in the neg tone.
    tableCellRefusal: {
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: "2px",
        paddingX: "6px",
        paddingY: "2px",
        borderRadius: "2px",
        background: "bg.surface",
        boxShadow: "sm",
        whiteSpace: "nowrap",
        fontSize: "11px",
        color: "{colors.status.neg}",
    },
};
