/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Calendar slot recipe — the day-of-week × week heatmap, rebuilt to the
 * designer's `Calendar Heatmap` spec: an eight-step teal ramp (theme-aware —
 * it flips to a dim→bright ramp in dark mode), mono day / week labels that
 * cross-highlight the hovered row and column, the Σ-wk totals rail with a
 * proportion bar, the per-weekday aggregate ("mean") row, and the selection
 * footer with the predicted / compare / delta chip and the low→high gradient
 * legend. Per-density SIZING (cell height, grid template, padding, gap) is
 * computed in the renderer; this recipe owns the density-independent styling
 * and the ramp CSS variables.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const calendarSlotRecipe = defineSlotRecipe({
    className: "elara-calendar",
    slots: [
        "root", "dayHeader", "totalsHeader", "weekLabel",
        "cell",
        "totalsCell", "totalsValue", "totalsBar", "totalsBarFill",
        "meanLabel", "meanCell", "meanPad",
        "footer", "footerLead", "footerSel", "footerValue", "deltaChip", "action",
        "legend", "legendCap", "legendGradient",
    ],
    base: {
        /* Bare like Table / Planner — identity chrome (title, outer frame) is
         * host composition via Card / Slice.Frame. The eight ramp stops + the
         * two on-ramp inks live here as CSS variables so the fill (a data-
         * driven binding, applied inline in the renderer) flips with the
         * theme. Dark mode runs a dim-surface → bright-teal ramp and swaps
         * the on-ramp inks (#362).
         *
         * These stops are literal hex on purpose, and are the one sanctioned
         * exception to "semantic tokens only". A heatmap needs a perceptually
         * even sequential ramp; `tokens/colors.css` deliberately has no such
         * scale (its brand steps jump from bright cyan to desaturated teal, so
         * reading them as a ramp would make intensity illegible). The stops
         * stay inside the brand teal family and are theme-aware via the
         * `_dark` block below — what they are NOT is reachable from an
         * existing token. Do not "fix" these to brand.N. */
        root: {
            background: "bg.surface",
            "--cal-r0": "#dcecec", "--cal-r1": "#c2e0e1", "--cal-r2": "#a3ced1", "--cal-r3": "#82b8bd",
            "--cal-r4": "#5f9ba3", "--cal-r5": "#437e87", "--cal-r6": "#2f636d", "--cal-r7": "#1e4952",
            /* on-ramp ink: `lo` for the pale (below-threshold) stops, `hi` for
             * the deep (>= step 4) stops. */
            "--cal-ink-lo": "#22343c", "--cal-ink-hi": "#eef7f7",
            /* the hover cross-hair ring, per mode. */
            "--cal-ring": "rgba(17,27,34,0.5)",
            _dark: {
                "--cal-r0": "#223335", "--cal-r1": "#294349", "--cal-r2": "#33565d", "--cal-r3": "#416e76",
                "--cal-r4": "#56939c", "--cal-r5": "#6fb3bb", "--cal-r6": "#86cdd4", "--cal-r7": "#a3e4ea",
                "--cal-ink-lo": "#cfe0e0", "--cal-ink-hi": "#10201f",
                "--cal-ring": "rgba(255,255,255,0.72)",
            },
        },
        dayHeader: {
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            fontFamily: "mono",
            fontWeight: "600",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.subtle",
            transition: "color 140ms {easings.out}",
            /* cross-highlight: the hovered / selected day column. */
            "&[data-active]": { color: "link", fontWeight: "700" },
        },
        totalsHeader: {
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-end",
            fontFamily: "mono",
            fontSize: "9px",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        weekLabel: {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingRight: "11px",
            fontFamily: "mono",
            color: "fg.subtle",
            transition: "color 140ms {easings.out}",
            /* cross-highlight: the hovered / selected week row. */
            "&[data-active]": { color: "link", fontWeight: "700" },
        },
        cell: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "mono",
            fontVariantNumeric: "tabular-nums",
            fontWeight: "600",
            lineHeight: "1",
            position: "relative",
            outlineOffset: "-2px",
            transition: "background-color 180ms {easings.out}, box-shadow 130ms ease, filter 130ms ease",
            cursor: "pointer",
            /* the fill (`background`) + on-ramp ink (`color`) are applied inline
             * in the renderer from the ramp CSS vars — a data-driven binding. */
            /* empty (no cell for this week × day): hatched neutral. */
            "&[data-empty]": {
                background: "bg.subtle",
                backgroundImage: "repeating-linear-gradient(-45deg,transparent 0 5px,color-mix(in srgb, {colors.fg.subtle} 12%, transparent) 5px 6px)",
                color: "fg.subtle",
                cursor: "default",
            },
            /* hover cross-hair — an inset ring, brightened. */
            "&[data-hover]:not([data-selected])": {
                boxShadow: "inset 0 0 0 2px var(--cal-ring)",
                filter: "brightness(1.05)",
            },
            /* selected — the ink outline, lifted with a soft shadow. */
            "&[data-selected]": {
                outline: "2px solid",
                outlineColor: "fg",
                boxShadow: "0 2px 10px rgba(17,27,34,0.22)",
                zIndex: "2",
            },
            /* non-interactive densities keep the default cursor. */
            "&[data-static]": { cursor: "default" },
        },
        /* Σ-wk totals rail — value stacked over a proportion bar. */
        totalsCell: {
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            justifyContent: "center",
            gap: "5px",
            paddingLeft: "11px",
        },
        totalsValue: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "600",
            lineHeight: "1",
            color: "fg",
        },
        totalsBar: {
            display: "block",
            width: "100%",
            height: "3px",
            borderRadius: "2px",
            background: "bg.subtle",
            overflow: "hidden",
        },
        totalsBarFill: {
            display: "block",
            height: "100%",
            background: "{colors.brand.500}",
            borderRadius: "2px",
            transition: "width 220ms {easings.out}",
        },
        /* per-weekday aggregate ("mean") row — pinned under the grid, ruled. */
        meanLabel: {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingRight: "11px",
            fontFamily: "mono",
            fontSize: "9px",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "fg.subtle",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            marginTop: "5px",
        },
        meanCell: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "mono",
            fontWeight: "500",
            color: "fg.subtle",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            marginTop: "5px",
            transition: "color 140ms {easings.out}",
            "&[data-active]": { color: "link" },
        },
        meanPad: {
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            marginTop: "5px",
        },
        /* selection footer. */
        footer: {
            display: "flex",
            alignItems: "center",
            gap: "11px",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            fontFamily: "body",
            fontSize: "12px",
            color: "fg.muted",
            whiteSpace: "nowrap",
        },
        footerLead: { color: "fg.subtle" },
        footerSel: { color: "fg", fontWeight: "600" },
        footerValue: { fontFamily: "mono", fontWeight: "600", color: "fg" },
        deltaChip: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "600",
            padding: "2px 8px",
            borderRadius: "3px",
            borderWidth: "1px",
            letterSpacing: "0.02em",
            "&[data-dir=up]":   { color: "fg.success", borderColor: "fg.success", background: "bg.success.subtle" },
            "&[data-dir=down]": { color: "fg.danger",  borderColor: "fg.danger",  background: "bg.danger.subtle" },
            "&[data-dir=flat]": { color: "fg.subtle",  borderColor: "border.strong", background: "bg.canvas" },
        },
        action: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "600",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "link",
            cursor: "pointer",
            background: "transparent",
            border: "none",
            padding: "0",
            "&[data-disabled]": { color: "fg.subtle", cursor: "default" },
        },
        /* low→high gradient legend, pinned footer-right. */
        legend: {
            display: "flex",
            alignItems: "center",
            gap: "7px",
            flexShrink: "0",
            marginLeft: "auto",
        },
        legendCap: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "500",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        legendGradient: {
            width: "92px",
            height: "8px",
            borderRadius: "9999px",
            background: "linear-gradient(90deg, var(--cal-r0), var(--cal-r1), var(--cal-r2), var(--cal-r3), var(--cal-r4), var(--cal-r5), var(--cal-r6), var(--cal-r7))",
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, {colors.fg} 7%, transparent)",
        },
    },
    variants: {
        /* Density → font sizing + cell radius only. The structural pixel
         * values (cell height, grid template, gap, padding) are computed in
         * the renderer's DENS map so the VirtualRows sizing contract (#320)
         * and the plot-gutter template (#147) can read them. Mapped by size
         * rank to the designer's three panels: comfortable = "large" (46px),
         * compact = "comfortable" (30px), condensed = "compact" (20px). */
        density: {
            comfortable: {
                cell: { fontSize: "13px", borderRadius: "3px" },
                dayHeader: { fontSize: "10px" },
                weekLabel: { fontSize: "10px" },
                meanCell: { fontSize: "10px" },
            },
            compact: {
                cell: { fontSize: "11px", borderRadius: "3px" },
                dayHeader: { fontSize: "10px" },
                weekLabel: { fontSize: "10px" },
                meanCell: { fontSize: "10px" },
            },
            condensed: {
                cell: { fontSize: "11px", borderRadius: "2px" },
                dayHeader: { fontSize: "9px" },
                weekLabel: { fontSize: "9px" },
                meanCell: { fontSize: "9px" },
            },
        },
    },
    defaultVariants: {
        density: "comfortable",
    },
});
