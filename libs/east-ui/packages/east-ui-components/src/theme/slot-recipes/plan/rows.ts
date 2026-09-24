/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan recipe's ROWS — the alignment contract (gutter cell + plot), the
 * gutter vocabulary, the row-focus controls, rails, gap bands and strips (R1 /
 * R2), the expand-in-place render, and the group band.
 *
 * One part of the Plan slot recipe (`../plan.ts`, #817), over semantic tokens
 * and the canvas's geometry variables (`collections/plan/geometry.ts`).
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";
import { planElementFocus, planRowFocus } from "./focus.js";

/** The slots this part styles. */
export const rowsSlots = [
    "row", "gutterCell", "plot", "gridCol", "gridSep", "dropPreview", "gutterName", "gutterSub",
    "gutterValue", "gutterRight", "gutterMeta", "gutterSwatch", "caret", "statusDot",
    "rowControls", "rowControl", "focusTag", "rail", "focusGap", "focusGapInner", "ribbons", "expandRowBand",
    "expandRenderBody", "expandGutterBody", "toneCell", "groupBand", "groupName", "groupMeta",
] as const;

/** Their base styles. */
export const rowsBase = {
    // ── The alignment contract: gutter cell + plot per row ──
    row: {
        display: "grid",
        position: "relative",
        // Inside the row's height — its plot cell is the row less this (#818).
        borderBottomWidth: "var(--plan-rule-h)",
        borderBottomColor: "border.subtle",
        background: "bg.surface",
        // Selection tint — the one selection colour.
        "&[data-selected]": { background: "{colors.brandTint}" },
        // Table-row emphasis (K5): footer = 2px top rule; header = panel wash.
        "&[data-emphasis='footer']": { borderTopWidth: "2px", borderTopColor: "border.strong" },
        "&[data-emphasis='header']": { background: "bg.panel" },
        // ── R2 context strip (#591) ──
        // "Collapse, never remove": an unfocused row keeps its place, its
        // order and its marks — it just stops competing for attention.
        // The 16px height comes from `rowHeight`; this is the rest.
        "&[data-ctx]": {
            background: "bg.panel",
            cursor: "pointer",
            overflow: "hidden",
            "&:hover": { background: "{colors.brandTint}" },
        },
        // ── R2 the FOCUSED row (#591) ──
        // The row grows to hold its render, so the tint runs across the
        // gutter AND the plot as one band — that continuity is what reads
        // as "this row has the canvas" rather than "a panel opened below
        // a row".
        "&[data-expanded]": {
            background: "{colors.brandTint}",
            transition: "background 380ms cubic-bezier(0.16, 1, 0.3, 1)",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        },
        // The grid's one tab stop, on the keyboard (#819).
        ...planRowFocus,
    },
    gutterCell: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "4px 12px",
        borderRightWidth: "1px",
        borderRightColor: "border.subtle",
        minWidth: 0,
        overflow: "hidden",
        position: "relative",
        // ── R2 (#591) ── The expanded row's gutter is ONE TALL CELL
        // spanning the row and its render. Its content stops centring and
        // stacks from the top, which is what opens the space `expandGutter`
        // fills; the right border picks up the brand so the grown cell
        // reads as part of the focused band.
        "&[data-expanded]": {
            justifyContent: "flex-start",
            paddingTop: "11px",
            borderRightColor: "color-mix(in srgb, {colors.brand.600} 30%, {colors.border.subtle})",
        },
    },
    plot: {
        position: "relative",
        minWidth: 0,
        overflow: "hidden",
        // R2 `axis` (#591) — the shared grid + now-line are real elements
        // in this cell, so the treatment applies HERE, to the row that
        // declared it. `dim` washes them behind dense render content;
        // `off` suppresses them inside this row only. The ruler is a
        // different element entirely and never moves either way.
        "&[data-axis='dim'] [data-plan-axisline]": { opacity: 0.4 },
        "&[data-axis='off'] [data-plan-axisline]": { display: "none" },
    },
    // A single bucket's background grid line (column separators). The
    // expand render's `axis` treatment washes / suppresses them INSIDE
    // the expanded row only ("keep" is the bare default).
    gridCol: {
        position: "absolute",
        top: 0,
        bottom: 0,
        width: 0,
        borderLeftWidth: "1px",
        borderLeftColor: "border.subtle",
        pointerEvents: "none",
        "[data-axis='dim'] &": { opacity: 0.4 },
        "[data-axis='off'] &": { display: "none" },
    },
    // ALL interior separators of an equal-bucket row as ONE element
    // (#616): a repeating gradient at one bucket width, starting at the
    // first interior edge (the renderer sets `left` + the tile size). The
    // per-edge `gridCol` divs remain the unequal-bucket fallback.
    gridSep: {
        position: "absolute",
        top: 0,
        bottom: 0,
        right: 0,
        pointerEvents: "none",
        "[data-axis='dim'] &": { opacity: 0.4 },
        "[data-axis='off'] &": { display: "none" },
    },
    // The landing band — where a dragged library card would come to rest if
    // it were dropped right now. It spans the BUCKET the drop coordinate
    // resolves to, so it is truthful by construction: the same bucket
    // `resolveCoord` names is the one painted.
    //
    // Visibility is driven entirely by the cell's own stage attribute, not
    // by a second piece of JS state that could disagree with it. The layer
    // sets `data-drop-active` on exactly the destination cell and never
    // sets it alongside `data-drop-invalid`, so a refused row shows no
    // landing band without anything here having to know why.
    //
    // Dashed edges over a faint wash — "dashed = ephemeral" in the stage
    // vocabulary, the same reading as the candidate frame.
    dropPreview: {
        position: "absolute",
        top: 0,
        bottom: 0,
        display: "none",
        pointerEvents: "none",
        zIndex: 5,
        // Read against the ACTIVE cell's own brand wash, not against the
        // bare row — the band only ever appears inside `[data-drop-active]`,
        // which is already tinted, so a faint fill disappears into it.
        background: "color-mix(in srgb, {colors.brand.500} 30%, transparent)",
        borderLeftWidth: "1.5px",
        borderRightWidth: "1.5px",
        borderTopWidth: "0",
        borderBottomWidth: "0",
        borderStyle: "dashed",
        borderColor: "{colors.brand.600}",
        "[data-drop-active] &": { display: "block" },
    },
    // ── Gutter vocabulary ──
    gutterName: {
        fontSize: "12.5px",
        fontWeight: "medium",
        color: "fg.default",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        display: "flex",
        alignItems: "center",
        gap: "5px",
        // Mono row-id treatment (`.nm.id`).
        "&[data-id]": {
            fontFamily: "mono",
            fontSize: "11.5px",
            fontWeight: "semibold",
            letterSpacing: "0.02em",
        },
        // In a strip every name reads as an id — one 10px mono line is
        // all 16px can carry, and uniformity is what makes the stack
        // scannable.
        "&[data-ctx]": {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "fg.muted",
        },
    },
    gutterSub: {
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "medium",
        color: "fg.subtle",
        marginTop: "1px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        "&[data-ctx]": { display: "none" },
    },
    gutterValue: {
        fontFamily: "mono",
        fontSize: "10.5px",
        fontWeight: "semibold",
        color: "fg.default",
        "&[data-ctx]": { display: "none" },
    },
    // The right-anchored gutter cluster — meta / value / status dot (§3).
    // An inline flex item pushed right by `margin-left: auto` (the mock's
    // `.grow` spacer) — never absolute, so a long row label ellipsizes
    // against it instead of running underneath at deep indents.
    gutterRight: {
        marginLeft: "auto",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        flexShrink: 0,
        paddingLeft: "8px",
    },
    // `.pl-gut .meta` — mono 9.5/500 ink-4, box-centred in the right
    // cluster (never baseline-aligned against the name).
    gutterMeta: {
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "medium",
        color: "fg.subtle",
        whiteSpace: "nowrap",
        "&[data-ctx]": { display: "none" },
    },
    gutterSwatch: {
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        fontFamily: "mono",
        fontSize: "8.5px",
        color: "fg.subtle",
        "& > i": { width: "7px", height: "7px", borderRadius: "1.5px", display: "inline-block" },
        "&[data-ctx]": { display: "none" },
    },
    caret: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "11px",
        color: "fg.subtle",
        width: "14px",
        flexShrink: 0,
        transition: "transform 0.15s",
        "&[data-collapsed]": { transform: "rotate(-90deg)" },
    },
    statusDot: {
        width: "6px",
        height: "6px",
        borderRadius: "full",
        flexShrink: 0,
        "&[data-tone='warning']": { background: "{colors.status.warn}" },
        "&[data-tone='danger']":  { background: "{colors.status.neg}" },
        "&[data-tone='success']": { background: "{colors.status.pos}" },
        "&[data-tone='info']":    { background: "{colors.status.info}" },
        "&[data-tone='neutral']": { background: "fg.subtle" },
        "&[data-ctx]": { width: "5px", height: "5px" },
    },
    // ── Row focus (R1 links / R2 expand) — the row-scoped controls at
    //    the gutter's right edge: 20px, borderless, revealed on hover and
    //    pinned while active; always visible at touch densities. ──
    // An absolute overlay pill at the gutter's right edge — hidden
    // controls consume NO label space; revealed they wash over the value
    // cluster for the hover's duration.
    rowControls: {
        position: "absolute",
        right: "6px",
        top: "50%",
        transform: "translateY(-50%)",
        display: "flex",
        alignItems: "center",
        gap: "2px",
        padding: "0 2px",
        borderRadius: "3px",
        background: "bg.surface",
        boxShadow: "0 0 0 3px {colors.bg.surface}",
        opacity: 0,
        transition: "opacity 120ms",
        zIndex: 2,
        "[data-plan-row]:hover &": { opacity: 1 },
        "&:has([data-active])": { opacity: 1 },
        "@media (hover: none)": { opacity: 1 },
        // A keyboard reader sees them too: on the focused row, and while one
        // of them has focus (the row's Tab walk, #819).
        "[data-plan-row]:focus-visible &": { opacity: 1 },
        "&:focus-within": { opacity: 1 },
        // A strip is one click target — returning. Row controls inside it
        // would compete with that, and there is no room for them anyway.
        "&[data-ctx]": { display: "none" },
        // An expanded row's gutter is TALL, and `top: 50%` in a tall cell
        // parks the control halfway down a mostly-empty column, detached
        // from the name it belongs to. Pin it to the row's own band.
        "&[data-expanded]": { top: "11px", transform: "none" },
    },
    rowControl: {
        width: "20px",
        height: "20px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        background: "transparent",
        color: "fg.subtle",
        borderRadius: "3px",
        cursor: "pointer",
        fontSize: "10px",
        padding: 0,
        "&:hover": { color: "fg.default", background: "bg.panel" },
        "&[data-active]": { color: "brand.fg", background: "{colors.brandTint}" },
        ...planElementFocus,
    },
    // The UPSTREAM / DOWNSTREAM / LINKED tag on gathered family rows.
    focusTag: {
        fontFamily: "mono",
        fontSize: "8px",
        fontWeight: "semibold",
        letterSpacing: "0.08em",
        color: "brand.fg",
        background: "{colors.brandTint}",
        borderRadius: "2px",
        padding: "1px 4px",
        flexShrink: 0,
        animation: "plan-settle-in 0.22s ease-out 0.3s backwards",
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
    },
    // An 11px rail — a collapsed, never-removed row (the return target).
    rail: {
        display: "grid",
        height: "var(--plan-rail-h)",
        position: "relative",
        background: "bg.panel",
        borderBottomWidth: "1px",
        borderBottomColor: "border.subtle",
        cursor: "pointer",
        "&:hover": { background: "{colors.brandTint}" },
        ...planRowFocus,
    },
    // R1 gap band — ONE double-height ⋯ band replacing a RUN of
    // unrelated rows (a lone straggler keeps its 11px rail); click
    // returns, like a rail.
    focusGap: {
        display: "grid",
        height: "var(--plan-gap-h)",
        position: "relative",
        background: "bg.panel",
        borderBottomWidth: "1px",
        borderBottomColor: "border.subtle",
        cursor: "pointer",
        "&:hover": { background: "{colors.brandTint}" },
        ...planRowFocus,
    },
    focusGapInner: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        color: "fg.subtle",
        fontSize: "10px",
        "& > span": {
            fontFamily: "mono",
            fontSize: "8.5px",
            fontWeight: "semibold",
            letterSpacing: "0.06em",
        },
    },
    // ── R1 link ribbons (#818) — drawn over the rows in their own
    //    coordinates (the frame's overlay box); settles in with the rails.
    //    Geometry is the only thing the renderer writes: the paths, their
    //    band width, each ribbon's quantity-share opacity. ──
    ribbons: {
        position: "absolute",
        inset: 0,
        zIndex: 4,
        pointerEvents: "none",
        animation: "plan-settle-in 0.22s ease-out 0.3s backwards",
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        "& svg": { display: "block", overflow: "visible" },
        // The band and its heads, in the brand.
        "& [data-plan-ribbon-band]": { fill: "none", stroke: "{colors.brand.600}" },
        "& [data-plan-ribbon-head]": { fill: "{colors.brand.600}", stroke: "none" },
        "& [data-plan-ribbon-ink]": {
            transition: "opacity 120ms",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        },
        // A lit ribbon (hovered) stands out of the family's quantity shading.
        "& [data-lit] [data-plan-ribbon-ink]": { opacity: 0.72 },
        // The caption — mono, haloed in the surface so it reads over bars
        // and grid (the stroke paints first).
        "& [data-plan-ribbon-caption]": {
            fontFamily: "mono",
            fontSize: "8.5px",
            fontWeight: "semibold",
            fill: "fg.muted",
            paintOrder: "stroke",
            stroke: "bg.surface",
            strokeWidth: "3px",
        },
        // The hit area: a wide transparent stroke along the centerline — the
        // only part of the layer that takes the pointer.
        "& [data-link]": {
            fill: "none",
            stroke: "transparent",
            pointerEvents: "stroke",
            cursor: "pointer",
        },
        // The runs a lit ribbon joins — ringed in the brand.
        "& [data-plan-linkend]": { fill: "none", stroke: "{colors.brand.600}", strokeWidth: "2px" },
    },
    // The developer render region (R2) — fills the canvas below the
    // focused row (every other row hides for the focus); fades in once
    // the gather settles (the 300ms choreography).
    // The band an expanded row's OWN marks keep at the top of its plot
    // cell. Without it a 20px bar in a 200px row centres on the row and
    // drifts into the render; with it the marks position against their
    // natural height exactly as they do at rest. Only the height is
    // dynamic (the row's kind height) — the rest is fixed geometry.
    expandRowBand: {
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
    },
    // ── R2 developer render (#591) ──
    // Absolutely placed inside the FOCUSED ROW's plot cell, beneath the
    // band its own marks hold. Being in the plot cell is what puts it in
    // the canvas's x-space, so a time-based component lines up with the
    // buckets; being in the ROW is what lets the gutter grow with it.
    expandRenderBody: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "8px",
        minWidth: 0,
        overflow: "hidden",
        animation: "plan-settle-in 0.22s ease-out 0.3s backwards",
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
    },
    // The author's content in the grown gutter cell. Carries the gutter's
    // OWN sub-line vocabulary (mono 9.5 / medium / muted, stacked on 3px)
    // rather than inheriting body type — the expanded gutter is a
    // continuation of the row's identity, not a fresh surface, so plain
    // text dropped in here lands on the sheet without the author
    // restyling it. Settles in with the render on the same 300ms wait.
    expandGutterBody: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "3px",
        marginTop: "5px",
        minWidth: 0,
        overflow: "hidden",
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "medium",
        lineHeight: 1.35,
        color: "fg.subtle",
        animation: "plan-settle-in 0.22s ease-out 0.3s backwards",
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
    },
    // ── R2 VALUE → TONE STRIP (#591) ──
    // What a chart or table row collapses to: one block per bucket, depth
    // tracking the value. A numeral and a 2px stroke are both illegible at
    // 7px, so the encoding changes rather than the size — into the
    // vocabulary a heat row already speaks.
    toneCell: {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        height: "var(--plan-strip-mark-h)",
        borderRadius: "1px",
        zIndex: 2,
        "&[data-tone='neg']": { background: "{colors.status.neg}", opacity: 0.85 },
        "&[data-tone='warn']": { background: "{colors.status.warn}", opacity: 0.9 },
        "&[data-nodata]": {
            backgroundImage:
                "repeating-linear-gradient(45deg, transparent 0 2px, color-mix(in srgb, {colors.fg} 10%, transparent) 2px 4px)",
        },
    },

    // ── Group band (26px) ──
    // No `alignItems: center` here — grid items must STRETCH so the plot
    // cell keeps the band's height and the collapsed summary strip's
    // absolute cells stay visible; the name cell centers its own content.
    groupBand: {
        display: "grid",
        minHeight: "var(--plan-group-h)",
        background: "bg.panel",
        borderBottomWidth: "1px",
        borderBottomColor: "border.subtle",
        cursor: "pointer",
        ...planRowFocus,
    },
    groupName: {
        position: "relative",
        fontFamily: "mono",
        fontSize: "10px",
        fontWeight: "semibold",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "fg.muted",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "0 12px",
        whiteSpace: "nowrap",
        overflow: "hidden",
    },
    // `.pl-gut .meta` on a group band — same 9.5/500 ink-4 as row metas;
    // the group name's uppercase/tracking must NOT leak into it.
    groupMeta: {
        fontFamily: "mono",
        fontSize: "9.5px",
        fontWeight: "medium",
        color: "fg.subtle",
        whiteSpace: "nowrap",
        textTransform: "none",
        letterSpacing: "normal",
    },
} satisfies Record<(typeof rowsSlots)[number], SystemStyleObject>;
