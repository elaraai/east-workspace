/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio page library slot recipe — the layout of the page library's frame, as
 * the Studio spec draws it: its one toolbar band; the pane beside the rows on
 * the quiet panel, the projects over the project's pages and the status
 * legend at its foot; and the Templates and Pages sections with their heads.
 *
 * Only the layout is the page library's own. Its search box is the Library's,
 * its toolbar row the shared `toolbar`'s, its Grid · List the `seg` strip,
 * its buttons the `button` recipe's, its status dots the `status` recipe's,
 * its New page popover the edit popover's (`sliceEdit`), and its two rows
 * are Library galleries.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** Strong secondary ink — a row the pane lists. */
const INK_2 = { base: "brand.700", _dark: "gray.300" } as const;

/** The pane's mono caps captions. */
const CAPTION = {
    fontFamily: "mono",
    fontSize: "9.5px",
    fontWeight: "600",
    letterSpacing: "0.18em",
    lineHeight: "normal",
    textTransform: "uppercase",
    color: "fg.subtle",
} as const;

export const studioPageLibrarySlotRecipe = defineSlotRecipe({
    className: "elara-studio-page-library",
    slots: [
        "root", "toolbar", "divider", "caret", "buttonIcon", "body",
        "pane", "paneSection", "paneCaption", "paneHead", "paneCount", "paneRow", "paneIcon", "paneTitle", "paneRule", "legend",
        "main", "section", "sectionHead", "sectionTitle", "sectionSub",
    ],
    base: {
        /* The page library's own panel, as tall as its host lets it be. */
        root: {
            display: "flex",
            flexDirection: "column",
            height: "100%",
            minHeight: "0",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "10px",
            overflow: "hidden",
        },
        /* The one toolbar band: the shared toolbar's row. */
        toolbar: {
            display: "flex",
            flexWrap: "nowrap",
            alignItems: "center",
            flexShrink: "0",
            height: "44px",
            paddingX: "{spacing.4}",
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            overflow: "clip",
        },
        /* The rule before the primary action. */
        divider: {
            width: "1px",
            height: "18px",
            background: "border.strong",
        },
        /* The Sort button's caret, and the primary action's plus. */
        caret: { fontSize: "9px" },
        buttonIcon: { fontSize: "10px" },
        /* The pane beside the rows. */
        body: {
            flex: "1",
            minHeight: "0",
            display: "grid",
            gridTemplateColumns: "224px minmax(0, 1fr)",
        },
        pane: {
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            minHeight: "0",
            paddingX: "10px",
            paddingY: "{spacing.4}",
            overflowY: "auto",
            background: "bg.panel",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
        },
        paneSection: { display: "flex", flexDirection: "column", gap: "2px" },
        paneCaption: CAPTION,
        /* A section's caption, and its count at the right. */
        paneHead: {
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            paddingX: "10px",
            paddingBottom: "{spacing.2}",
        },
        paneCount: { fontFamily: "mono", fontSize: "10px", color: "fg.subtle", fontVariantNumeric: "tabular-nums" },
        /* A project, or a page with its status dot at the right — the page
           open in the builder in the strong ink. */
        paneRow: {
            display: "flex",
            alignItems: "center",
            gap: "10px",
            width: "100%",
            height: "32px",
            paddingX: "10px",
            border: "none",
            borderRadius: "{radii.sm}",
            background: "transparent",
            fontSize: "13px",
            textAlign: "start",
            color: INK_2,
            cursor: "pointer",
            _hover: { background: "bg.subtle" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
            "&[data-page]": { justifyContent: "space-between" },
            "&[data-current]": { fontWeight: "500", color: "fg" },
            "&[data-active]": {
                background: "bg.brand.subtle",
                fontWeight: "600",
                color: "brand.fg",
                _hover: { background: "bg.brand.subtle" },
            },
        },
        paneIcon: {
            flexShrink: "0",
            width: "14px",
            fontSize: "11px",
            color: "fg.subtle",
            "[data-active] > &": { color: "brand.solid" },
        },
        paneTitle: { minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
        paneRule: { height: "1px", marginX: "10px", background: "border.subtle" },
        /* The status legend, at the pane's foot. */
        legend: {
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            paddingX: "10px",
            paddingTop: "{spacing.3}",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
        },
        /* The rows, on the quiet panel; they scroll within a bounded frame. */
        main: {
            display: "flex",
            flexDirection: "column",
            minWidth: "0",
            minHeight: "0",
            overflowY: "auto",
            background: "bg.panel",
        },
        section: {
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            paddingX: "{spacing.6}",
            paddingY: "20px",
            "&[data-section=templates]": {
                paddingBottom: "{spacing.6}",
                borderBottomWidth: "1px",
                borderBottomColor: "border.subtle",
            },
        },
        sectionHead: { display: "flex", alignItems: "baseline", gap: "{spacing.3}" },
        sectionTitle: {
            fontFamily: "heading",
            fontSize: "16px",
            fontWeight: "700",
            letterSpacing: "-0.01em",
            color: "fg",
        },
        sectionSub: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
    },
});
