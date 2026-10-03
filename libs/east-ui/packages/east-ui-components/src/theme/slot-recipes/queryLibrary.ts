/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Query library slot recipe — the layout of `<Query.Library>` (#1063), as
 * Studio's page library lays its frame out (`studioLibrary`): its one toolbar
 * band; the pane beside the gallery on the quiet panel — the data sources with
 * their counts, and Recent at its foot; the gallery on the quiet panel too,
 * under any notice; the empty state; and each card's media — the query's
 * wireframe, its source and a bar per step, or the dashed box that counts its
 * problems.
 *
 * Only the layout is the query library's own. Its search box is the
 * Library's, its toolbar row the shared `toolbar`'s, its Grid · List the `seg`
 * strip, its buttons the `button` recipe's, its cards the Library gallery's,
 * its notice a `BannerView` and its empty state the `emptyState` recipe's.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** Strong secondary ink — a row the pane lists. */
const INK_2 = { base: "brand.700", _dark: "gray.300" } as const;

/** The mono caps voice — the pane's captions, the problems' count. */
const CAPTION = {
    fontFamily: "mono",
    fontSize: "9.5px",
    fontWeight: "600",
    letterSpacing: "0.18em",
    lineHeight: "normal",
    textTransform: "uppercase",
    color: "fg.subtle",
} as const;

export const queryLibrarySlotRecipe = defineSlotRecipe({
    className: "elara-query-library",
    slots: [
        "root", "toolbar", "divider", "caret", "buttonIcon", "body",
        "pane", "paneSection", "paneHead", "paneCaption", "paneRow", "paneIcon", "paneTitle", "paneCount", "paneFoot",
        "main", "notice", "gallery", "empty", "emptyList",
        "wireframe", "wireRow", "wireIcon", "wireTitle", "wireMore",
        "problems", "problemCount", "problemText",
    ],
    base: {
        /* The query library's own panel, as tall as its host lets it be — and
           unframed, so a host can frame it or place it bare. */
        root: {
            display: "flex",
            flexDirection: "column",
            height: "100%",
            minHeight: "0",
            background: "bg.surface",
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
        /* The pane beside the gallery. */
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
        paneHead: {
            display: "flex",
            alignItems: "baseline",
            paddingX: "10px",
            paddingBottom: "{spacing.2}",
        },
        paneCaption: CAPTION,
        /* All queries, a data source or Recent — its count at the right, the
           one shown in the brand. */
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
        paneTitle: { flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
        paneCount: {
            flexShrink: "0",
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "500",
            color: "fg.subtle",
            fontVariantNumeric: "tabular-nums",
            "[data-active] > &": { color: "brand.solid" },
        },
        /* Recent, at the pane's foot under a rule. */
        paneFoot: {
            marginTop: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            paddingTop: "10px",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
        },
        /* The gallery, on the quiet panel; it scrolls within a bounded frame. */
        main: {
            display: "flex",
            flexDirection: "column",
            minWidth: "0",
            minHeight: "0",
            overflowY: "auto",
            background: "bg.panel",
        },
        /* A notice over the gallery: why a card does not open. */
        notice: {
            paddingX: "20px",
            paddingTop: "{spacing.4}",
        },
        gallery: { padding: "20px" },
        /* Nothing to show, in the middle of the panel, on the panel's own tint. */
        empty: {
            flex: "1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "{spacing.6}",
            "& [data-scope=empty-state][data-part=root]": { background: "transparent" },
        },
        emptyList: {
            listStyle: "none",
            margin: "0",
            padding: "0",
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.1}",
            fontSize: "{fontSizes.control}",
            color: "fg.muted",
        },
        /* A card's media: the query's wireframe — its source, then a bar per
           step, each its icon and title — on the gallery's sunken paper. */
        wireframe: {
            display: "flex",
            flexDirection: "column",
            gap: "3px",
            minWidth: "0",
        },
        wireRow: {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flexShrink: "0",
            minWidth: "0",
            height: "17px",
            paddingX: "6px",
            borderRadius: "3px",
            borderWidth: "1px",
            borderColor: "border.subtle",
            background: "bg.surface",
            fontSize: "10.5px",
            color: "fg.muted",
            "&[data-wire=source]": {
                fontFamily: "mono",
                fontWeight: "600",
                color: "fg",
                borderColor: "border.strong",
            },
        },
        wireIcon: {
            flexShrink: "0",
            width: "11px",
            fontSize: "8.5px",
            textAlign: "center",
            color: "fg.subtle",
            "[data-wire=source] > &": { color: "brand.solid" },
        },
        wireTitle: { minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
        wireMore: {
            paddingX: "6px",
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.subtle",
        },
        /* A query with problems here: their count, dashed, and the first. */
        problems: {
            flex: "1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            minWidth: "0",
            paddingX: "12px",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "border.strong",
            borderRadius: "4px",
            textAlign: "center",
        },
        problemCount: { ...CAPTION, fontSize: "10px", letterSpacing: "0.14em", color: "fg.danger" },
        problemText: {
            fontSize: "12px",
            lineHeight: "1.4",
            color: "fg.muted",
            lineClamp: "2",
        },
    },
});
