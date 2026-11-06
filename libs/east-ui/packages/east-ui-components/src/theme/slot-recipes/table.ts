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
 *   - At 560 px of its own width or narrower (`data-table-phone`, `Query Builder
 *     Phone Spec.md` QP8–QP12): the pager band, 44 tall, padded 0 4 0 16, its
 *     range mono 10.5 and its ‹ › 44 ghosts, listing the columns in place; a
 *     32 header on `--paper-2`; cells padded 8 12, the pinned column's 16 before
 *     it, the last in view's 16 after it; values wrapping, numbers mono 13/500,
 *     an absent value `no data` in mono italic `--ink-4`.
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
        "phoneGroupRow", "phoneGroup", "phonePager", "phonePagerBand", "phonePagerRange", "phonePagerStep", "phoneColumns", "phoneColumn", "phoneColumnMark", "phoneColumnText", "phoneColumnName", "phoneColumnKind", "phoneColumnCheck", "phoneHeaderSort", "phoneAbsent", "phoneBar",
        "phoneView", "phoneViewHead", "phoneViewBack", "phoneViewTitle", "phoneViewContext", "phoneViewFoot",
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
            /* A phone's: 32 tall, its label's sort button centred in it (QP12). */
            "[data-table-phone] &": {
                display: "flex", alignItems: "center", height: "32px",
                paddingY: "0", paddingX: "0", background: "bg.canvas", overflow: "visible",
            },
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
                transitionDuration: "{durations.normal}",
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
            "[data-table-phone] &": {
                fontSize: "{fontSizes.body}", paddingY: "8px", paddingX: "12px",
                "&[data-pinned]": { paddingInlineStart: "16px" },
                "&[data-last]": { paddingInlineEnd: "16px" },
            },
        },
        // The text a cell prints itself when its column has no `render`
        // (#874) — one line, cut with an ellipsis in a narrow column.
        cellText: {
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "&[data-numeric]": { fontFamily: "mono", fontSize: "12px", textAlign: "right" },
            /* A phone's: whole, a value too wide for its column wrapping at its spaces. */
            "[data-table-phone] &": { whiteSpace: "normal", overflow: "visible", overflowWrap: "anywhere", "&[data-numeric]": { fontSize: "13px", fontWeight: "500", fontVariantNumeric: "tabular-nums" } },
        },
        /* The pager: over the rows as they scroll under it. */
        phonePager: { position: "sticky", top: 0, left: 0, zIndex: 3, background: "bg.surface", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        phonePagerBand: { height: "44px", display: "flex", alignItems: "center", paddingInlineStart: "16px", paddingInlineEnd: "4px" },
        phonePagerRange: {
            flex: "1", minWidth: "0", height: "44px", display: "inline-flex", alignItems: "center", gap: "{spacing.2}", padding: "0", background: "transparent", border: "none", cursor: "pointer",
            fontFamily: "mono", fontSize: "label.md", color: "fg.muted", whiteSpace: "nowrap", textAlign: "left",
            "& b": { fontWeight: "600", color: "fg" }, "& svg": { fontSize: "10px", color: "fg.subtle" },
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        phonePagerStep: {
            flex: "none", width: "44px", height: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0", border: "none", background: "transparent",
            color: "fg.strong", cursor: "pointer", borderRadius: "md", "& svg": { fontSize: "16px" },
            "&[aria-disabled=true]": { color: "fg.faint", cursor: "default" },
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        /* The columns, in a frame's view or listed in place: no floating menu on a phone. */
        phoneColumns: { maxHeight: "240px", overflowY: "auto", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle", "[data-table-columns-view] &": { flex: "1", minHeight: "0", maxHeight: "none", borderTopWidth: "0" } },
        phoneColumn: {
            width: "100%", minHeight: "44px", display: "flex", alignItems: "center", gap: "{spacing.2}", paddingX: "16px", paddingY: "8px", boxSizing: "border-box",
            border: "none", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle", background: "transparent", textAlign: "left",
            "button&": { cursor: "pointer" },
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        phoneColumnMark: { flex: "none", width: "16px", display: "inline-flex", justifyContent: "center", fontSize: "12px", color: "fg.muted" },
        phoneColumnText: { flex: "1", minWidth: "0", display: "flex", flexDirection: "column" },
        phoneColumnName: { fontSize: "{fontSizes.body}", color: "fg", lineHeight: "18px", "&::first-letter": { textTransform: "uppercase" } },
        phoneColumnKind: { fontFamily: "mono", fontSize: "label.md", lineHeight: "14px", color: "fg.subtle" },
        phoneColumnCheck: { flex: "none", display: "inline-flex", fontSize: "12px", color: "brand.solid" },
        /* The view (QP33, QP34). */
        phoneView: { position: "absolute", inset: "0", pointerEvents: "auto", display: "flex", flexDirection: "column", background: "bg.surface" },
        phoneViewHead: { flex: "none", minHeight: "44px", display: "flex", alignItems: "center", gap: "8px", paddingInlineEnd: "8px", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        phoneViewBack: { flex: "none", width: "44px", height: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0", border: "none", background: "transparent", color: "fg.muted", cursor: "pointer", "& svg": { fontSize: "16px" }, _focusVisible: { outline: "none", boxShadow: "focusInset" } },
        phoneViewTitle: { flex: "none", fontFamily: "heading", fontSize: "title.sm", fontWeight: "700", letterSpacing: "-0.01em", color: "fg" },
        phoneViewContext: { flex: "1", minWidth: "0", fontFamily: "mono", fontSize: "label.md", color: "fg.subtle" },
        phoneViewFoot: { "&::first-letter": { textTransform: "uppercase" }, flex: "none", paddingTop: "12px", paddingX: "16px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))", fontFamily: "mono", fontSize: "label.md", lineHeight: "1.4", color: "fg.subtle", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle" },
        /* The header's label, its whole height the tap that sorts. */
        /* The row of a phone's column groups: one line of heads across the table. */
        phoneGroupRow: { display: "flex", width: "100%" },
        /* A column group's head over the columns of it in view: its words whole, wrapping at spaces; its width the
           columns' it heads, given inline, and the review's spacer (`data-table-phone-fill`) the rest of the row. */
        phoneGroup: {
            flex: "none", "&[data-table-phone-fill]": { flex: "1 0 auto" },
            minHeight: "28px", display: "flex", alignItems: "center", justifyContent: "center", paddingY: "4px", paddingX: "8px", boxSizing: "border-box", textAlign: "center",
            fontFamily: "mono", fontSize: "label.xs", fontWeight: "600", letterSpacing: "0.14em", textTransform: "uppercase", lineHeight: "1.3", whiteSpace: "normal",
            background: "bg.canvas", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
            "& + &[data-table-phone-group]": { borderInlineStartWidth: "1px", borderInlineStartStyle: "solid", borderInlineStartColor: "border.subtle" },
        },
        phoneHeaderSort: {
            all: "unset", position: "relative", boxSizing: "border-box", width: "100%", height: "100%", display: "flex", alignItems: "center", gap: "{spacing.1}", paddingX: "12px", cursor: "pointer",
            /* The header stays the design's 32; its tap is 44, past it either side. */
            "&::after": { content: '""', position: "absolute", insetInline: "0", top: "-6px", bottom: "-6px" },
            "th[data-pinned] > &": { paddingInlineStart: "16px" },
            "th[data-last] > &": { paddingInlineEnd: "16px" },
            "&[data-align=end]": { justifyContent: "flex-end" },
            "&:disabled": { cursor: "default" },
            "& svg": { width: "8px", height: "8px", flex: "none" },
            _focusVisible: { boxShadow: "focusInset" },
        },
        phoneBar: { height: "12px", borderRadius: "0", background: "bg.subtle", animation: "none" },
        phoneAbsent: { fontFamily: "mono", fontSize: "label.md", fontStyle: "italic", fontWeight: "400", color: "fg.subtle", whiteSpace: "nowrap" },
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
