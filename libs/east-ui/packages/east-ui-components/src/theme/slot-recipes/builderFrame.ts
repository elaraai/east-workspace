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
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** The motion of a state toggle: the design system's `--dur-base` on `--ease-in-out`. */
const TOGGLE_MOTION = {
    transitionDuration: "{durations.normal}",
    transitionTimingFunction: "{easings.inOut}",
} as const;

export const builderFrameSlotRecipe = defineSlotRecipe({
    className: "elara-builder-frame",
    slots: ["root", "toolbar", "banners", "body", "pane", "sheet", "probe", "main", "scrim", "footer"],
    base: {
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
