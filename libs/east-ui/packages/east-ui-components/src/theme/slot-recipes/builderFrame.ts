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
 *     body bar each: static bars in `--rule`, nothing moving (#1398; the
 *     rule rather than `--paper-3`, the darkest paper, ruled 26 Oct 2026 so
 *     the rows read as rows on every screen). A live footer
 *     (`data-frame-live`) stays out from under it.
 *   - A phone's frame (`data-phone`, 560px or narrower; `Mobile Builder
 *     Frame Spec.md`, the designer's `WorkOrdersPhone` measures): the session
 *     row, the toolbar's second row — 56px, its 44px controls 6px clear of
 *     either rule, padded 0 12 0 16 and 4px apart; the footer, laid over
 *     main's foot while it says something — its loading line, a live notice —
 *     with no height of its own in the flow, so main never resizes for it
 *     (ruled 7 Nov 2026), and what main draws at its foot standing clear of
 *     its band by main's `--builder-foot-inset`, which the frame measures;
 *     the pane strip on the bottom edge — 44px over a
 *     `--rule`, one equal tab a pane split by a rule inset 10px top and
 *     bottom, its icon 14, its label the mono caps, whole, its meta mono
 *     `fg.subtle`, whole or not at all, the open one in ink over a 2px underline; a pane open — a
 *     view over the whole builder, edge to edge, as the Filters view is
 *     (ruled 3 Nov 2026), `--paper`, sliding in from the right over
 *     `--dur-base` on `--ease-out` (at once under reduced motion), off to the
 *     right while a drag is under way; and
 *     the bottom panel's slot — in the flow over the strip, nothing while
 *     nothing is open in it, at most 420 tall and never so tall it takes the
 *     frame (`frameView`'s panel draws in it); and
 *     the overlay — a slot over every region where a toolbar item draws a
 *     full-height view (the rail's Filters view), taking the pointer only
 *     where a view draws itself.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { builderFooter } from "./builder-footer.js";
import { wholeOrNone } from "../../style/whole-or-none.js";

/** The motion of a state toggle: the design system's `--dur-base` on `--ease-in-out`. */
const TOGGLE_MOTION = {
    transitionDuration: "{durations.normal}",
    transitionTimingFunction: "{easings.inOut}",
} as const;

export const builderFrameSlotRecipe = defineSlotRecipe({
    className: "elara-builder-frame",
    slots: ["root", "toolbar", "banners", "body", "pane", "sheet", "probe", "main", "scrim", "footer", "loading", "loadingBar", "loadingBody", "loadingRow", "loadingLine", "loadingCell", "loadingFooter",
        "sessionRow", "paneStrip", "paneTab", "paneTabIcon", "paneTabLabel", "paneTabMeta", "paneTabMark", "drawer", "bottomPanel", "sessionBand", "overlay"],
    base: {
        loading: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "bg.surface", overflow: "hidden" },
        loadingBar: { gap: "{spacing.4}", "& > :last-child": { marginInlineStart: "auto" } },
        loadingBody: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "{spacing.2} {spacing.4}", overflow: "hidden" },
        // Loading rows at the component's own pitch (#1398), so the skeleton matches what it covers; the body clips the rest.
        loadingRow: {
            flex: "0 0 var(--builder-loading-pitch, 40px)", display: "flex", alignItems: "center", gap: "{spacing.4}",
            boxSizing: "border-box", borderBottomWidth: "1px", borderColor: "border.subtle",
        },
        // Static bars in `--rule`: no shimmer, no pulse — the footer line's dot is the only motion (#1398). The rule, not
        // `--paper-3`, which is the darkest paper and read as blank on a bright screen (ruled 26 Oct 2026).
        loadingLine: {
            flex: "0 1 160px", minWidth: 0, width: "100%", maxWidth: "160px", "&:nth-child(2)": { flexGrow: 1, maxWidth: "320px" },
            background: "border.subtle", animation: "none",
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
            /* A phone's closed panes stand outside the frame: focus reaching one must not scroll the frame to it. */
            "&[data-phone]": { overflow: "clip" },
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
            /* A phone's: its items carry their own padding, the views' 16 at its start (FR2). */
            "[data-phone] > &": {
                paddingX: "0", alignItems: "stretch",
                /* With nothing in it, no row at all: its history is the second row's. */
                "&:not(:has([data-toolbar-item]))": { display: "none" },
                /* A chip that ends the row stands 4 clear of its end, as Filters and Search Records do: the Calendar's overlaps. */
                "& [data-toolbar-item]:last-child:has([data-chip-icon])": { paddingInlineEnd: "{spacing.1}" },
            },
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
            /* A phone's drawer's veil: `--paper-3` at 72%, the designer's. */
            "[data-phone] &": { background: "color-mix(in oklch, var(--chakra-colors-bg-subtle) 72%, transparent)" },
        },
        footer: {
            flex: "none",
            display: "flex",
            flexDirection: "column",
            minWidth: "0",
            /* A phone's footer that speaks — its loading line, while a read is out or failed, and what is live: a Save's
             * notice, a refused gesture's words (ruled 7 Nov 2026, revising R5) — is laid over main's foot: in the flow under
             * main but with no height of its own, what it says standing up over main's last rows, so main never resizes as
             * it comes and goes. A read-only builder drew a second row for the line alone, and a Schematic refitted its
             * drawing on every read. Its rail shows nothing of its legend, its counts or its hints, and no band while it says
             * nothing. A footer with neither, a status line, keeps its place in the flow. */
            "[data-phone] > &": {
                "&:has([data-footer-line], [data-footer-live])": {
                    position: "relative",
                    height: "0",
                    justifyContent: "flex-end",
                    zIndex: "1",
                    "& > *": { flex: "none" },
                    /* The rail the line stands in: as tall as what it shows, wrapping, and nothing else of it. */
                    "& > :has(> [data-footer-line])": { height: "auto", minHeight: "28px", flexWrap: "wrap" },
                    "& > :has(> [data-footer-line]) > :not([data-footer-line]):not([data-footer-live]):not(:has([data-footer-live]))": { display: "none" },
                    /* The line has the band to itself: at its start, and as wide as its words take, the fit giving it the band's width. */
                    "& [data-footer-line]": { marginInlineStart: "0", maxWidth: "100%" },
                    /* A line given to the footer with no rail of its own, as the query builder's: the rail's band, its paper and rule. */
                    "& > [data-footer-line]": {
                        minHeight: "28px", paddingX: "{spacing.3}",
                        background: "bg.panel", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle",
                    },
                    "& [data-footer-live]": { minWidth: "0", whiteSpace: "normal" },
                    /* Saying nothing, no band to see or touch — but its live region kept, so the line is heard as it starts to speak. */
                    "&:not(:has([data-footer-line]:not([data-idle]))):not(:has([data-footer-live]))": { opacity: "0", pointerEvents: "none" },
                },
            },
            /* A pane's view lies over main and the band: what a gesture in it was refused for stays in sight, over the view's
             * foot — all but what only describes the main the view covers, which the view covers too: the loading line, and
             * what is `data-footer-ambient`. */
            "[data-phone]:has(> [data-frame-drawer][data-open]) > &": {
                "&:has([data-footer-live]:not([data-footer-ambient]))": {
                    position: "absolute",
                    insetInline: "0",
                    bottom: "0",
                    /* Above the view (`drawer`, on the overlay layer), under what a view's own controls open. */
                    zIndex: "modal",
                    "& [data-footer-line], & [data-footer-ambient]": { display: "none" },
                },
            },
        },
        /* A phone's second row of the toolbar: the drafts' count, then the eye and the history. */
        sessionRow: {
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: "{spacing.1}",
            height: "56px",
            paddingInlineStart: "{spacing.4}",
            paddingInlineEnd: "{spacing.3}",
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderBottomColor: "border.subtle",
            overflow: "clip",
        },
        /* Under the row, where its items ask something (FR8): nothing while nothing asks. */
        sessionBand: { flex: "none", "&:empty": { display: "none" } },
        /* A phone's panes: one tab each along the frame's bottom edge, over the safe area. */
        paneStrip: {
            /* On the frame's bottom edge, under the bottom panel and a footer in the flow. */
            order: 1,
            flex: "none",
            display: "flex",
            containerType: "inline-size",
            height: "calc(44px + env(safe-area-inset-bottom, 0px))",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            background: "bg.surface",
            borderTopWidth: "1px",
            borderTopStyle: "solid",
            borderTopColor: "border.subtle",
        },
        paneTab: {
            flex: "1 1 0",
            minWidth: "0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "{spacing.2}",
            paddingX: "{spacing.2}",
            background: "transparent",
            border: "none",
            borderBottomWidth: "2px",
            borderBottomStyle: "solid",
            borderBottomColor: "transparent",
            color: "fg.muted",
            cursor: "pointer",
            /* Split from the tab before by a rule inset 10px top and bottom. */
            "& + &": {
                position: "relative",
                "&::before": { content: '""', position: "absolute", insetInlineStart: "0", top: "10px", bottom: "10px", width: "1px", background: "border.subtle" },
            },
            _hover: { color: "fg" },
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
            "&[aria-selected=true]": { color: "fg", borderBottomColor: "fg" },
        },
        paneTabIcon: {
            display: "inline-flex", flexShrink: 0, fontSize: "14px", "[data-active] > &": { color: "brand.solid" },
            /* Three tabs on a strip have room for their icons only from 360 (QP17). */
            "@container (max-width: 359px)": { "[data-pane-tab*=':'] > &": { display: "none" } },
        },
        /* Its label whole: the tab's name. What follows it, whole or not at all, in the room it leaves. */
        paneTabLabel: {
            flexShrink: 0, whiteSpace: "nowrap",
            fontFamily: "mono", fontSize: "label.lg", fontWeight: "600", letterSpacing: "0.16em", textTransform: "uppercase",
        },
        paneTabMeta: {
            flexShrink: 1, minWidth: "0", ...wholeOrNone("16px"), whiteSpace: "nowrap",
            fontFamily: "mono", fontSize: "label.md", fontWeight: "500", color: "fg.subtle", fontVariantNumeric: "tabular-nums",
        },
        paneTabMark: {
            display: "inline-flex", flexShrink: 0, fontSize: "12px",
            "&[data-tone=warning]": { color: "status.warn" },
            "&[data-tone=danger]": { color: "status.neg" },
        },
        /* A phone's pane: a view over the whole builder, edge to edge, as the Filters view is (ruled 3 Nov 2026) —
         * `--paper`, sliding in from the right over `--dur-base` on `--ease-out` (at once under reduced motion), and off
         * to the right while a drag is under way; closed, off the frame's right edge, unseen. */
        drawer: {
            position: "absolute",
            inset: "0",
            zIndex: "overlay",
            display: "flex",
            flexDirection: "column",
            minHeight: "0",
            background: "bg.surface",
            overflow: "hidden",
            /* Closed, off the frame's right edge, which clips it — inert, never `visibility: hidden`: WebKit leaves the
             * text of a clipped span unpainted once a `visibility` it inherits comes back (the tabs' labels, on a phone). */
            transform: "translateX(100%)",
            transitionProperty: "transform",
            transitionDuration: "{durations.normal}",
            transitionTimingFunction: "{easings.out}",
            _motionReduce: { transition: "none" },
            "&[data-open]": { transform: "none" },
            "&[data-open][data-aside]": { transform: "translateX(100%)" },
            /* The tray's own rules are the view's: none on its own edges. */
            "& > :not([data-frame-slot=bottomPanel])": { flex: "1", minHeight: "0", borderWidth: "0" },
        },
        /* Where main's popovers and a pane's draw (FR9): what is above gives way to it, never it to what is above. */
        bottomPanel: {
            flex: "none", display: "flex", flexDirection: "column", minHeight: "0", maxHeight: "min(420px, 70%)",
            "&:empty": { display: "none" },
            /* Main's, under a footer laid over main's foot: the band stands over main, never over the panel's actions. */
            "[data-phone]:has(> [data-frame-slot=footer] :is([data-footer-line], [data-footer-live])) > &": { order: 1 },
        },
        /* A phone's view over the whole builder, a toolbar item's (FR7): over every region, taking the pointer only where
         * a view draws itself. */
        overlay: {
            position: "absolute", inset: "0", zIndex: "overlay", pointerEvents: "none", overflow: "hidden",
            /* A menu or a Select's list on a phone: the whole slot, whatever the floating placement set on it. */
            /* Closed, a Select keeps its list mounted: nothing, and nothing under the pointer. */
            '& > [data-frame-layer]:not(:has(> [data-state="open"]))': { display: "none !important" },
            '& > [data-frame-layer]:has(> [data-state="open"])': {
                position: "absolute !important", inset: "0 !important", width: "100% !important", minWidth: "0 !important", height: "100% !important",
                transform: "none !important", pointerEvents: "auto !important",
            },
            "& [data-frame-layer-content]": {
                display: "flex !important", flexDirection: "column", width: "100% !important", maxWidth: "none !important", height: "100% !important", maxHeight: "none !important",
                padding: "0 !important", border: "none !important", borderRadius: "0 !important", boxShadow: "none !important", background: "bg.surface", overflowY: "auto", outline: "none",
                /* In as a view does; out at once, with nothing for what mounts it to wait on under its `display: none`. */
                '&[data-state="open"]': { animationName: "slide-from-right-full", animationDuration: "normal", animationTimingFunction: "{easings.out}", _motionReduce: { animation: "none" } },
                '&[data-state="closed"]': { animation: "none !important" },
                "& [data-frame-layer-head]": { position: "sticky", top: "0", zIndex: "1", background: "bg.surface" },
                /* Its rows at touch size, across the view. */
                '& [data-part="item"], & [data-part="option-item"]': { flex: "none", minHeight: "44px", paddingX: "16px", borderRadius: "0", fontSize: "body", whiteSpace: "normal" },
                '& [data-part="item-group-label"]': { paddingX: "16px" },
            },
        },
    },
});
