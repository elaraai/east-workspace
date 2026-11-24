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
 * border and stops 20px shorter; bare (`surface="bare"`, #1673) in a body its
 * host frames — a filter's condition rows — it draws no edge and no foot, and
 * takes the height the body has left it, so its list is the one thing that
 * scrolls; never less than its first three options (`--chooser-floor`, which
 * the Chooser sets), so it is never squeezed away.
 *
 * A label before the search says what the list is of, in the label voice
 * (`FIELD`); an option may lead with its icon in a 14px column, and a label
 * that reads as words (`data-words`) takes the body face.
 *
 * Slots:
 * - `root` — the column: search, list, foot.
 * - `search` — the band round the box; `searchLabel` the label before it; `searchBox` the 32px box; `searchIcon`; `searchInput`.
 * - `list` — the scrolling listbox.
 * - `section` — a section's head.
 * - `option` — one option: its mark, its text and its range. `data-highlighted`,
 *   `data-state` (`current`, `refused`, `disabled`), `data-warn`.
 * - `mark` — the 14px slot: a check for Current, a × for one refused.
 * - `icon` — an option's own icon, in a 14px column after its mark (`data-icon`).
 * - `text`, `label`, `line` — the option's name and its line.
 * - `range` — its range, at its end.
 * - `empty` — `no match`.
 * - `foot` — the keys.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** The search box's height, and a coarse pointer's. */
const BOX = 32;
const BOX_COARSE = 44;
/** The band's padding round the box. */
const BAND_PAD = 8;
/** An option's least height, and a coarse pointer's. */
const OPTION = 40;
const OPTION_COARSE = 44;
/** The list's padding above and under its options. */
const LIST_PAD = 4;

/**
 * The least a bare Chooser is: its search band (its padding, its box and the rule under it) and its list's first
 * options, as many as `--chooser-floor` says.
 */
const floor = (box: number, option: number): string =>
    `calc(${BAND_PAD * 2 + box + 1}px + var(--chooser-floor, 0) * ${option}px + ${LIST_PAD * 2}px)`;

export const chooserSlotRecipe = defineSlotRecipe({
    className: "elara-chooser",
    slots: ["root", "search", "searchLabel", "searchBox", "searchIcon", "searchInput", "list", "section", "option", "mark", "icon", "text", "label", "line", "range", "empty", "foot"],
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
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: `${BAND_PAD}px`,
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        searchLabel: {
            flex: "none",
            fontFamily: "mono",
            fontSize: "label.sm",
            fontWeight: "semibold",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        searchBox: {
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            height: `${BOX}px`,
            boxSizing: "border-box",
            paddingX: "12px",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "md",
            background: "bg.surface",
            _focusWithin: { outline: "2px solid", outlineColor: "brand.solid", outlineOffset: "-1px" },
            _coarse: { height: `${BOX_COARSE}px` },
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
            paddingY: `${LIST_PAD}px`,
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
            minHeight: `${OPTION}px`,
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
            // An option with its icon: the icon's 14px column after the mark's.
            "&[data-icon]": { gridTemplateColumns: "14px 14px minmax(0, 1fr) auto" },
            _coarse: { minHeight: `${OPTION_COARSE}px` },
        },
        mark: {
            display: "flex",
            justifyContent: "center",
            fontSize: "label.lg",
            "[data-state='current'] > &": { color: "status.pos" },
            "[data-state='refused'] > &": { color: "fg.warning" },
        },
        icon: {
            display: "flex",
            justifyContent: "center",
            fontSize: "label.lg",
            color: "fg.muted",
            "[data-state='refused'] > &, [data-state='disabled'] > &": { color: "fg.faint" },
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
            // Words — a field's name, a step — in the body face, as the app's other lists set them.
            "&[data-words]": { fontFamily: "body", fontSize: "body", fontWeight: "normal" },
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
            // A phone's bottom panel has no keys to tell of.
            "[data-frame-panel] &": { display: "none" },
        },
    },
    variants: {
        /** Where it sits: in a `SliceEditPopover`, whose frame it fills, or laid in a pane with its own. */
        surface: {
            popover: {},
            inline: {
                root: { maxHeight: "340px", borderWidth: "1px", borderColor: "border.strong", borderRadius: "md" },
            },
            // In a body its host frames: no edge, and no foot (the component draws none); the height the body leaves it, its
            // list scrolling, down to its search band and its first three options (`floor`), which its host shrinks it no
            // further than.
            bare: {
                root: {
                    background: "transparent",
                    maxHeight: "none",
                    minHeight: floor(BOX, OPTION),
                    _coarse: { minHeight: floor(BOX_COARSE, OPTION_COARSE) },
                },
            },
        },
    },
    defaultVariants: { surface: "popover" },
});
