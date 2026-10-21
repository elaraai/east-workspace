/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Chooser slot recipe (#1322) — a searchable, sectioned single-choice list:
 * the Allocation's Table cells and its inspector's resource field, and any
 * builder after them. Every measurement is the mock's (`Allocation Spec.html`,
 * its Chooser): a 32px search box on an 8px band, 24px section heads, options
 * at least 40px on a `14px 1fr auto` grid, and a 32px foot of the keys.
 *
 * In a `SliceEditPopover` (`surface="popover"`) the popover is the frame; laid
 * in a pane (`surface="inline"`, the inspector's) the Chooser draws its own
 * border and stops 20px shorter.
 *
 * Slots:
 * - `root` — the column: search, list, foot.
 * - `search` — the band round the box; `searchBox` the 32px box; `searchIcon`; `searchInput`.
 * - `list` — the scrolling listbox.
 * - `section` — a section's head.
 * - `option` — one option: its mark, its text and its range. `data-highlighted`,
 *   `data-state` (`current`, `refused`, `disabled`), `data-warn`.
 * - `mark` — the 14px slot: a check for Current, a × for one refused.
 * - `text`, `label`, `line` — the option's name and its line.
 * - `range` — its range, at its end.
 * - `empty` — `no match`.
 * - `foot` — the keys.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const chooserSlotRecipe = defineSlotRecipe({
    className: "elara-chooser",
    slots: ["root", "search", "searchBox", "searchIcon", "searchInput", "list", "section", "option", "mark", "text", "label", "line", "range", "empty", "foot"],
    base: {
        root: {
            display: "flex",
            flexDirection: "column",
            maxHeight: "360px",
            minWidth: 0,
            boxSizing: "border-box",
            background: "bg.surface",
            overflow: "hidden",
        },
        search: {
            flex: "none",
            padding: "8px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        searchBox: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            height: "32px",
            boxSizing: "border-box",
            paddingX: "12px",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "md",
            background: "bg.surface",
            _focusWithin: { outline: "2px solid", outlineColor: "brand.solid", outlineOffset: "-1px" },
            _coarse: { height: "44px" },
        },
        searchIcon: { flex: "none", fontSize: "body.lg", color: "fg.subtle" },
        searchInput: {
            all: "unset",
            flex: 1,
            minWidth: 0,
            height: "100%",
            fontFamily: "body",
            fontSize: "body",
            color: "fg",
            _placeholder: { color: "fg.subtle" },
        },
        list: {
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            paddingY: "4px",
        },
        section: {
            height: "24px",
            display: "flex",
            alignItems: "center",
            paddingX: "12px",
            fontFamily: "mono",
            fontSize: "label.sm",
            fontWeight: "semibold",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
        },
        option: {
            width: "100%",
            display: "grid",
            gridTemplateColumns: "14px minmax(0, 1fr) auto",
            alignItems: "center",
            gap: "8px",
            minHeight: "40px",
            boxSizing: "border-box",
            paddingX: "12px",
            paddingY: "4px",
            border: "none",
            background: "transparent",
            textAlign: "left",
            cursor: "pointer",
            _hover: { background: "bg.subtle" },
            "&[data-highlighted]": { background: "bg.subtle" },
            "&[data-state='refused'], &[data-state='disabled']": { cursor: "default", _hover: { background: "transparent" } },
            _coarse: { minHeight: "44px" },
        },
        mark: {
            display: "flex",
            justifyContent: "center",
            fontSize: "label.lg",
            "[data-state='current'] > &": { color: "status.pos" },
            "[data-state='refused'] > &": { color: "fg.warning" },
        },
        text: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
        label: {
            fontFamily: "mono",
            fontSize: "label.lg",
            fontWeight: "semibold",
            color: "fg",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "[data-state='refused'] &, [data-state='disabled'] &": { color: "fg.faint" },
        },
        line: {
            fontFamily: "mono",
            fontSize: "label.xs",
            fontVariantNumeric: "tabular-nums",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "[data-state='refused'] &, [data-warn] &": { color: "fg.warning" },
        },
        range: {
            fontFamily: "mono",
            fontSize: "label.md",
            fontWeight: "medium",
            fontVariantNumeric: "tabular-nums",
            color: "fg",
            whiteSpace: "nowrap",
            "[data-state='refused'] &, [data-state='disabled'] &": { color: "fg.faint" },
        },
        empty: {
            padding: "12px",
            fontFamily: "mono",
            fontSize: "label.lg",
            fontStyle: "italic",
            fontWeight: "normal",
            color: "fg.subtle",
        },
        foot: {
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            height: "32px",
            paddingX: "12px",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            background: "bg.canvas",
            fontFamily: "mono",
            fontSize: "label.sm",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            // Its words end in an ellipsis where a narrow pane cuts them, never mid-letter at the edge.
            "& > span": { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
        },
    },
    variants: {
        /** Where it sits: in a `SliceEditPopover`, whose frame it fills, or laid in a pane with its own. */
        surface: {
            popover: {},
            inline: {
                root: { maxHeight: "340px", borderWidth: "1px", borderColor: "border.strong", borderRadius: "md" },
            },
        },
    },
    defaultVariants: { surface: "popover" },
});
