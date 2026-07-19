/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<App>` application-shell slot recipe (#367) — the bsys "Sidebar recipe" +
 * "Header recipe" promoted from the showcase's hand-built chrome into a reusable
 * component. Mode-aware semantic tokens only (#362).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const appSlotRecipe = defineSlotRecipe({
    className: "elara-app",
    slots: [
        "root", "rail", "railHeader", "logo", "railBody", "collapseToggleRow", "collapseToggle",
        "railFooter", "content", "bannerTop", "header", "headerRow", "breadcrumb",
        "barStart", "barCenter", "barEnd", "themeToggle", "title", "main",
    ],
    base: {
        // Full-viewport shell; the main region scrolls internally so the page
        // itself never overflows.
        root: {
            display: "flex",
            height: "100dvh",
            width: "100%",
            overflow: "hidden",
            background: "bg.canvas",
            alignItems: "stretch",
        },
        // Sidebar panel — bsys "nav.panel": shares the canvas plane with main, so a
        // strong right rule (a hairline vanishes between same-luminance surfaces).
        rail: {
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            height: "100dvh",
            overflowY: "auto",
            overflowX: "hidden",
            background: "bg.canvas",
            borderRightWidth: "1px",
            borderRightColor: "border.strong",
            transitionProperty: "width",
            transitionDuration: "{durations.normal}",
            transitionTimingFunction: "{easings.smooth}",
        },
        // Logo region — bsys "nav.logo": fixed-height identity strip, no bottom
        // rule (a rule-free gap separates it from the first item).
        railHeader: {
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            paddingInline: "16px",
            marginBottom: "12px",
        },
        logo: {
            display: "flex",
            alignItems: "center",
            height: "100%",
            // The <img> needs a defined height (an SVG data URI has no intrinsic
            // px size — maxHeight alone collapses it to zero).
            "& img": { height: "28px", width: "auto", maxWidth: "100%", objectFit: "contain", display: "block" },
        },
        railBody: {
            flex: "1",
            minHeight: "0",
            overflowY: "auto",
            overflowX: "hidden",
        },
        collapseToggleRow: {
            display: "flex",
            flexShrink: 0,
            paddingInline: "10px",
            paddingBlock: "8px",
        },
        // 22×22 chevron — matches the bsys Sidebar header button dims.
        collapseToggle: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "22px",
            height: "22px",
            border: "0",
            background: "transparent",
            color: "fg.muted",
            cursor: "pointer",
            fontSize: "10px",
            borderRadius: "{radii.sm}",
            transitionProperty: "background, color",
            transitionDuration: "{durations.fast}",
            _hover: { color: "brand.fg", background: "bg.muted" },
        },
        railFooter: {
            flexShrink: 0,
            paddingInline: "14px",
            paddingBlock: "10px",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
        },
        // Right column — header + scrolling main.
        content: {
            display: "flex",
            flexDirection: "column",
            flex: "1",
            minWidth: "0",
            height: "100dvh",
        },
        bannerTop: { flexShrink: 0 },
        // Sticky app bar — bsys "header.bar": strong bottom rule holds as a hard
        // line when content scrolls up behind the sticky bar.
        header: {
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            flexShrink: 0,
            position: "sticky",
            top: "0",
            zIndex: "10",
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomColor: "border.strong",
            paddingInline: "{spacing.6}",
            paddingTop: "14px",
            paddingBottom: "16px",
        },
        headerRow: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.3}",
            minHeight: "28px",
            minWidth: "0",
        },
        breadcrumb: {
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        barStart: { display: "inline-flex", alignItems: "center", gap: "{spacing.2}", minWidth: "0" },
        // Center cluster (host global search) expands to push the trailing bar right.
        barCenter: { display: "inline-flex", alignItems: "center", flex: "1", minWidth: "0", justifyContent: "center" },
        barEnd: { display: "inline-flex", alignItems: "center", gap: "{spacing.2}", marginInlineStart: "auto", flexShrink: 0 },
        // Built-in dark/light toggle (opt-in) — a ghost icon button in the bar.
        themeToggle: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "32px",
            height: "32px",
            border: "0",
            background: "transparent",
            color: "fg.muted",
            cursor: "pointer",
            fontSize: "14px",
            borderRadius: "{radii.sm}",
            transitionProperty: "background, color",
            transitionDuration: "{durations.fast}",
            _hover: { color: "brand.fg", background: "bg.muted" },
        },
        // Surface title row — bsys "surface.title".
        title: {
            fontFamily: "heading",
            fontSize: "{fontSizes.xl}",
            fontWeight: "bold",
            color: "fg",
            lineHeight: "1.2",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        // Main scroll region — bsys "Main recipe" padding.
        main: {
            flex: "1",
            minHeight: "0",
            overflowY: "auto",
            paddingInline: "{spacing.6}",
            paddingBlock: "{spacing.8}",
        },
    },
    variants: {
        /** Rail width + logo alignment flip between expanded and collapsed. */
        collapsed: {
            true: {
                rail: { width: "56px" },
                railHeader: { height: "56px", justifyContent: "center", paddingInline: "0" },
                collapseToggleRow: { justifyContent: "center" },
            },
            false: {
                rail: { width: "240px" },
                railHeader: { height: "64px", justifyContent: "flex-start" },
                collapseToggleRow: { justifyContent: "flex-end" },
            },
        },
    },
    defaultVariants: {
        collapsed: false,
    },
});
