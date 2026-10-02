/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Table slot recipe — pattern_spec `.dt` data table.
 *
 *   - Column header: mono uppercase 10/600/0.16em, `bg.panel`, 1 px
 *     `border.strong` bottom rule.
 *   - Cell: body 13/normal, 1 px `border.subtle` bottom rule, 14/10
 *     padding. A column that prints numbers sets them in mono, aligned
 *     right, and its header's controls come before its label.
 *   - Total row: 1 px `border.strong` top, `bg.panel` fill, weight 600.
 *   - Header controls (#951): the label, then one row of 24 px pin / sort
 *     buttons, shown while the header is hovered or holds focus, and a
 *     resize grip on its right edge.
 *   - Nested rows (#954), the Plan's gutter voice (#949): a row's first cell
 *     indents one step per depth — a 14 px caret and its 6 px gap — so a
 *     child's label starts where its parent's does; a parent's subtotal
 *     cells are semibold.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

export const tableSlotRecipe = defineSlotRecipe({
    className: "elara-table",
    slots: [
        "root", "header", "body", "row", "cell", "cellText", "columnHeader",
        "columnHeaderContent", "columnHeaderLabel", "columnControls",
        "columnControl", "columnSortIndex", "columnResizer",
        "footer", "caption", "scrollArea", "treeIndent", "treeToggle",
    ],
    base: {
        root: {
            fontFamily: "body",
            borderCollapse: "collapse",
            width: "100%",
            fontFeatureSettings: '"tnum" 1',
        },
        columnHeader: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            letterSpacing: "{letterSpacings.wider2}",
            textTransform: "uppercase",
            color: "fg.subtle",
            /* Same gray.50 as canvas in light; in dark, canvas (gray.900) is
             * DARKER than the surface the table sits on, so the header band
             * read as a hole — panel tracks the surface level (#362). */
            background: "bg.panel",
            paddingX: "14px",
            paddingY: "10px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.strong",
            textAlign: "left",
            whiteSpace: "nowrap",
        },
        // A header's content (#951): its label, then its controls.
        columnHeaderContent: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "{spacing.2}",
            width: "100%",
            // Clear of the resize grip on the header's right edge.
            "&[data-resizable]": { paddingRight: "4px" },
            // A number column: the controls lead, the label ends on the right.
            "&[data-align=end]": { flexDirection: "row-reverse" },
        },
        columnHeaderLabel: {
            flex: "1",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            // An aligned stack's day column centres its label on the shared axis.
            "&[data-align=center]": { textAlign: "center" },
            "[data-align=end] > &": { textAlign: "right" },
        },
        // The pin and sort controls: one row beside the label. They show
        // while the header is hovered or holds focus, and stay shown for a
        // pinned or sorted column (`data-active`); where nothing hovers
        // (touch) they rest at reduced emphasis.
        columnControls: {
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            opacity: 0,
            transitionProperty: "opacity",
            transitionDuration: "{durations.fast}",
            "@media (hover: none)": { opacity: 0.6 },
            "th:hover &": { opacity: 1 },
            "th:focus-within &": { opacity: 1 },
            "&[data-active]": { opacity: 1 },
        },
        // One control: a 24 px button, its 10 px icon in the muted ink until
        // hovered or active. The tap halo is 36 px, not 44: the pair sits
        // adjacent, and full halos would swallow each other.
        columnControl: {
            ...coarseHitArea({ position: true, size: 36 }),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "24px",
            height: "24px",
            borderRadius: "sm",
            color: "fg.muted",
            cursor: "pointer",
            transitionProperty: "color, background",
            transitionDuration: "{durations.fast}",
            _hover: { color: "fg.default", background: "bg.emphasized" },
            "&[data-active]": { color: "fg.default" },
            "& svg": { width: "10px", height: "10px" },
            // The pin tilts while its column is unpinned.
            "&[data-control=pin]:not([data-active]) svg": { transform: "rotate(45deg)" },
        },
        // A multi-column sort's rank, in its sort control's corner.
        columnSortIndex: {
            position: "absolute",
            top: "4px",
            right: "4px",
            fontSize: "7px",
            fontWeight: "bold",
            lineHeight: "1",
            color: "fg.muted",
        },
        // The resize grip: a 6 px hit zone on the header's right edge, drawing
        // a 1 px line over its middle 40% while the header is hovered.
        columnResizer: {
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: "6px",
            cursor: "ew-resize",
            zIndex: 10,
            _before: {
                content: '""',
                position: "absolute",
                right: "2px",
                top: "30%",
                bottom: "30%",
                width: "1px",
                background: "bg.emphasized",
                opacity: 0,
                transitionProperty: "opacity",
                transitionDuration: "{durations.moderate}",
            },
            "th:hover &": { _before: { opacity: 1 } },
            _hover: { _before: { opacity: 1, background: "fg.muted" } },
        },
        // Nested rows (#954): the lead of a row's first cell — one step per
        // depth (`--table-depth`, the row's depth, set by the renderer), then
        // a parent's caret. The step is the caret and its gap, so a leaf
        // child's label starts exactly where its parent's does — the Plan's
        // gutter rule (#949).
        treeIndent: {
            display: "inline-flex",
            alignItems: "center",
            flexShrink: 0,
            paddingLeft: "calc(var(--table-depth, 0) * 20px)",
        },
        // A parent's caret — the Plan's (14 px, the subtle ink, pointing
        // right while its children are hidden) as a button that folds them.
        treeToggle: {
            ...coarseHitArea({ position: true }),
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "14px",
            height: "14px",
            marginRight: "6px",
            padding: 0,
            flexShrink: 0,
            borderRadius: "sm",
            fontSize: "11px",
            color: "fg.subtle",
            cursor: "pointer",
            transitionProperty: "color, transform",
            transitionDuration: "{durations.fast}",
            _hover: { color: "fg.default" },
            _focusVisible: { outline: "2px solid", outlineColor: "border.focus", outlineOffset: "1px" },
            "&[aria-expanded=false]": { transform: "rotate(-90deg)" },
        },
        cell: {
            fontSize: "{fontSizes.body}",
            // Tight leading so a single-line cell + 10px vertical padding
            // lands on the spec's ~36px row rather than ballooning past it
            // under Chakra's default 1.5 line-height.
            lineHeight: "{lineHeights.tight}",
            paddingX: "14px",
            paddingY: "10px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            // Centre cell content vertically — for the Table's content-height
            // rows this matches the old top alignment (rows sized to the
            // shared density token keep text centred).
            verticalAlign: "middle",
            color: "fg",
            // A parent's subtotal (#954) — an accounting subtotal: its
            // children's scale, heavier.
            "&[data-subtotal]": { fontWeight: "semibold" },
        },
        // The text a cell prints itself when its column has no `render`
        // (#874) — one line, cut with an ellipsis in a narrow column.
        cellText: {
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "&[data-numeric]": { fontFamily: "mono", fontSize: "12px", textAlign: "right" },
        },
        row: {
            transitionProperty: "background",
            transitionDuration: "{durations.fast}",
            /* Selection and hover are neutral (`--paper-3` / `--paper-2`).
             * Chakra fills a selected or hovered row from the palette's
             * `subtle`, and the default palette is the brand, so they keep the
             * gray they had (`bg`, Chakra's own key, so this replaces its
             * value). Pinned here, not as the table's palette, which every
             * part in its cells would inherit. */
            _selected: { bg: "gray.subtle" },
        },
        footer: {
            borderTopWidth: "1px",
            borderTopColor: "border.strong",
            background: "bg.panel",
            fontWeight: "semibold",
        },
        caption: { textStyle: "caption", color: "fg.muted", marginTop: "{spacing.2}" },
    },
    variants: {
        variant: {
            line: {},
            outline: {
                root: { borderWidth: "1px", borderColor: "border.subtle", borderRadius: "{radii.md}" },
            },
        },
        // Density sizes — padding from Chakra spacing tokens; the renderer maps
        // `value.density` (compact / cozy / comfortable) onto sm / md / lg and
        // pairs each with a row height from `TABLE_ROW_HEIGHT`.
        size: {
            sm: { cell: { paddingX: "{spacing.2}", paddingY: "{spacing.1.5}", fontSize: "12px" }, columnHeader: { paddingX: "{spacing.2}", paddingY: "{spacing.1.5}" } },
            md: { cell: { paddingX: "{spacing.3.5}", paddingY: "{spacing.2.5}", fontSize: "{fontSizes.body}" }, columnHeader: { paddingX: "{spacing.3.5}", paddingY: "{spacing.2.5}" } },
            lg: { cell: { paddingX: "{spacing.4}", paddingY: "{spacing.3}", fontSize: "{fontSizes.body.lg}" }, columnHeader: { paddingX: "{spacing.4}", paddingY: "{spacing.3}" } },
        },
        striped: { true: { row: { "&:nth-of-type(odd)": { background: "bg.subtle" } } } },
        interactive: {
            true: {
                row: { _hover: { background: "bg.subtle" }, cursor: "pointer" },
                body: { "& tr": { _hover: { bg: "gray.subtle" } } },
            },
        },
    },
    defaultVariants: { variant: "line", size: "md" },
});
