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
        "barStart", "barCenter", "barEnd", "themeToggle", "title", "titleDivider", "titleInline", "main",
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
        // Sticky app bar — design `.appbar`: 1px `--rule` bottom, `--paper` fill.
        // Padding / row gap are per-density (see the `density` variant).
        header: {
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            position: "sticky",
            top: "0",
            zIndex: "10",
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        // Breadcrumb row — no flex gap: the toggle rides `barEnd`'s `margin-inline-start:auto`
        // and (condensed) the title's spacing is the divider's own margins.
        headerRow: {
            display: "flex",
            alignItems: "center",
            gap: "0",
            minWidth: "0",
        },
        // Flex-centre the breadcrumb and tighten its line box to `1` (design
        // `.crumb { font: …/1 }`) so its 11px text sits on the row centre, level
        // with the divider + title (the component's default ~1.8 line-height
        // otherwise renders a 20px box that drops the text ~2px).
        breadcrumb: {
            display: "flex",
            alignItems: "center",
            lineHeight: "1",
            minWidth: "0",
            overflow: "hidden",
            whiteSpace: "nowrap",
        },
        barStart: { display: "inline-flex", alignItems: "center", gap: "{spacing.2}", minWidth: "0" },
        // Center cluster (host global search) expands to push the trailing bar right.
        barCenter: { display: "inline-flex", alignItems: "center", flex: "1", minWidth: "0", justifyContent: "center" },
        barEnd: { display: "inline-flex", alignItems: "center", gap: "{spacing.2}", marginInlineStart: "auto", flexShrink: 0 },
        // Built-in dark/light toggle (opt-in) — design `.appbar__toggle`: a ghost
        // icon button. Size / icon size / radius are per-density.
        themeToggle: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: "0",
            borderRadius: "8px",
            background: "transparent",
            color: "fg.muted",
            cursor: "pointer",
            transitionProperty: "background, color",
            transitionDuration: "{durations.fast}",
            _hover: { color: "brand.fg", background: "bg.muted" },
        },
        // Surface title row — design `.appbar__title` (comfortable / compact: own
        // row). DM Sans / 700 / −.015em / lh 1.1; font size is per-density.
        title: {
            fontFamily: "heading",
            fontWeight: "bold",
            color: "fg",
            letterSpacing: "-0.015em",
            lineHeight: "1.1",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        // Condensed density: the title rides the breadcrumb row after a short
        // vertical rule, instead of its own row. The rule is its own 1×14px span
        // (matched to the design) with symmetric 12px margins — NOT a full-height
        // border on the title — and the row has no flex gap, so the spacing is
        // exactly the rule's margins.
        titleDivider: {
            width: "1px",
            height: "14px",
            background: "border.strong",
            flexShrink: 0,
            marginInline: "12px",
        },
        // Condensed inline title — design `.appbar--condensed .title`: DM Sans 16 /
        // 700 / −.01em / lh 1.
        titleInline: {
            fontFamily: "heading",
            fontWeight: "bold",
            color: "fg",
            fontSize: "16px",
            letterSpacing: "-0.01em",
            lineHeight: "1",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 0,
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
        /** App-bar density — only the header changes (rail + body held constant),
         *  matched to the design spec:
         *  `comfortable` — 16px/24px padding · row1 24px · gap 8px · title 24px · toggle 24 (icon 14)
         *  `compact` — 12px/20px padding · row1 20px · gap 4px · title 18px · toggle 20 (icon 12)
         *  `condensed` — one 44px row · 0/20px padding · title 16px inline · toggle 20 (icon 12). */
        density: {
            comfortable: {
                header: { paddingInline: "24px", paddingTop: "16px", paddingBottom: "16px", gap: "8px" },
                headerRow: { minHeight: "24px" },
                title: { fontSize: "24px" },
                themeToggle: { width: "24px", height: "24px", fontSize: "14px", borderRadius: "8px" },
            },
            compact: {
                header: { paddingInline: "20px", paddingTop: "12px", paddingBottom: "12px", gap: "4px" },
                headerRow: { minHeight: "20px" },
                title: { fontSize: "18px" },
                themeToggle: { width: "20px", height: "20px", fontSize: "12px", borderRadius: "8px" },
            },
            condensed: {
                header: { paddingInline: "20px", paddingTop: "0", paddingBottom: "0", gap: "0" },
                headerRow: { minHeight: "44px" },
                themeToggle: { width: "20px", height: "20px", fontSize: "12px", borderRadius: "6px" },
            },
        },
    },
    defaultVariants: {
        collapsed: false,
        density: "comfortable",
    },
});
