/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Plan slot recipe — the temporally-aligned composite canvas's whole visual
 * vocabulary (`Plan Spec.html` §1–§11 / the §8 compliance sheet), as recipe
 * slots over semantic tokens (light + dark for free; no raw hex).
 *
 * Fixed chrome geometry (the compliance sheet): toolbar 44 / brush 32 /
 * ruler 28 / footer 28 px; gutter 168px (desktop); group band 26px, heat
 * strip 28px; span rows 32 default / 24 dense; bars 20 / 16 /
 * 12 (rollup) px at r 2. All numerals mono with `"tnum" 1`.
 *
 * Run-state styling is the §4.3 truth table, driven by the `bar` slot's
 * `data-state` attribute (obs / appr / prop / propRemoved / estimated /
 * rejected) + `data-stuck` / `data-runoff` — one attribute axis instead of a
 * recipe variant so a row renders bars of MIXED states from one resolved
 * recipe call. Density (`default` / `dense`) is the only recipe variant: it
 * resizes bars + row minima together.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const planSlotRecipe = defineSlotRecipe({
    className: "elara-plan",
    slots: [
        "root",
        // chrome bands
        "toolbar", "toolbarGroup", "brushRow", "brushCaption",
        "ruler", "rulerTick", "nowChip", "footer", "footerItem",
        // the alignment contract
        "row", "gutterCell", "plot", "gridCol",
        // gutter vocabulary
        "gutterName", "gutterSub", "gutterValue", "gutterRight", "gutterMeta", "gutterSwatch",
        "caret", "statusDot",
        // row focus (R1 links / R2 expand)
        "rowControls", "rowControl", "focusTag", "rail", "focusGap", "focusGapInner",
        "focusBar", "focusBack", "focusCaption", "expandRenderBody", "expandGutterBody", "toneCell",
        // group band
        "groupBand", "groupName", "groupMeta",
        // span rows
        "bar", "barQty", "rollBand", "port", "diamond",
        // chart rows
        "chartTickLeft", "chartTickRight", "refLabel",
        // heat rows
        "heatCell", "heatLabel", "weightBar", "segmentTrack", "segmentPart",
        // bucket rows (K2), cards rows (K6), event rows (K7), table rows (K5)
        "cell", "tile", "laneLabel", "markerIcon", "cardChip",
        "milestoneDot", "exceptionTri", "markIcon", "markLabel", "tableCellText", "tableCellPart",
        // overlays
        "nowLine", "cursorLine", "cursorChip",
        // diagnostics (no window / unreadable source)
        "diagnostic",
        // paged canvas: the unloaded run above / below the resident one
        "windowBand", "windowBandCaption",
    ],
    base: {
        root: {
            display: "flex",
            flexDirection: "column",
            background: "bg.surface",
            width: "100%",
            minWidth: 0,
            fontVariantNumeric: "tabular-nums",
        },
        // ── Toolbar (44px): slice chrome + grain/resolution segments ──
        toolbar: {
            minHeight: "44px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "0 12px",
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        toolbarGroup: {
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            minWidth: 0,
            flexShrink: 0,
        },
        // ── Horizon brush band (32px): caption in the gutter, strip in the plot ──
        brushRow: {
            display: "grid",
            alignItems: "stretch",
            height: "32px",
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        brushCaption: {
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "semibold",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "fg.subtle",
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
        },
        // ── Ruler (28px): tick band under the brush, sticky with the header ──
        ruler: {
            display: "grid",
            alignItems: "stretch",
            height: "28px",
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.strong",
            // The cursor readout and the NOW chip are absolutely positioned on
            // the track and centred on their instant, so against the last
            // column half a chip hangs past the track's right edge — and an
            // absolutely-positioned child still counts toward an ancestor's
            // scrollable width. That half-chip flashed a horizontal scrollbar
            // across the whole canvas as the pointer crossed the final column.
            // The band is fixed-height chrome and nothing in it is ever meant
            // to escape, so clip it. `clip` rather than `hidden`: this must not
            // become a scroll container of its own. (The row plot already
            // clips for the same reason — see `plot`.)
            overflow: "clip",
        },
        rulerTick: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "medium",
            color: "fg.subtle",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            minWidth: 0,
            position: "relative",
        },
        // The NOW chip in the ruler — mono 8.5/600, ink pill (the §1 mock).
        nowChip: {
            position: "absolute",
            top: "50%",
            transform: "translate(-50%, -50%)",
            fontFamily: "mono",
            fontSize: "8.5px",
            fontWeight: "semibold",
            letterSpacing: "0.08em",
            color: "bg.surface",
            background: "fg.default",
            borderRadius: "2px",
            padding: "1px 4px",
            zIndex: 7,
            pointerEvents: "none",
        },
        // ── Footer (28px): mono status line ──
        footer: {
            minHeight: "28px",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            padding: "0 12px",
            background: "bg.panel",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
        },
        footerItem: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            "&[data-tone='warning']": { color: "{colors.status.warn}" },
            "&[data-tone='danger']":  { color: "{colors.status.neg}" },
            "&[data-tone='success']": { color: "{colors.status.pos}" },
            "&[data-tone='info']":    { color: "{colors.status.info}" },
            "&[data-end]": { marginLeft: "auto" },
        },
        // ── The alignment contract: gutter cell + plot per row ──
        row: {
            display: "grid",
            position: "relative",
            borderBottomWidth: "1px",
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
            height: "11px",
            position: "relative",
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            cursor: "pointer",
            "&:hover": { background: "{colors.brandTint}" },
        },
        // R1 gap band — ONE double-height ⋯ band replacing a RUN of
        // unrelated rows (a lone straggler keeps its 11px rail); click
        // returns, like a rail.
        focusGap: {
            display: "grid",
            height: "22px",
            position: "relative",
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            cursor: "pointer",
            "&:hover": { background: "{colors.brandTint}" },
        },
        // A canvas that cannot draw says WHY, in the body's own frame: no
        // window declared, or a source that could not be read. `data-plan-error`
        // is the second, louder case.
        diagnostic: {
            padding: "20px",
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.subtle",
            "&[data-plan-error]": { color: "{colors.status.neg}" },
        },
        // A run of source elements that is not resident (#577). Sized by the
        // ledger, so replacing it with rows — or putting it back — moves
        // nothing below it. The repeating rule reads as ROWS without asserting
        // how many there are: the canvas cannot know that, and drawing one
        // skeleton per element would be a claim it cannot support.
        windowBand: {
            position: "relative",
            background: "bg.panel",
            overflow: "hidden",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            backgroundImage:
                "repeating-linear-gradient(to bottom, transparent 0 31px, {colors.border.subtle} 31px 32px)",
        },
        // Sticky, so it stays legible wherever you are inside a band that may
        // be thousands of pixels tall.
        windowBandCaption: {
            position: "sticky",
            top: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            height: "22px",
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "semibold",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "fg.subtle",
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
        // The focus band — a SECTION row between the header and the body
        // (`← ALL ROWS` + the caption), wearing the group-band vocabulary:
        // panel wash + mono uppercase caption. The ruler NEVER moves for it.
        focusBar: {
            minHeight: "26px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "0 12px",
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        focusBack: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "brand.fg",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "2px 6px",
            marginLeft: "-6px",
            borderRadius: "2px",
            whiteSpace: "nowrap",
            "&:hover": { background: "bg.surface" },
        },
        focusCaption: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "fg.muted",
            marginLeft: "auto",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        // The developer render region (R2) — fills the canvas below the
        // focused row (every other row hides for the focus); fades in once
        // the gather settles (the 300ms choreography).
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
            height: "7px",
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
            minHeight: "26px",
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            cursor: "pointer",
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
            // observed / executing — solid ink, paper text.
            "&[data-state='obs']": {
                background: "fg.default",
                color: "bg.surface",
            },
            // planned · confirmed — paper fill, 1.5px solid brand border.
            "&[data-state='appr']": {
                background: "bg.surface",
                color: "fg.default",
                boxShadow: "inset 0 0 0 1.5px {colors.brand.600}",
            },
            // planned · proposed — 1.5px dashed brand, italic.
            "&[data-state='prop']": {
                background: "{colors.brandTint}",
                color: "brand.fg",
                borderWidth: "1.5px",
                borderStyle: "dashed",
                borderColor: "{colors.brand.600}",
                fontStyle: "italic",
            },
            // proposed removal — warn-dashed, struck-through.
            "&[data-state='propRemoved']": {
                background: "transparent",
                color: "fg.muted",
                borderWidth: "1.5px",
                borderStyle: "dashed",
                borderColor: "{colors.status.warn}",
                textDecoration: "line-through",
            },
            // forecast ghost — transparent, 1px dashed strong rule, subtle italic.
            "&[data-state='estimated']": {
                background: "transparent",
                color: "fg.subtle",
                borderWidth: "1px",
                borderStyle: "dashed",
                borderColor: "border.strong",
                fontStyle: "italic",
            },
            // declined — greyed dashed, kept in place for diff.
            "&[data-state='rejected']": {
                background: "transparent",
                color: "fg.subtle",
                borderWidth: "1px",
                borderStyle: "dashed",
                borderColor: "{colors.gray.400}",
                textDecoration: "line-through",
            },
            // over-dwell / flagged — the warn ring rides any state.
            "&[data-stuck]": { boxShadow: "0 0 0 1.5px {colors.status.warn}" },
            // runs past the window — mask-fade right, never a fabricated end.
            "&[data-runoff]": {
                maskImage: "linear-gradient(to right, black 84%, transparent 99%)",
            },
            // ── R1 GEOMETRY SHRINKS (#591) ──
            // The mark already owns a position and a width on the axis, so it
            // keeps both and drops to 7px. Ink goes `transparent` rather than
            // `display: none` — the box, and therefore the geometry, is
            // unchanged, and it takes any FA icon inside with it for free
            // (FA paints with `fill: currentColor`).
            "&[data-ctx]": {
                height: "7px",
                color: "transparent",
                padding: "0 2px",
                gap: 0,
                transition: "height 380ms cubic-bezier(0.16, 1, 0.3, 1), padding 380ms cubic-bezier(0.16, 1, 0.3, 1)",
                "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            },
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
            height: "12px",
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
            // ── R3 SHAPE KEEPS ITS SILHOUETTE, LOSES ITS SIZE (#591) ──
            // Milestone / decision / exception are told apart BY OUTLINE, so
            // the outline is the payload: shrink it, never make it
            // transparent — that would erase the row's whole meaning.
            "&[data-ctx]": { width: "6px", height: "6px", borderRadius: 0},
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
        // ── Heat rows (min-height 16, r2, 3px margins; depth is data-driven) ──
        heatCell: {
            position: "absolute",
            top: "3px",
            bottom: "3px",
            borderRadius: "2px",
            minHeight: "16px",
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
                height: "7px",
                minHeight: 0,
                borderRadius: "1px",
                transition: "height 380ms cubic-bezier(0.16, 1, 0.3, 1)",
                "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            },
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
            height: "20px",
            borderRadius: "2px",
            background: "{colors.brand.600}",
            zIndex: 2,
            "&[data-planned]": {
                background: "color-mix(in srgb, {colors.brand.600} 45%, {colors.bg.surface})",
            },
        },
        segmentTrack: {
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
            height: "20px",
            borderRadius: "2px",
            display: "flex",
            overflow: "hidden",
            zIndex: 2,
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
            height: "16px",
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
            "&[data-state='obs'], &[data-state='appr']": {
                background: "fg.muted",
                color: "bg.surface",
            },
            "&[data-state='prop']": {
                background: "bg.surface",
                color: "brand.fg",
                borderWidth: "1.5px",
                borderStyle: "dashed",
                borderColor: "{colors.brand.600}",
                borderRadius: "2px",
                fontStyle: "italic",
                "& svg": { opacity: 0.8 },
            },
            "&[data-state='propRemoved']": {
                background: "bg.surface",
                color: "fg.muted",
                borderWidth: "1.5px",
                borderStyle: "dashed",
                borderColor: "{colors.status.warn}",
                borderRadius: "2px",
                textDecoration: "line-through",
            },
            "&[data-state='estimated']": {
                background: "transparent",
                color: "fg.subtle",
                borderWidth: "1px",
                borderStyle: "dashed",
                borderColor: "border.strong",
                borderRadius: "2px",
                fontStyle: "italic",
            },
            "&[data-state='rejected']": {
                background: "transparent",
                color: "fg.subtle",
                borderWidth: "1px",
                borderStyle: "dashed",
                borderColor: "{colors.gray.400}",
                borderRadius: "2px",
                textDecoration: "line-through",
            },
            "&[data-tone='warning']": { boxShadow: "0 0 0 1.5px {colors.status.warn}" },
            "&[data-tone='danger']":  { boxShadow: "0 0 0 1.5px {colors.status.neg}" },
            "&[data-tone='success']": { boxShadow: "0 0 0 1.5px {colors.status.pos}" },
            "&[data-tone='info']":    { boxShadow: "0 0 0 1.5px {colors.status.info}" },
            "&[data-pulse]": {
                animation: "elara-pulse 1.6s ease-in-out infinite",
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            },
            // ── R1 GEOMETRY SHRINKS — the bucket case ──
            // A tile is already quantised to its cell; collapsing keeps the
            // cell and flattens the tile inside it. `minWidth` has to go with
            // it or a 20px floor would fight the 7px block.
            "&[data-ctx]": {
                height: "7px",
                minWidth: 0,
                color: "transparent",
                padding: 0,
                gap: 0,
                borderRadius: "1px",
                transition: "height 380ms cubic-bezier(0.16, 1, 0.3, 1)",
                "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            },
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
            height: "18px",
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
            "&[data-state='obs'], &[data-state='appr']": {
                background: "{colors.brandTint}",
                color: "fg.default",
                boxShadow: "inset 0 0 0 1px {colors.brand.600}",
            },
            "&[data-state='prop']": {
                background: "bg.surface",
                color: "brand.fg",
                borderWidth: "1.5px",
                borderStyle: "dashed",
                borderColor: "{colors.brand.600}",
                fontStyle: "italic",
            },
            "&[data-state='propRemoved']": {
                background: "bg.surface",
                color: "{colors.status.warn}",
                borderWidth: "1.5px",
                borderStyle: "dashed",
                borderColor: "{colors.status.warn}",
                textDecoration: "line-through",
            },
            "&[data-state='estimated']": {
                background: "transparent",
                color: "fg.subtle",
                borderWidth: "1px",
                borderStyle: "dashed",
                borderColor: "border.strong",
                fontStyle: "italic",
            },
            "&[data-state='rejected']": {
                background: "transparent",
                color: "fg.subtle",
                borderWidth: "1px",
                borderStyle: "dashed",
                borderColor: "{colors.gray.400}",
                textDecoration: "line-through",
            },
            // ── R1 GEOMETRY SHRINKS (#591) ──
            // The mark already owns a position and a width on the axis, so it
            // keeps both and drops to 7px. Ink goes `transparent` rather than
            // `display: none` — the box, and therefore the geometry, is
            // unchanged, and it takes any FA icon inside with it for free
            // (FA paints with `fill: currentColor`).
            "&[data-ctx]": {
                height: "7px",
                color: "transparent",
                padding: "0 2px",
                gap: 0,
                transition: "height 380ms cubic-bezier(0.16, 1, 0.3, 1), padding 380ms cubic-bezier(0.16, 1, 0.3, 1)",
                "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            },
        },
        // ── Event marks (K7) — ● milestone · ◇◆ decision (diamond slot) · ▲ exception ──
        milestoneDot: {
            position: "absolute",
            width: "8px",
            height: "8px",
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
                lineHeight: "11px",
            },
            "[data-emphasis='footer'] &": { fontWeight: "semibold", color: "fg.default" },
            "[data-emphasis='header'] &": {
                fontSize: "8.5px",
                fontWeight: "semibold",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "fg.subtle",
            },
        },
        // One value position inside a table cell — tone derives per cell
        // (neg / em-dash) or from the SERIES' declaration; `strong` is the
        // series' weight emphasis.
        tableCellPart: {
            "&[data-tone='neg']":   { color: "{colors.status.neg}" },
            "&[data-tone='muted']": { color: "fg.subtle" },
            "&[data-strong]":       { fontWeight: "semibold", color: "fg.default" },
        },
        // ── Overlays ──
        nowLine: {
            position: "absolute",
            top: 0,
            bottom: 0,
            width: 0,
            borderLeftWidth: "1.5px",
            borderLeftColor: "{colors.brand.600}",
            pointerEvents: "none",
            zIndex: 7,
            "[data-axis='dim'] &": { opacity: 0.4 },
            "[data-axis='off'] &": { display: "none" },
        },
        cursorLine: {
            position: "absolute",
            top: 0,
            bottom: 0,
            width: 0,
            borderLeftWidth: "1px",
            borderLeftColor: "fg.muted",
            pointerEvents: "none",
            zIndex: 6,
        },
        cursorChip: {
            position: "absolute",
            transform: "translateX(-50%)",
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "semibold",
            color: "bg.surface",
            background: "fg.default",
            borderRadius: "2px",
            padding: "1px 6px",
            whiteSpace: "nowrap",
            zIndex: 6,
            pointerEvents: "none",
        },
    },
    variants: {
        // Row rhythm — spec 32px default span rows / 24px dense; bars 20 / 16.
        density: {
            default: {},
            dense: {},
        },
    },
    defaultVariants: { density: "default" },
});
