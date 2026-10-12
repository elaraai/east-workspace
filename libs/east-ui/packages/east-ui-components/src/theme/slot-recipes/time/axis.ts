/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** The common time-axis label, used by Plan's ruler and Calendar's ruler and hour gutter. */
export const timeAxisText = {
    textStyle: "mono.xs", fontWeight: "semibold", textTransform: "uppercase", color: "fg.subtle",
} as const;

/** Column headings and band captions share the app's eyebrow, including date numerals. */
export const timeHeaderText = {
    textStyle: "eyebrow", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
} as const;

/** One period/tick band, merged into each host's slot recipe. */
export const timeRulerBase = {
    rulerRow: {
        position: "relative", height: "var(--time-ruler-row-h, 28px)", minWidth: 0,
        overflow: "clip", borderBottomWidth: "1px", borderColor: "border.subtle",
        "&:last-child": { borderBottomWidth: 0 },
    },
    rulerTick: {
        ...timeAxisText, position: "absolute", top: 0, bottom: 0,
        display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0,
        whiteSpace: "nowrap", overflow: "visible", borderLeftWidth: "1px", borderColor: "border.subtle",
        "&:first-child": { borderLeftWidth: 0 },
        "&[data-align='start']": { justifyContent: "flex-start" },
        "&[data-align='end']": { justifyContent: "flex-end" },
        "&[data-thinned] > [data-tick-label]": { visibility: "hidden" },
    },
    rulerLabel: {
        position: "relative", zIndex: 1, padding: "0 1px", background: "bg.panel", whiteSpace: "nowrap",
    },
} as const;
