/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan recipe's CHROME — the frame, the toolbar, the horizon brush, the ruler,
 * the footer, the focus bar, the diagnostics, the paged window bands, and the
 * canvas-wide overlays (the now line, the cursor hairline and chip, the element
 * overlay body).
 *
 * One part of the Plan slot recipe (`../plan.ts`, #817), over semantic tokens
 * and the canvas's geometry variables (`collections/plan/geometry.ts`).
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";

/** The slots this part styles. */
export const shellSlots = [
    "root", "toolbar", "toolbarGroup", "toolbarTrailing", "toolbarLibraryCount", "brushRow",
    "brushCaption", "ruler", "rulerTick", "nowChip", "footer", "footerItem", "focusBar",
    "focusBack", "focusCaption", "diagnostic", "rowDiagnostic", "partError", "diagnostics",
    "diagnosticChip", "chipIcon", "windowBand", "windowBandCaption", "windowRetry", "nowLine",
    "cursorLine", "cursorChip", "elementOverlay",
] as const;

/** Their base styles. */
export const shellBase = {
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
        minHeight: "var(--plan-toolbar-h)",
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
    // The right-edge cluster — the summary line and the library trigger.
    // Both are trailing chrome, so ONE auto margin pushes the group rather
    // than each child claiming the edge and fighting over it.
    toolbarTrailing: {
        display: "flex",
        alignItems: "center",
        gap: "{spacing.2}",
        marginLeft: "auto",
        minWidth: 0,
    },
    // The `N of M` in the library popover's head — the brand marks it as a
    // live count of what is showing, not a static caption.
    toolbarLibraryCount: {
        color: "{colors.brand.700}",
        fontWeight: "bold",
    },
    // ── Horizon brush band (32px): caption in the gutter, strip in the plot ──
    brushRow: {
        display: "grid",
        alignItems: "stretch",
        height: "var(--plan-brush-h)",
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
        height: "var(--plan-ruler-h)",
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
        minHeight: "var(--plan-footer-h)",
        display: "flex",
        alignItems: "center",
        gap: "14px",
        padding: "0 12px",
        background: "bg.panel",
        borderTopWidth: "1px",
        borderTopColor: "border.subtle",
        // The narrow layout (§10) has no 28px band to fit a status line
        // into — the same items wrap onto as many lines as they need.
        "[data-plan-narrow] &": { flexWrap: "wrap", minHeight: "auto", padding: "6px 12px", rowGap: "2px", columnGap: "10px" },
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
    // The focus band — a SECTION row between the header and the body
    // (`← ALL ROWS` + the caption), wearing the group-band vocabulary:
    // panel wash + mono uppercase caption. The ruler NEVER moves for it.
    focusBar: {
        minHeight: "var(--plan-group-h)",
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
    // A canvas that cannot draw says WHY, in the body's own frame — the one
    // case left is a window it cannot resolve. Everything a ROW or a
    // WINDOW can get wrong stays with that row or window (#811).
    diagnostic: {
        padding: "20px",
        fontFamily: "mono",
        fontSize: "10px",
        color: "fg.subtle",
    },
    // A row whose instants ride another arm than the axis (#811) — it
    // keeps its gutter and its place, and its plot says why it draws
    // nothing, over the 45° hatch the canvas already speaks for "no data
    // here" (warn-tinted: this is the data's fault, not an absence).
    rowDiagnostic: {
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        minWidth: 0,
        overflow: "hidden",
        fontFamily: "mono",
        fontSize: "10px",
        fontWeight: "medium",
        color: "{colors.status.warn}",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        backgroundImage:
            "repeating-linear-gradient(45deg, transparent 0 3px, color-mix(in srgb, {colors.status.warn} 12%, transparent) 3px 4px)",
        // A 16px strip keeps the hatch — the message would not fit.
        "&[data-ctx]": { color: "transparent" },
    },
    // A part that could not render (#811) — one line naming it, where the
    // part would have been. In a row's plot (or a card body) it fills the
    // cell the marks would have filled; in an overlay it is the body.
    partError: {
        display: "flex",
        alignItems: "center",
        padding: "6px 10px",
        minWidth: 0,
        overflow: "hidden",
        fontFamily: "mono",
        fontSize: "10px",
        fontWeight: "medium",
        color: "{colors.status.neg}",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        "[data-plan-row] &, [data-plan-group] &, [data-plan-card] &": { position: "absolute", inset: 0, padding: "0 10px" },
    },
    // The diagnostics cluster (#811) — it gives way before the toolbar's
    // controls do, wrapping its chips rather than crushing a segment.
    diagnostics: {
        display: "inline-flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "6px",
        minWidth: 0,
        flexShrink: 1,
    },
    // A toolbar diagnostics chip (#811), layered over the shared `chip`
    // recipe: a reason can be a whole sentence, so it truncates rather
    // than pushing the toolbar's other clusters off the edge. Only the
    // rows-skipped chip is a button (it seeks); the rest just state.
    diagnosticChip: {
        maxWidth: "360px",
        minWidth: 0,
        flexShrink: 1,
        cursor: "default",
        "&:is(button)": { cursor: "pointer" },
        "& > span": { overflow: "hidden", textOverflow: "ellipsis" },
    },
    // The glyph on a toolbar diagnostics chip (#811) — the chip itself is
    // the shared `chip` recipe; the status rides the glyph, never a
    // saturated fill (the chip vocabulary's rule).
    chipIcon: {
        fontSize: "10px",
        color: "{colors.status.warn}",
        "&[data-tone='danger']": { color: "{colors.status.neg}" },
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
            "repeating-linear-gradient(to bottom, transparent 0 calc(var(--plan-row-h) - 1px), {colors.border.subtle} calc(var(--plan-row-h) - 1px) var(--plan-row-h))",
        // A window whose read FAILED (#811) — the same slab, the rule
        // replaced by a faint negative wash: rows belong here and could
        // not be read.
        "&[data-plan-failed]": {
            backgroundImage: "none",
            background: "color-mix(in srgb, {colors.status.neg} 5%, {colors.bg.panel})",
        },
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
        // The failure caption wraps its reason (a message is not a count)
        // and wears the negative ink.
        "[data-plan-failed] &": {
            height: "auto",
            minHeight: "22px",
            padding: "4px 12px",
            flexWrap: "wrap",
            textTransform: "none",
            letterSpacing: "0.02em",
            color: "{colors.status.neg}",
            background: "transparent",
        },
    },
    // The failed window's Retry — a mono pill in the band's caption.
    windowRetry: {
        fontFamily: "mono",
        fontSize: "9px",
        fontWeight: "semibold",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "brand.fg",
        background: "bg.surface",
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "border.strong",
        borderRadius: "3px",
        padding: "2px 8px",
        cursor: "pointer",
        flexShrink: 0,
        "&:hover": { background: "bg.panel" },
        // The narrow layout's failure card: the reason on the left, the
        // Retry at the card head's right edge.
        "[data-plan-narrow] &": { marginLeft: "auto" },
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
        // Driven by the canvas body's ONE `--plan-cursor-x` variable and
        // shown only while the pointer is over a plot (#609) — a
        // pointermove writes a style on the body, renders nothing.
        display: "none",
        left: "calc(var(--plan-cursor-x, 0) * 100%)",
        "[data-plan-cursor] &": { display: "block" },
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
    // The element popover / hover card body (the canvas's one overlay
    // layer, `collections/plan/root/overlays.tsx`) — one content geometry
    // for both surfaces, so an element's click surface and its hover
    // surface read as the same family.
    elementOverlay: {
        padding: "14px 16px",
        minWidth: "240px",
        maxWidth: "360px",
        fontSize: "13px",
    },
} satisfies Record<(typeof shellSlots)[number], SystemStyleObject>;
