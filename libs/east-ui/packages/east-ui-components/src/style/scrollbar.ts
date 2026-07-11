/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Reserved-gutter scrollbar styling shared by the virtual-scroll data
 * components (Table / Gantt / Library / Planner / Matrix / Board / Roster /
 * Calendar). Spread onto the scroll element's `css` prop (#320).
 *
 * Two problems it solves at once:
 *
 * 1. **Visible affordance.** A bare `overflow: auto` yields the platform
 *    *overlay* scrollbar, which never paints until the user hovers/scrolls —
 *    so a height-bounded component gives no "there's more" signal (and shows
 *    nothing in a static snapshot). Declaring `::-webkit-scrollbar` switches
 *    Chromium to a classic, always-rendered bar; the Firefox `scrollbar-*`
 *    pair mirrors it.
 * 2. **No layout shift.** `scrollbar-gutter: stable` reserves the gutter
 *    whether or not the bar is present, so content width doesn't jump when a
 *    virtualizer's total size crosses the scroll threshold.
 *
 * Colours come from the `overlay.scrollThumb` / `overlay.scrollTrack` theme
 * tokens (the same thumb the styled `ScrollArea` uses), never raw hex.
 */
export const virtualScrollbarCss = {
    scrollbarGutter: "stable",
    // Firefox
    scrollbarWidth: "thin",
    scrollbarColor: "var(--chakra-colors-overlay-scroll-thumb) var(--chakra-colors-overlay-scroll-track)",
    // WebKit / Blink — declaring these forces a classic (non-overlay) bar that
    // is always rendered while the element is scrollable.
    "&::-webkit-scrollbar": { width: "12px", height: "12px" },
    "&::-webkit-scrollbar-track": {
        background: "var(--chakra-colors-overlay-scroll-track)",
    },
    "&::-webkit-scrollbar-thumb": {
        background: "var(--chakra-colors-overlay-scroll-thumb)",
        borderRadius: "6px",
        // A transparent border + padding-box clip insets the thumb so it reads
        // as a rounded pill inside the 12px gutter rather than edge-to-edge.
        border: "3px solid transparent",
        backgroundClip: "padding-box",
    },
    "&::-webkit-scrollbar-corner": { background: "transparent" },
} as const;
