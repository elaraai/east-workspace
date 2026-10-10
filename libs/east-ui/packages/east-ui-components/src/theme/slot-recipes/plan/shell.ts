/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan recipe's CHROME — the frame, the horizon brush, the ruler, the
 * footer, the focus bar, the diagnostics, the paged window bands, and the
 * canvas-wide overlays (the cursor hairline and chip, the element overlay
 * body). The toolbar band is the Plan's `BuilderFrame`'s (#1193); its items
 * wear the shared parts' recipes, and the summary and the scope badge the
 * footer's item. The now line and its chip are the shared time part's
 * (`../time/now.ts`, #1148), merged into the recipe beside this one.
 *
 * One part of the Plan slot recipe (`../plan.ts`, #817), over semantic tokens
 * and the canvas's geometry variables (e3-ui-components' `plan/geometry.ts`).
 *
 * @packageDocumentation
 */

import { timeAxisText } from "../time/axis.js";
import { builderFooter, builderFooterItem } from "../builder-footer.js";
import type { SystemStyleObject } from "@chakra-ui/react";
import { planElementFocus, planRowFocus } from "./focus.js";

/** The slots this part styles. */
export const shellSlots = [
    "root", "frame", "brushRow",
    "brushCaption", "horizonLens", "ruler", "rulerTick", "rulerLabel", "footer", "footerItem", "focusBar",
    "focusBack", "focusCaption", "diagnostic", "rowDiagnostic", "partError", "diagnostics",
    "diagnosticChip", "chipIcon", "windowBand", "windowBandCaption", "windowRetry",
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
    // ── The Plan's frame (#1193): what wraps its `BuilderFrame`, carrying
    // the canvas's geometry variables, which the canvas, the toolbar's
    // items and the footer all read. A Plan that declares no bound adds no
    // box of its own; one that does is that box, at the declared height,
    // and the frame fills it ──
    frame: {
        display: "contents",
        "&[data-plan-bound]": { display: "flex", flexDirection: "column", width: "100%", minWidth: 0, minHeight: 0 },
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
    // The gutter caption of a header band — the ruler's, the horizon's — in
    // the header row's one style (#949): mono 10 / 600, uppercase, label ink.
    brushCaption: {
        fontFamily: "mono",
        fontSize: "10px",
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
    // The horizon's lens (#949): two hairlines from the window the strip has
    // selected, on the strip's own scale, down to the plot's edges — the grid
    // below is that window, magnified, so the two scales never read as one.
    horizonLens: {
        display: "block",
        width: "100%",
        height: "var(--plan-lens-h)",
        overflow: "visible",
        pointerEvents: "none",
        "& line": { stroke: "border.strong", strokeWidth: "1px" },
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
    // A tick — the header row's one style (#949): mono 10 / 600, uppercase,
    // the label ink, as the gutter caption beside it. Its label is drawn
    // whole: where the columns are narrower than their labels the ruler draws
    // every k-th (#1269, `data-thinned` on the rest), and a label may run past
    // its column into the blank ones beside it, so the tick clips nothing.
    // The first and the last sit against the track's ends (`data-align`).
    rulerTick: {
        ...timeAxisText,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "nowrap",
        overflow: "visible",
        minWidth: 0,
        position: "relative",
        "&[data-align='start']": { justifyContent: "flex-start" },
        "&[data-align='end']": { justifyContent: "flex-end" },
        "&[data-thinned] > [data-tick-label]": { visibility: "hidden" },
        // No border: the ruler's bucket lines are the rows' own separators
        // (`GridSeparators`, drawn over the ticks), so the two can never sit
        // a pixel apart.
    },
    // A tick's label, the desktop ruler's and the narrow layout's: on a
    // knockout of the ruler's paper, above the bucket lines it runs past, so
    // no line strikes through its letters (#1269).
    rulerLabel: {
        position: "relative",
        zIndex: 1,
        padding: "0 1px",
        background: "bg.panel",
        whiteSpace: "nowrap",
    },
    // One shared status rail in Plan and Calendar.
    footer: { ...builderFooter, minHeight: "var(--plan-footer-h)" },
    footerItem: builderFooterItem,
    // The focus band (`Plan links.html`, #1258) — a band between the header
    // and the body, 32 tall on the band paper: `← All rows` as a link at its
    // start, the focus's caption at its end. The ruler NEVER moves for it.
    focusBar: {
        height: "32px",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "0 20px",
        background: "bg.canvas",
        borderBottomWidth: "1px",
        borderBottomColor: "border.subtle",
    },
    // `← All rows` — a link button: the body face at 12.5 / 500, in the link ink.
    focusBack: {
        height: "20px",
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        padding: 0,
        border: "none",
        borderRadius: "sm",
        background: "none",
        fontFamily: "body",
        fontSize: "body.sm",
        fontWeight: "medium",
        color: "link",
        whiteSpace: "nowrap",
        cursor: "pointer",
        flexShrink: 0,
        "&:hover": { color: "link.hover" },
        ...planElementFocus,
    },
    // The caption — mono 10 / 600, the label tracking, uppercase, the label ink.
    focusCaption: {
        minWidth: 0,
        fontFamily: "mono",
        fontSize: "label.sm",
        fontWeight: "semibold",
        letterSpacing: "label",
        textTransform: "uppercase",
        color: "fg.subtle",
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
    // The diagnostics cluster (#811), one item of the frame's toolbar: one
    // line, as every item is (PB21) — a long reason truncates in its chip.
    diagnostics: {
        display: "inline-flex",
        alignItems: "center",
        flexWrap: "nowrap",
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
        // A band is a row of the grid — the keyboard lands on it (#819).
        ...planRowFocus,
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
        fontSize: "9.5px",
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
        fontSize: "9.5px",
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
        ...planElementFocus,
    },
    // ── Overlays ──
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
        fontSize: "9.5px",
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
    // layer, e3-ui-components' `plan/root/overlays.tsx`) — one content geometry
    // for both surfaces, so an element's click surface and its hover
    // surface read as the same family.
    elementOverlay: {
        padding: "14px 16px",
        minWidth: "240px",
        maxWidth: "360px",
        fontSize: "13px",
    },
} satisfies Record<(typeof shellSlots)[number], SystemStyleObject>;
