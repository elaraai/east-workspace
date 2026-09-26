/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan recipe's CELLS — what is quantised to a bucket: heat, weight and
 * segment cells, bucket cells and their tiles, cards chips, and table numerals.
 *
 * One part of the Plan slot recipe (`../plan.ts`, #817), over semantic tokens
 * and the canvas's geometry variables (`collections/plan/geometry.ts`).
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";
import { lifecycleStates } from "./states.js";
import { planElementFocus } from "./focus.js";

/** The slots this part styles. */
export const cellsSlots = [
    "heatCell", "heatLabel", "weightBar", "segmentTrack", "segmentPart", "cellWash", "cell",
    "tile", "tileLabel", "laneLabel", "markerIcon", "cardChip", "tableCellText", "tableCellPart",
] as const;

/** Their base styles. */
export const cellsBase = {
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
        zIndex: 2,
        // No-data: 45° hatch + the em-dash (content set by the renderer).
        "&[data-nodata]": {
            backgroundImage:
                "repeating-linear-gradient(45deg, transparent 0 3px, color-mix(in srgb, {colors.fg} 7%, transparent) 3px 4px)",
        },
        "&[data-warn]": { boxShadow: "inset 0 0 0 1.5px {colors.status.warn}" },
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
    heatLabel: {
        fontFamily: "mono",
        fontSize: "9px",
        fontWeight: "semibold",
        color: "fg.muted",
        "&[data-flip]": { color: "bg.surface" },
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
        background: "{colors.brand.600}",
        zIndex: 2,
        "&[data-planned]": {
            background: "color-mix(in srgb, {colors.brand.600} 45%, {colors.bg.surface})",
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
        fontSize: "8px",
        fontWeight: "semibold",
        color: "bg.surface",
        overflow: "hidden",
        whiteSpace: "nowrap",
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
        minWidth: 0,
        overflow: "hidden",
        boxSizing: "border-box",
        zIndex: 2,
        "&[data-over='warning']": { boxShadow: "inset 0 0 0 1.5px {colors.status.warn}" },
        "&[data-over='danger']":  { boxShadow: "inset 0 0 0 1.5px {colors.status.neg}" },
        "&[data-over='info']":    { boxShadow: "inset 0 0 0 1.5px {colors.status.info}" },
        "&[data-over='success']": { boxShadow: "inset 0 0 0 1.5px {colors.status.pos}" },
        "&[data-over='neutral']": { boxShadow: "inset 0 0 0 1.5px {colors.fg.subtle}" },
    },
    // The tile chip inside a cell — the `.chk` / `.pchip` looks on the
    // lifecycle axis: confirmed/actual = the solid ink ✓ chip; proposals
    // = the paper-bg brand-dashed italic chip (grip glyph on the resting
    // `plan` form); removed / estimated / rejected extend the §4.3 table.
    tile: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px",
        height: "var(--plan-tile-h)",
        minWidth: "20px",
        flex: "none",
        borderRadius: "3px",
        fontFamily: "mono",
        fontSize: "9px",
        fontWeight: "semibold",
        overflow: "hidden",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
        padding: "0 5px",
        "& svg": { fontSize: "8px" },
        // The lifecycle axis (§4.3), shared (`states.ts`). A tile rests as
        // the muted ink ✓ chip; its other states sit on paper and take a
        // tighter 2px radius, and a proposal's grip glyph dims.
        ...lifecycleStates({
            obs: { background: "fg.muted", color: "bg.surface" },
            appr: { background: "fg.muted", color: "bg.surface" },
            marked: { borderRadius: "2px" },
            prop: { background: "bg.surface", "& svg": { opacity: 0.8 } },
            propRemoved: { background: "bg.surface", color: "fg.muted" },
        }),
        "&[data-tone='warning']": { boxShadow: "0 0 0 1.5px {colors.status.warn}" },
        "&[data-tone='danger']":  { boxShadow: "0 0 0 1.5px {colors.status.neg}" },
        "&[data-tone='success']": { boxShadow: "0 0 0 1.5px {colors.status.pos}" },
        "&[data-tone='info']":    { boxShadow: "0 0 0 1.5px {colors.status.info}" },
        "&[data-pulse]": {
            animation: "elara-pulse 1.6s ease-in-out infinite",
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        },
        // A tile that moves (#825) is picked up where it sits.
        "&[data-draggable]": { cursor: "grab" },
        // ── R1 GEOMETRY SHRINKS — the bucket case ──
        // A tile is already quantised to its cell; collapsing keeps the
        // cell and flattens the tile inside it. `minWidth` has to go with
        // it or a 20px floor would fight the 7px block.
        "&[data-ctx]": {
            height: "var(--plan-strip-mark-h)",
            minWidth: 0,
            color: "transparent",
            padding: 0,
            gap: 0,
            borderRadius: "1px",
            transition: "height 380ms cubic-bezier(0.16, 1, 0.3, 1)",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        },
        ...planElementFocus,
    },
    // A labelled tile's text — its own flex item, so a label wider than
    // the tile (a stretched tile in a 356px lane cell) ellipsizes instead
    // of the centred text clipping on both sides ("MIXED" read "IXE").
    tileLabel: {
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    // The per-cell lane caption (`.bl`) — printed at each cell's left.
    laneLabel: {
        fontFamily: "mono",
        fontSize: "8px",
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
    },
    // ── Cards chips (K6) — the Roster `.shift` chip, verbatim: 5px
    //    radius, brand tint + 1px brand ring, mono 10/500, text left ──
    cardChip: {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        height: "var(--plan-chip-h)",
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
        // The lifecycle axis (§4.3), shared (`states.ts`). A chip rests on
        // the brand tint in a 1px brand ring (the Roster `.shift`); its
        // proposal and removal sit on paper, the removal in the warn ink.
        ...lifecycleStates({
            obs: { background: "{colors.brandTint}", color: "fg.default", boxShadow: "inset 0 0 0 1px {colors.brand.600}" },
            appr: { background: "{colors.brandTint}", color: "fg.default", boxShadow: "inset 0 0 0 1px {colors.brand.600}" },
            prop: { background: "bg.surface" },
            propRemoved: { background: "bg.surface", color: "{colors.status.warn}" },
        }),
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
        ...planElementFocus,
    },
    // ── Table cells (K5) — the Table `.tcell` verbatim: right-aligned
    //    mono numerals per bucket (renderer sets left/width per bucket);
    //    footer = bold ink, header = caption-styled numerals ──
    tableCellText: {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        textAlign: "right",
        paddingRight: "10px",
        boxSizing: "border-box",
        overflow: "hidden",
        fontFamily: "mono",
        fontSize: "10.5px",
        fontWeight: "medium",
        color: "fg.muted",
        whiteSpace: "nowrap",
        zIndex: 2,
        // Multi-series part layouts — side by side, or stacked lines.
        "&[data-split='horizontal']": {
            display: "flex",
            justifyContent: "flex-end",
            gap: "6px",
        },
        "&[data-split='vertical']": {
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "1px",
            lineHeight: "var(--plan-table-line-h)",
        },
        // A 356px card body gives a bucket ~25px. The desktop's 10px
        // right inset and 10.5px numerals were sized for 54px columns —
        // a three-digit numeral clipped its first digit — so a card cell
        // keeps a 2px inset at 9.5px (§10: density relaxes, the vocabulary
        // does not), and two numerals side by side overlap there, so the
        // narrow layout stacks a horizontal split the way `vertical`
        // does; the row's `split` is a DESKTOP layout choice and the
        // mobile answer is one column.
        "[data-plan-narrow] &": {
            paddingRight: "2px",
            fontSize: "9.5px",
            "&[data-split='horizontal']": {
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "1px",
                lineHeight: "var(--plan-table-line-h)",
            },
        },
        "[data-emphasis='footer'] &": { fontWeight: "semibold", color: "fg.default" },
        "[data-emphasis='header'] &": {
            fontSize: "8.5px",
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
    tableCellPart: {
        "&[data-tone='neg']":   { color: "{colors.status.neg}" },
        "&[data-tone='muted']": { color: "fg.subtle" },
        "&[data-strong]":       { fontWeight: "semibold", color: "fg.default" },
    },
} satisfies Record<(typeof cellsSlots)[number], SystemStyleObject>;
