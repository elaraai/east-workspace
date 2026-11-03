/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared toolbar items' phone forms (`Mobile Builder Frame Spec.md` FR2,
 * `Mobile Filters Spec.md` SL2), as the designer's `WorkOrdersPhone` draws
 * them in a frame of 560px or less:
 *
 *   - filters: the rail as one 44px button — min 44 wide, padded 0 10, its
 *     filter icon 14 and, while any field is set, their count in mono 11/600,
 *     4px apart, on `--r-md`. At rest no fill and no rule, in `--ink-3`;
 *     while any field is set `--brand-dd` ink on a 34px `--brand-tint` fill with
 *     a `--brand-d` rule, as tall as `+ Tab`, clear of the row's edges and its
 *     target still the row's height.
 *   - search: the key search as one 44px ghost button — min 44 wide, padded
 *     0 10, 4px clear of the row's end, its magnifier 16 and caret 10 in
 *     `--ink-3`; hovered `--paper-3` and ink.
 *   - views: a builder's view tabs, taking the row's slack and scrolling
 *     sideways with no bar, padded 0 16, 16 apart. A view: 44 tall, padded
 *     0 4, mono 11/600 at 0.16em in caps, `--ink-4`, its name at most 120
 *     wide; open, `--ink` over a 2px `--ink` rule. Its count after its name,
 *     500 at 0.04em in `--ink-4`. `+ Tab`: 34 tall, padded 0 12, a dashed
 *     `--rule-strong` on `--r-sm`, mono 10.5/600 at 0.1em in caps, `--ink-4`.
 *   - count: the count line, 8 clear of what is before it and 16 of what is
 *     after, mono 10.5 tabular in `--ink-3`, its number 600 in `--ink`. A row
 *     short of room drops it, or over several sources those that do not fit,
 *     each whole: it never cuts one, nor the views or the buttons around it.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";
import { wholeOrNone } from "../../style/whole-or-none.js";

/** What both buttons share: 44px tall and at least as wide, centred on the row, on `--r-md`. */
const BUTTON = {
    alignSelf: "center",
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "{spacing.1}",
    height: "44px",
    minWidth: "44px",
    paddingX: "10px",
    boxSizing: "border-box",
    borderRadius: "md",
    background: "transparent",
    color: "fg.muted",
    cursor: "pointer",
    _focusVisible: { outline: "none", boxShadow: "focus" },
} as const;

export const toolbarPhoneSlotRecipe = defineSlotRecipe({
    className: "elara-toolbar-phone",
    slots: ["filters", "search", "searchGroup", "views", "view", "viewLabel", "viewCount", "viewAdd", "count"],
    base: {
        filters: {
            ...BUTTON,
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "transparent",
            fontFamily: "mono",
            fontSize: "label.lg",
            fontWeight: "600",
            fontVariantNumeric: "tabular-nums",
            "& svg": { fontSize: "14px" },
            position: "relative",
            isolation: "isolate",
            "&[data-active]": {
                color: "brandPressed",
                "&::before": {
                    content: '""', position: "absolute", insetInline: "0", insetBlock: "5px", zIndex: -1, boxSizing: "border-box",
                    background: "brandTint", borderWidth: "1px", borderStyle: "solid", borderColor: "brand.solid", borderRadius: "md",
                },
            },
        },
        search: {
            ...BUTTON,
            marginInlineEnd: "{spacing.1}",
            border: "none",
            "& svg[data-search-icon]": { fontSize: "16px" },
            "& svg[data-search-caret]": { fontSize: "10px" },
            _hover: { background: "bg.subtle", color: "fg" },
        },
        searchGroup: { display: "flex", alignItems: "center" },
        views: {
            flex: "1 1 auto",
            minWidth: "0",
            alignSelf: "stretch",
            display: "flex",
            alignItems: "stretch",
            gap: "{spacing.4}",
            paddingX: "{spacing.4}",
            overflowX: "auto",
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": { display: "none" },
        },
        view: {
            flex: "none",
            height: "44px",
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
            boxSizing: "border-box",
            paddingX: "{spacing.1}",
            borderBottomWidth: "2px",
            borderBottomStyle: "solid",
            borderBottomColor: "transparent",
            background: "transparent",
            fontFamily: "mono",
            fontSize: "label.lg",
            fontWeight: "600",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            cursor: "pointer",
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
            "&[data-active]": { color: "fg", borderBottomColor: "fg" },
        },
        viewLabel: { maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis" },
        viewCount: { fontWeight: "500", letterSpacing: "0.04em", color: "fg.subtle", fontVariantNumeric: "tabular-nums" },
        viewAdd: {
            /* 34 tall as the designer draws it; a tap anywhere on the row's height takes it. */
            ...coarseHitArea({ axis: "block", position: true }),
            alignSelf: "center",
            flex: "none",
            height: "34px",
            display: "inline-flex",
            alignItems: "center",
            paddingX: "{spacing.3}",
            boxSizing: "border-box",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "border.strong",
            borderRadius: "sm",
            background: "transparent",
            fontFamily: "mono",
            fontSize: "label.md",
            fontWeight: "600",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "fg.subtle",
            cursor: "pointer",
            _focusVisible: { outline: "none", boxShadow: "focus" },
        },
        count: {
            ...wholeOrNone("44px"),
            minWidth: "0",
            columnGap: "{spacing.3}",
            /* Margins, not padding: what clips the line clips at its padding's edge, so words ran through the padding. */
            marginInlineStart: "{spacing.2}",
            marginInlineEnd: "{spacing.4}",
            fontFamily: "mono",
            fontSize: "label.md",
            fontVariantNumeric: "tabular-nums",
            color: "fg.muted",
            whiteSpace: "nowrap",
            "& b": { fontWeight: "600", color: "fg" },
            /* A record rail's summary in it: the line's mono and ink, its shown number 600 in ink (`2 of 7 lines`). */
            "& [data-record-slices-summary], & [role=status]": { font: "inherit", color: "inherit", letterSpacing: "inherit" },
            /* Its sources are the line's items, each shown whole or not at all; the gap says what the dot between them did. */
            "& [data-record-slices-summary]": { display: "contents" },
            "& [data-record-slices-summary] > [aria-hidden]": { display: "none" },
            "& [role=status] > span:first-of-type": { fontWeight: "600", color: "fg" },
        },
    },
});
