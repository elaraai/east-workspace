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
 * and the canvas's geometry variables (`collections/plan/geometry.ts`).
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";
import { lifecycleStates } from "./states.js";
import { planElementFocus } from "./focus.js";

/** The slots this part styles. */
export const elementsSlots = [
    "bar", "barQty", "rollBand", "port", "diamond", "chartTickLeft", "chartTickRight", "refLabel",
    "chartReadout", "chartReadoutValue", "milestoneDot", "exceptionTri", "markIcon", "markLabel",
    "moveEdge", "moveGhost", "moveGhostLabel", "moveGhostSpan",
] as const;

/** An element that moves (#825) is picked up where it sits. */
const grab = { "&[data-draggable]": { cursor: "grab" } } satisfies SystemStyleObject;

/** Their base styles. */
export const elementsBase = {
    // ── Span bars — base geometry; `data-state` drives the truth table ──
    bar: {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        borderRadius: "2px",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "0 7px",
        fontFamily: "mono",
        fontSize: "10px",
        fontWeight: "semibold",
        whiteSpace: "nowrap",
        overflow: "hidden",
        boxSizing: "border-box",
        zIndex: 2,
        // The lifecycle axis (§4.3), shared (`states.ts`). A bar's resting
        // looks: observed / executing is solid ink with paper text, confirmed
        // a paper fill in a 1.5px solid brand ring. Its proposal sits on the
        // brand tint and its removal on nothing.
        ...lifecycleStates({
            obs: { background: "fg.default", color: "bg.surface" },
            appr: { background: "bg.surface", color: "fg.default", boxShadow: "inset 0 0 0 1.5px {colors.brand.600}" },
            prop: { background: "{colors.brandTint}" },
            propRemoved: { background: "transparent", color: "fg.muted" },
        }),
        // over-dwell / flagged — the warn ring rides any state.
        "&[data-stuck]": { boxShadow: "0 0 0 1.5px {colors.status.warn}" },
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
        ...planElementFocus,
    },
    barQty: {
        opacity: 0.72,
        fontWeight: "medium",
        flexShrink: 0,
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
        fontSize: "8.5px",
        fontWeight: "semibold",
        whiteSpace: "nowrap",
        overflow: "hidden",
        zIndex: 2,
        background: "color-mix(in srgb, {colors.fg.default} 82%, transparent)",
        color: "bg.surface",
        "&[data-state='prop'], &[data-state='estimated']": {
            background: "{colors.brandTint}",
            color: "brand.fg",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "{colors.brand.600}",
        },
        "&[data-state='appr']": {
            background: "bg.surface",
            color: "fg.default",
            boxShadow: "inset 0 0 0 1px {colors.brand.600}",
        },
        "&[data-state='rejected']": {
            background: "transparent",
            color: "fg.subtle",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "{colors.gray.400}",
        },
    },
    // Quantity in/out port glyph on a span row.
    port: {
        position: "absolute",
        width: "7px",
        height: "7px",
        borderRadius: "full",
        background: "bg.surface",
        boxShadow: "inset 0 0 0 1.5px {colors.brand.600}",
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
        boxShadow: "inset 0 0 0 1.5px {colors.brand.600}, 0 0 0 2px {colors.bg.surface}",
        zIndex: 4,
        "&[data-applied]": { background: "{colors.brand.600}" },
        // An EVENT-ROW decision mark (K7 — the diamond carries `data-mark`)
        // is 11px, the §8 sheet's "◇/◆ 11px rotate-45 r1"; a span row's
        // decision diamond on a run transition stays the 9px above.
        "&[data-mark]": { width: "11px", height: "11px" },
        // ── R3 SHAPE KEEPS ITS SILHOUETTE, LOSES ITS SIZE (#591) ──
        // Milestone / decision / exception are told apart BY OUTLINE, so
        // the outline is the payload: shrink it, never make it
        // transparent — that would erase the row's whole meaning.
        "&[data-ctx]": { width: "6px", height: "6px", borderRadius: 0},
        ...grab,
        ...planElementFocus,
    },
    // ── Chart rows — axis ticks + ref labels (marks are SVG, data-coloured) ──
    chartTickLeft: {
        position: "absolute",
        right: "4px",
        fontFamily: "mono",
        fontSize: "8.5px",
        color: "fg.subtle",
        transform: "translateY(-50%)",
        pointerEvents: "none",
        // An EXPANDED row pins its active ⤢ control to the band's corner
        // (`rowControls[data-expanded]`: top 11px, right 6px, a 20px
        // button in a 3px paper halo) — exactly where a 32px band's
        // ticks sit. The ticks step left of the pill's footprint so the
        // axis stays legible while the row has the canvas (#591).
        "[data-expanded] &": { right: "36px" },
    },
    chartTickRight: {
        position: "absolute",
        right: "3px",
        fontFamily: "mono",
        fontSize: "8.5px",
        color: "fg.subtle",
        transform: "translateY(-50%)",
        pointerEvents: "none",
        zIndex: 4,
    },
    refLabel: {
        position: "absolute",
        fontFamily: "mono",
        fontSize: "8px",
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
        fontSize: "8.5px",
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
    milestoneDot: {
        position: "absolute",
        width: "10px",
        height: "10px",
        borderRadius: "full",
        background: "{colors.brand.600}",
        transform: "translate(-50%, -50%)",
        top: "50%",
        zIndex: 3,
        // ── R3 SHAPE KEEPS ITS SILHOUETTE, LOSES ITS SIZE (#591) ──
        // Milestone / decision / exception are told apart BY OUTLINE, so
        // the outline is the payload: shrink it, never make it
        // transparent — that would erase the row's whole meaning.
        "&[data-ctx]": { width: "5px", height: "5px"},
        ...grab,
        ...planElementFocus,
    },
    exceptionTri: {
        position: "absolute",
        width: 0,
        height: 0,
        borderLeft: "5px solid transparent",
        borderRight: "5px solid transparent",
        borderBottom: "9px solid {colors.status.warn}",
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
        ...planElementFocus,
    },
    // K7 icon swap — hosts choose the glyph, never the geometry
    // (12px, kind-coloured: brand default, warn for exceptions).
    markIcon: {
        position: "absolute",
        top: "50%",
        transform: "translate(-50%, -50%)",
        fontSize: "12px",
        lineHeight: 1,
        color: "{colors.brand.600}",
        zIndex: 3,
        "&[data-kind='exception']": { color: "{colors.status.warn}" },
        // ── R4 ICONS (#591) ──
        // A K7 override swaps a mark's default geometry for the host's own
        // 12px FA icon. At strip size a detailed glyph is an unreadable
        // blob, so the RENDERER falls back to the kind's default geometry
        // (see `EventsRow`) and this element never mounts collapsed. The
        // rule stays as a backstop for any path that does mount one.
        "&[data-ctx]": { display: "none" },
        ...grab,
        ...planElementFocus,
    },
    markLabel: {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        fontFamily: "mono",
        fontSize: "8.5px",
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
        boxShadow: "inset 0 0 0 1.5px {colors.brand.600}, 0 4px 12px -4px color-mix(in srgb, {colors.fg} 30%, transparent)",
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
        fontSize: "9px",
        fontWeight: "medium",
        color: "brand.fg",
    },
} satisfies Record<(typeof elementsSlots)[number], SystemStyleObject>;
