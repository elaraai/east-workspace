/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan recipe's MARKS drawn at an instant — span bars and rollup bands,
 * ports and decision diamonds, the chart rows' ticks, labels and crosshair
 * readout, and the event rows' marks.
 *
 * One part of the Plan slot recipe (`../plan.ts`, #817), over semantic tokens
 * and the canvas's geometry variables (e3-ui-components' `plan/geometry.ts`).
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";
import { lifecycleStates } from "./states.js";
import { PLAN_OVERLAP_RING, planElementFocus, planElementSelected } from "./focus.js";

/** The slots this part styles. */
export const elementsSlots = [
    "bar", "barLabel", "barQty", "rollBand", "port", "diamond", "chartMarks", "chartRefBand", "chartTickLeft", "chartTickRight", "refLabel",
    "chartReadout", "chartReadoutValue", "milestoneDot", "exceptionTri", "markIcon", "markLabel",
    "moveEdge", "moveGhost", "moveGhostLabel", "moveGhostSpan",
] as const;

/** An element that moves (#825) is picked up where it sits. */
const grab = { "&[data-draggable]": { cursor: "grab" } } satisfies SystemStyleObject;

/** Their base styles. */
export const elementsBase = {
    // ── Span bars — base geometry; `data-state` drives the truth table ──
    // The label holds the bar (#1258): the quantity shows beside it only when
    // both fit whole. The bar is a wrapping row whose one line fills the box
    // inside its border, so a quantity that does not fit wraps to a second
    // line the bar clips, and the label, alone on the first, ellipsizes when
    // it alone does not fit. Its height is the canvas's bar, or a collapsed
    // parent's rollup bar (`data-rolled`). It is a size container, so its
    // text's line is exactly the height inside its border as the page draws
    // it (`100cqh`) — a lifecycle look's 1.5px dash is drawn 1px at 1×.
    // A run too short for its padding draws the canvas's narrowest bar from
    // its start, and a link leaves it where it ends as drawn (#1258).
    bar: {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        height: "var(--plan-bar-h)",
        minWidth: "var(--plan-bar-min-w)",
        "&[data-rolled]": { height: "var(--plan-roll-bar-h)" },
        containerType: "size",
        borderRadius: "2px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        alignContent: "flex-start",
        columnGap: "4px",
        rowGap: 0,
        padding: "0 7px",
        fontFamily: "mono",
        fontSize: "11px",
        fontWeight: "semibold",
        whiteSpace: "nowrap",
        overflow: "hidden",
        boxSizing: "border-box",
        zIndex: 2,
        // The lifecycle axis (§4.3), shared (`states.ts`). A bar's resting
        // looks: observed / executing is the ONE committed fill (#949,
        // production's brand-700) with paper text, confirmed a paper fill in
        // a 1.5px solid brand ring. Its proposal sits on the brand tint and
        // its removal on nothing.
        ...lifecycleStates({
            obs: { background: "brand.emphasized", color: "bg.surface" },
            appr: { background: "bg.surface", color: "fg.default", boxShadow: "inset 0 0 0 1.5px {colors.brand.solid}" },
            prop: { background: "{colors.brandTint}" },
            propRemoved: { background: "transparent", color: "fg.muted" },
        }),
        // over-dwell / flagged — the warn ring rides any state.
        "&[data-stuck]": { boxShadow: "0 0 0 1.5px {colors.status.warn}" },
        // An event in an overlap pair (#1198) — the same warn ring; a
        // confirmed bar keeps its inset brand ring inside it.
        "&[data-overlap]": { boxShadow: PLAN_OVERLAP_RING },
        "&[data-overlap][data-state='appr']": { boxShadow: `inset 0 0 0 1.5px {colors.brand.solid}, ${PLAN_OVERLAP_RING}` },
        // runs past the window — mask-fade right, never a fabricated end.
        "&[data-runoff]": {
            maskImage: "linear-gradient(to right, black 84%, transparent 99%)",
        },
        ...grab,
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
    // A span's label — whole, or ellipsized when it alone does not fit, its
    // line the bar's inside height (#1258).
    barLabel: {
        flex: "0 1 auto",
        minWidth: 0,
        lineHeight: "100cqh",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    // A span's quantity — the label's own weight (#949: one weight per span).
    // It never shrinks: when it does not fit beside the label it wraps out of
    // the bar's line, whole (#1258).
    barQty: {
        opacity: 0.72,
        fontWeight: "semibold",
        flexShrink: 0,
        lineHeight: "100cqh",
        whiteSpace: "nowrap",
    },
    // Parent rollup band — 12px, centred `×k · qty` caption.
    rollBand: {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        height: "var(--plan-roll-bar-h)",
        borderRadius: "2px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "semibold",
        whiteSpace: "nowrap",
        overflow: "hidden",
        zIndex: 2,
        background: "color-mix(in srgb, {colors.brand.emphasized} 82%, transparent)",
        color: "bg.surface",
        "&[data-state='prop'], &[data-state='estimated']": {
            background: "{colors.brandTint}",
            color: "brand.fg",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "{colors.brand.solid}",
        },
        "&[data-state='appr']": {
            background: "bg.surface",
            color: "fg.default",
            boxShadow: "inset 0 0 0 1px {colors.brand.solid}",
        },
        "&[data-state='rejected']": {
            background: "transparent",
            color: "fg.subtle",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "border.strong",
        },
    },
    // Quantity in/out port glyph on a span row.
    port: {
        position: "absolute",
        width: "7px",
        height: "7px",
        borderRadius: "full",
        background: "bg.surface",
        boxShadow: "inset 0 0 0 1.5px {colors.brand.solid}",
        zIndex: 4,
        transform: "translate(-50%, -50%)",
        top: "50%",
    },
    // Decision diamond — 9px rotate-45, 1.5px brand, paper ring; applied fills.
    diamond: {
        position: "absolute",
        width: "9px",
        height: "9px",
        transform: "translate(-50%, -50%) rotate(45deg)",
        top: "50%",
        borderRadius: "1px",
        background: "bg.surface",
        boxShadow: "inset 0 0 0 1.5px {colors.brand.solid}, 0 0 0 2px {colors.bg.surface}",
        zIndex: 4,
        "&[data-applied]": { background: "{colors.brand.solid}" },
        // An EVENT-ROW decision mark (K7 — the diamond carries `data-mark`)
        // is the canvas's mark diamond, the §8 sheet's "◇/◆ 11px rotate-45
        // r1" — a link meets its corners (#1258); a span row's decision
        // diamond on a run transition stays the 9px above.
        "&[data-mark]": { width: "var(--plan-mark-diamond-w)", height: "var(--plan-mark-diamond-w)" },
        // ── R3 SHAPE KEEPS ITS SILHOUETTE, LOSES ITS SIZE (#591) ──
        // Milestone / decision / exception are told apart BY OUTLINE, so
        // the outline is the payload: shrink it, never make it
        // transparent — that would erase the row's whole meaning.
        "&[data-ctx]": { width: "6px", height: "6px", borderRadius: 0},
        ...grab,
        ...planElementSelected,
        ...planElementFocus,
    },
    // ── Chart rows — the marks, axis ticks + ref labels ──
    // A chart row's marks (#949): the svg fills the plot, and every mark's
    // fill, stroke and dash is this slot's, selected by the mark's own
    // attributes — series 1 in `brand.solid` (--brand-d, the chart rule), a
    // forecast in a lighter mix of its own hue, a comparison series in the
    // chart accents in their fixed order (teal → purple → blue → orange), a
    // breach in warn. The renderer draws geometry only.
    chartMarks: {
        position: "absolute",
        inset: 0,
        zIndex: 3,
        display: "block",
        overflow: "visible",
        "& [data-plan-mark='column']": { fill: "brand.solid" },
        "& [data-plan-mark='column'][data-planned]": { fill: "color-mix(in srgb, {colors.brand.solid} 40%, {colors.bg.surface})" },
        "& [data-plan-mark='column'][data-series='1']": { fill: "accent.teal" },
        "& [data-plan-mark='column'][data-series='1'][data-planned]": { fill: "color-mix(in srgb, {colors.accent.teal} 40%, {colors.bg.surface})" },
        "& [data-plan-mark='column'][data-series='2']": { fill: "accent.purple" },
        "& [data-plan-mark='column'][data-series='2'][data-planned]": { fill: "color-mix(in srgb, {colors.accent.purple} 40%, {colors.bg.surface})" },
        "& [data-plan-mark='column'][data-series='3']": { fill: "accent.blue" },
        "& [data-plan-mark='column'][data-series='3'][data-planned]": { fill: "color-mix(in srgb, {colors.accent.blue} 40%, {colors.bg.surface})" },
        "& [data-plan-mark='column'][data-series='4']": { fill: "accent.orange" },
        "& [data-plan-mark='column'][data-series='4'][data-planned]": { fill: "color-mix(in srgb, {colors.accent.orange} 40%, {colors.bg.surface})" },
        "& [data-plan-mark='column'][data-warn]": { fill: "{colors.status.warn}" },
        "& [data-plan-mark='line'], & [data-plan-mark='line-planned'], & [data-plan-mark='area-line']": {
            fill: "none",
            stroke: "brand.solid",
            strokeWidth: "1.5px",
        },
        "& [data-plan-mark='line-planned']": { strokeDasharray: "4 3" },
        "& [data-plan-mark='band'], & [data-plan-mark='area']": {
            fill: "color-mix(in srgb, {colors.brand.solid} 14%, transparent)",
            stroke: "none",
        },
        "& [data-plan-mark='breach']": { fill: "{colors.status.warn}", stroke: "none" },
        "& [data-plan-mark='breach-rect']": {
            fill: "none",
            stroke: "{colors.status.warn}",
            strokeWidth: "1.5px",
            strokeDasharray: "3 2",
        },
        "& [data-plan-mark='refline']": { stroke: "fg.subtle", strokeWidth: "1px", strokeDasharray: "2 3" },
        "& [data-plan-mark='scatter']": { fill: "accent.purple", stroke: "none" },
        "& [data-plan-mark='refdot']": { fill: "bg.surface", stroke: "brand.solid", strokeWidth: "1.5px" },
    },
    // A reference band — the paper wash under every mark, across its span.
    chartRefBand: {
        position: "absolute",
        top: 0,
        bottom: 0,
        zIndex: 1,
        pointerEvents: "none",
        background: "color-mix(in srgb, {colors.fg} 4%, transparent)",
    },
    chartTickLeft: {
        position: "absolute",
        right: "4px",
        fontFamily: "mono",
        fontSize: "9.5px",
        color: "fg.subtle",
        transform: "translateY(-50%)",
        pointerEvents: "none",
        // A row's controls are always shown, at its gutter line's end
        // (`rowControls`, #1258) — where the ticks sit. The ticks step left
        // of them, so the axis stays legible (#591): the cell's 12px padding,
        // the 24px buttons and a 4px gap.
        "[data-plan-controls='1'] &": { right: "40px" },
        "[data-plan-controls='2'] &": { right: "64px" },
    },
    chartTickRight: {
        position: "absolute",
        right: "3px",
        fontFamily: "mono",
        fontSize: "9.5px",
        color: "fg.subtle",
        transform: "translateY(-50%)",
        pointerEvents: "none",
        zIndex: 4,
    },
    refLabel: {
        position: "absolute",
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "semibold",
        letterSpacing: "0.08em",
        color: "fg.subtle",
        background: "bg.surface",
        padding: "0 3px",
        zIndex: 4,
        pointerEvents: "none",
    },
    // The crosshair readout (#743) — each data layer's value at the
    // hovered bucket, beside that bucket, in the ref-label vocabulary.
    // The cursor channel fills, places and opens it (`data-open`), so a
    // hover renders nothing; above the now line so it stays legible.
    chartReadout: {
        position: "absolute",
        top: "2px",
        display: "none",
        alignItems: "center",
        gap: "6px",
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "semibold",
        letterSpacing: "0.02em",
        color: "fg.default",
        background: "bg.surface",
        borderRadius: "2px",
        padding: "0 4px",
        boxShadow: "0 0 0 1px {colors.border.subtle}",
        whiteSpace: "nowrap",
        pointerEvents: "none",
        zIndex: 8,
        "&[data-open]": { display: "flex" },
    },
    // One layer's value — in its mark's ink: lines, areas and bands the
    // brand, columns the default ink, scatter the chart accent.
    chartReadoutValue: {
        "&[data-kind='line'], &[data-kind='area'], &[data-kind='band']": { color: "brand.fg" },
        "&[data-kind='scatter']": { color: "accent.purple" },
    },
    // ── Event marks (K7) — ● milestone · ◇◆ decision (diamond slot) · ▲ exception ──
    // Each glyph's size is the canvas's (`--plan-mark-…`), so a link meets a
    // mark at the glyph's edges (#1258).
    milestoneDot: {
        position: "absolute",
        width: "var(--plan-mark-dot-w)",
        height: "var(--plan-mark-dot-w)",
        borderRadius: "full",
        background: "{colors.brand.solid}",
        transform: "translate(-50%, -50%)",
        top: "50%",
        zIndex: 3,
        // ── R3 SHAPE KEEPS ITS SILHOUETTE, LOSES ITS SIZE (#591) ──
        // Milestone / decision / exception are told apart BY OUTLINE, so
        // the outline is the payload: shrink it, never make it
        // transparent — that would erase the row's whole meaning.
        "&[data-ctx]": { width: "5px", height: "5px"},
        // An event in an overlap pair (#1198): the warn ring, round the dot.
        "&[data-overlap]": { boxShadow: PLAN_OVERLAP_RING },
        ...grab,
        ...planElementSelected,
        ...planElementFocus,
    },
    // An exception's triangle draws no overlap ring: it is the warn mark
    // already, and a ring round a border-drawn triangle is its square box.
    exceptionTri: {
        position: "absolute",
        width: 0,
        height: 0,
        // The borders ARE the triangle: half its base either side, its height below.
        borderLeftWidth: "calc(var(--plan-mark-triangle-w) / 2)",
        borderLeftStyle: "solid",
        borderLeftColor: "transparent",
        borderRightWidth: "calc(var(--plan-mark-triangle-w) / 2)",
        borderRightStyle: "solid",
        borderRightColor: "transparent",
        borderBottomWidth: "var(--plan-mark-triangle-h)",
        borderBottomStyle: "solid",
        borderBottomColor: "{colors.status.warn}",
        transform: "translate(-50%, -50%)",
        top: "50%",
        zIndex: 3,
        // ── R3, the border-triangle case — a CSS triangle has no width or
        // height to shrink, so the borders that ARE its size are halved.
        "&[data-ctx]": {
            borderLeftWidth: "3.5px",
            borderRightWidth: "3.5px",
            borderBottomWidth: "6px",
        },
        ...grab,
        ...planElementSelected,
        ...planElementFocus,
    },
    // K7 icon swap — hosts choose the glyph, never the geometry: the icon
    // fits the canvas's square icon box (`--plan-mark-icon-w`), whatever its
    // own proportions, so a link meets the box's edges (#1258);
    // kind-coloured: brand default, warn for exceptions.
    markIcon: {
        position: "absolute",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: "var(--plan-mark-icon-w)",
        height: "var(--plan-mark-icon-w)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        "& svg": { width: "100%", height: "100%" },
        lineHeight: 1,
        color: "{colors.brand.solid}",
        zIndex: 3,
        "&[data-kind='exception']": { color: "{colors.status.warn}" },
        // ── R4 ICONS (#591) ──
        // A K7 override swaps a mark's default geometry for the host's own
        // 12px FA icon. At strip size a detailed glyph is an unreadable
        // blob, so the RENDERER falls back to the kind's default geometry
        // (see `EventsRow`) and this element never mounts collapsed. The
        // rule stays as a backstop for any path that does mount one.
        "&[data-ctx]": { display: "none" },
        // An event's mark wears its kind's icon (#1192): in an overlap pair
        // (#1198), the warn ring round it.
        "&[data-overlap]": { boxShadow: PLAN_OVERLAP_RING },
        ...grab,
        ...planElementSelected,
        ...planElementFocus,
    },
    markLabel: {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "semibold",
        letterSpacing: "0.06em",
        color: "fg.muted",
        whiteSpace: "nowrap",
        zIndex: 3,
        pointerEvents: "none",
        "&[data-ctx]": { display: "none" },
    },
    // ── Moves (#825) ──
    // A run's or a chip's end handle — the element's first / last 6px, where
    // a press drags that end. A hairline grip shows on the element's hover;
    // a touch gets a wider target.
    moveEdge: {
        position: "absolute",
        top: 0,
        bottom: 0,
        width: "6px",
        cursor: "ew-resize",
        zIndex: 1,
        "&[data-plan-edge='start']": { left: 0 },
        "&[data-plan-edge='end']": { right: 0 },
        "&::after": {
            content: "''",
            position: "absolute",
            top: "3px",
            bottom: "3px",
            left: "2px",
            width: "2px",
            borderRadius: "1px",
            background: "currentColor",
            opacity: 0,
            transition: "opacity 120ms",
        },
        "[data-draggable]:hover > &": { "&::after": { opacity: 0.55 } },
        "@media (hover: none)": { width: "10px" },
    },
    // The ghost beside the pointer — the element's name over the span it
    // would take, on paper in a brand ring.
    moveGhost: {
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "1px",
        padding: "3px 8px",
        borderRadius: "3px",
        background: "bg.surface",
        boxShadow: "inset 0 0 0 1.5px {colors.brand.solid}",
        fontFamily: "mono",
        whiteSpace: "nowrap",
        pointerEvents: "none",
    },
    moveGhostLabel: {
        fontSize: "10px",
        fontWeight: "semibold",
        color: "fg.default",
    },
    moveGhostSpan: {
        fontSize: "9.5px",
        fontWeight: "medium",
        color: "brand.fg",
    },
} satisfies Record<(typeof elementsSlots)[number], SystemStyleObject>;
