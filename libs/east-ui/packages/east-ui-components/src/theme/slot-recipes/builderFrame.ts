/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Builder frame slot recipe (#1125) — the one frame of a builder-style
 * component (`src/layout/builder-frame/`): the toolbar across the top, the
 * banners under it, the start pane, main and the end pane, and the footer.
 * Every style the frame has is here; the frame sets data attributes and
 * geometry only.
 *
 *   - Root: fills its host and draws no outer border, so a host frames it or
 *     places it bare. Its own stacking context: a pane floating over main
 *     stays inside the frame.
 *   - Toolbar: the one 44px row, the shared `toolbar`'s, over its rule.
 *   - Banners and footer: in-flow bands, the frame's full width. What they
 *     hold draws its own rules, as a result strip and a status line do.
 *   - Pane: a slot at its side, sized by the frame — the pane's width, or its
 *     rail's. Pinned, a change of width pushes main aside over the design
 *     system's `--dur-base` on `--ease-in-out`. Each pane is a `DockPane`
 *     (the `dock` recipe), whose shell surface draws the rule toward main.
 *   - Sheet: what holds the `DockPane` — the slot's whole box, or, for an
 *     overlay pane that is open, a full-height sheet floating over main from
 *     the pane's edge, in front of it; while a drag is under way the frame
 *     slides it off main (`transform`, geometry), over the same motion.
 *   - Main: the room the panes leave, a bounded box whose content scrolls
 *     itself; its own stacking context, under a floating sheet.
 *   - Scrim: over main while a pane overlays it for lack of room — the
 *     theme's `overlay.backdrop`, the Drawer's — taking the pointer.
 *   - Probe: an unseen box at a pane's width, measured when that width is
 *     not a plain px length (`min(480px, 52%)`).
 *   - Loading: the cold-load skeleton over the regions — its toolbar's
 *     slots, and its body's rows at the component's own pitch
 *     (`--builder-loading-pitch`, the frame's `loadingPitch`) with a 12px
 *     body bar each: the Skeleton's static `--paper-3`, nothing moving
 *     (#1398). A live footer (`data-frame-live`) stays out from under it.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { builderFooter } from "./builder-footer.js";

/** The motion of a state toggle: the design system's `--dur-base` on `--ease-in-out`. */
const TOGGLE_MOTION = {
    transitionDuration: "{durations.normal}",
    transitionTimingFunction: "{easings.inOut}",
} as const;

export const builderFrameSlotRecipe = defineSlotRecipe({
    className: "elara-builder-frame",
    slots: ["root", "toolbar", "banners", "body", "pane", "sheet", "probe", "main", "scrim", "footer", "loading", "loadingBar", "loadingBody", "loadingRow", "loadingLine", "loadingCell", "loadingFooter"],
    base: {
        loading: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "bg.surface", overflow: "hidden" },
        loadingBar: { gap: "{spacing.4}", "& > :last-child": { marginInlineStart: "auto" } },
        loadingBody: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "{spacing.2} {spacing.4}", overflow: "hidden" },
        // Loading rows at the component's own pitch (#1398), so the skeleton matches what it covers; the body clips the rest.
        loadingRow: {
            flex: "0 0 var(--builder-loading-pitch, 40px)", display: "flex", alignItems: "center", gap: "{spacing.4}",
            boxSizing: "border-box", borderBottomWidth: "1px", borderColor: "border.subtle",
        },
        // The Skeleton's static `--paper-3`: no shimmer, no pulse — the footer line's dot is the only motion (#1398).
        loadingLine: {
            flex: "0 1 160px", minWidth: 0, width: "100%", maxWidth: "160px", "&:nth-child(2)": { flexGrow: 1, maxWidth: "320px" },
            background: "bg.subtle", animation: "none",
        },
        // A body value's bar: 12px, square-ended.
        loadingCell: { height: "12px", borderRadius: "0" },
        loadingFooter: { ...builderFooter },
        root: {
            position: "relative",
            isolation: "isolate",
            flex: "1 1 0%",
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            minWidth: "0",
            minHeight: "0",
            background: "bg.surface",
            overflow: "hidden",
            "&[data-loading] > [data-frame-slot]:not([data-frame-live])": { opacity: 0 },
            "&[data-loading] [data-frame-slot]": { transition: "none" },
        },
        /* The one toolbar band: the shared toolbar's row. */
        toolbar: {
            flex: "none",
            display: "flex",
            flexWrap: "nowrap",
            alignItems: "center",
            height: "44px",
            paddingX: "{spacing.4}",
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderBottomColor: "border.subtle",
            overflow: "clip",
        },
        banners: {
            flex: "none",
            display: "flex",
            flexDirection: "column",
            minWidth: "0",
        },
        /* The panes and main, side by side: what a floating sheet is placed in. */
        body: {
            position: "relative",
            flex: "1",
            display: "flex",
            minWidth: "0",
            minHeight: "0",
        },
        pane: {
            flex: "none",
            display: "flex",
            minHeight: "0",
            "&[data-pane-mode=pinned]": { transitionProperty: "width", ...TOGGLE_MOTION },
        },
        sheet: {
            display: "flex",
            width: "100%",
            height: "100%",
            minHeight: "0",
            "[data-pane-mode=overlay]:not([data-collapsed]) > &": {
                position: "absolute",
                top: "0",
                bottom: "0",
                height: "auto",
                zIndex: "docked",
                transitionProperty: "transform",
                ...TOGGLE_MOTION,
            },
            "[data-frame-slot=start][data-pane-mode=overlay]:not([data-collapsed]) > &": { insetInlineStart: "0" },
            "[data-frame-slot=end][data-pane-mode=overlay]:not([data-collapsed]) > &": { insetInlineEnd: "0" },
        },
        probe: {
            position: "absolute",
            top: "0",
            height: "0",
            visibility: "hidden",
            pointerEvents: "none",
        },
        main: {
            position: "relative",
            isolation: "isolate",
            flex: "1",
            display: "flex",
            flexDirection: "column",
            minWidth: "0",
            minHeight: "0",
            overflow: "hidden",
        },
        scrim: {
            position: "absolute",
            inset: "0",
            zIndex: "overlay",
            background: "{colors.overlay.backdrop}",
        },
        footer: {
            flex: "none",
            display: "flex",
            flexDirection: "column",
            minWidth: "0",
        },
    },
});
