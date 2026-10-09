/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Query builder slot recipe (#935, #936) — the builder as the Query Editor
 * spec draws it, in the shared builder frame (#1125, the `builderFrame`
 * recipe's): its one toolbar band over the pane and the results, side by
 * side, and the status line under both. This recipe draws what is the
 * builder's own: its element around the frame, the status line, a tab of the
 * pane, and the Query tab's parts — its notices, the source, the shape lines
 * between the steps, the step cards with their rows of words, slots, inputs,
 * chips, adds, removes, groups, feet, notes, code and problem lines, and the
 * foot with Quick add. The builder fills its host and draws no border of its
 * own; a host frames it, or places it bare.
 *
 * The parts take their sizes from the design system's own: a slot is the
 * `select` trigger, an input the `input`, a jq step's code the `codeBlock`,
 * the buttons the `button` and `iconButton` recipes, the status line's dots
 * the `status` recipe. This recipe adds what those have not: the dashed and
 * danger states (by data attributes), and the joiner column that lines
 * conditions up. Its toolbar row and its layout are the builder frame's, its
 * pane the `dock`'s, its history item the `editHistory`'s, Download ▾ the
 * `menu`'s; the jq view and the results are their own recipes' (`jqEditor`,
 * `queryResults`).
 *
 * Dropping a query in (#939): while a drag layer is on the page, the builder's
 * frame sits in its drop zone — the one cell a query library's card drops on —
 * and the target over it is drawn as Studio's canvas draws its end zone:
 * hidden at rest, the dashed brand frame while a card it takes is dragged, and
 * the brand wash with its words while one rests on it, by CSS alone on the
 * drag layer's `data-drop-valid` / `data-drop-active`. The shared ⊘ refusal
 * stays.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** A small dashed button: a shape line's Insert, an add in a row. */
const dashed = {
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: "border.strong",
    background: "transparent",
    color: "fg.muted",
    _hover: { borderColor: "fg.muted", color: "fg", background: "bg.surface" },
} as const;

export const queryBuilderSlotRecipe = defineSlotRecipe({
    className: "elara-query-builder",
    slots: [
        "root", "tab", "status",
        // The toolbar's own items.
        "viewIcon", "copy", "menuLabel", "menuMeta",
        // The Query tab.
        "notices", "steps", "empty", "source", "sourceIcon", "sourceText", "sourceTitle", "sourceKind",
        "shape", "shapeRule", "shapeText", "shapeExtra", "insert",
        "card", "cardHead", "cardNumber", "cardIcon", "cardTitle", "cardSpacer", "cardActions", "cardBody", "unfinished",
        "row", "joiner", "word", "slot", "slotText", "slotCaret", "input", "chip", "chipRemove", "add", "remove",
        "group", "groupBox", "groupHead", "cardFoot", "note", "problem", "problemIcon", "problemText",
        "tabFoot", "addAtEnd", "quick", "quickLabel",
        // The status line.
        "statusCheck", "statusRule", "statusShape", "statusFields", "statusSave", "statusName",
        // Dropping a query in (#939).
        "dropZone", "dropTarget", "dropTitle", "dropMeta",
    ],
    base: {
        /* The builder's element around its frame: as tall as its host lets it be, and unframed; the autocomplete hangs inside it. */
        root: {
            position: "relative",
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            minHeight: "0",
        },
        /* A tab of the pane: its panel's whole height, on the panel tint the cards stand out on; its parts scroll. */
        tab: {
            height: "100%",
            minHeight: "0",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            background: "bg.panel",
        },
        /* The status line under the pane and the results: the frame's footer, over its own rule. */
        status: {
            display: "flex",
            alignItems: "center",
            flexShrink: "0",
            gap: "{spacing.4}",
            minHeight: "32px",
            paddingX: "{spacing.4}",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            background: "bg.panel",
            whiteSpace: "nowrap",
            overflow: "hidden",
            fontSize: "xs",
            color: "fg.muted",
        },

        /* ── The toolbar's own items ─────────────────────────────────────── */
        /* A view's icon, in the Visual · jq strip. */
        viewIcon: {
            display: "inline-flex",
            marginInlineEnd: "6px",
            fontSize: "10px",
            "&:last-child": { marginInlineEnd: "0" },
        },
        /* Copy jq: its check, for a moment after it copies. */
        copy: {
            "&[data-copied]": { color: "fg.success" },
        },
        /* Download ▾'s entries: the format, and what it is beside it. */
        menuLabel: {
            flex: "1",
        },
        menuMeta: {
            marginInlineStart: "{spacing.4}",
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "medium",
            color: "fg.subtle",
        },

        /* ── The Query tab ───────────────────────────────────────────────── */
        /* What just happened: dismissible banners over the steps. */
        notices: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
            flexShrink: "0",
            paddingX: "{spacing.4}",
            paddingTop: "{spacing.3}",
            "&:empty": { display: "none" },
        },
        /* The source, the steps and their shapes: the tab's scroller. */
        steps: {
            flex: "1",
            minHeight: "0",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            paddingTop: "{spacing.4}",
            paddingX: "{spacing.4}",
            paddingBottom: "28px",
        },
        /* With no steps. */
        empty: {
            marginTop: "{spacing.1}",
            marginX: "{spacing.1}",
            fontSize: "12.5px",
            lineHeight: "1.5",
            color: "fg.muted",
        },
        source: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.3}",
            paddingY: "10px",
            paddingX: "12px",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.lg}",
        },
        sourceIcon: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "28px",
            height: "28px",
            flexShrink: "0",
            borderRadius: "{radii.md}",
            background: "bg.subtle",
            color: "fg.muted",
            fontSize: "12px",
        },
        sourceText: {
            display: "flex",
            flexDirection: "column",
            gap: "3px",
            minWidth: "0",
        },
        sourceTitle: {
            fontSize: "13px",
            fontWeight: "semibold",
            color: "fg",
        },
        sourceKind: {
            fontSize: "12px",
            color: "fg.muted",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        /* The line between two steps: a rule down the steps' spine, the shape, and Insert. */
        shape: {
            display: "flex",
            alignItems: "stretch",
            gap: "10px",
            minHeight: "30px",
            paddingInlineStart: "25px",
        },
        shapeRule: {
            width: "1px",
            flexShrink: "0",
            background: "border.strong",
        },
        shapeText: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            flex: "1",
            minWidth: "0",
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "medium",
            lineHeight: "1.2",
            fontVariantNumeric: "tabular-nums",
            color: "fg.muted",
            whiteSpace: "nowrap",
            "&[data-counted]": { color: "fg" },
        },
        shapeExtra: {
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: "fg.subtle",
        },
        /* Insert: the button's size, dashed. */
        insert: {
            alignSelf: "center",
            ...dashed,
        },
        /* A step: dashed while unfinished, the danger ink's rule with a problem. */
        card: {
            background: "bg.surface",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "{radii.lg}",
            "&[data-unfinished]": { borderStyle: "dashed" },
            "&[data-error]": { borderColor: "fg.danger" },
        },
        cardHead: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "{spacing.2}",
            minHeight: "40px",
            paddingY: "6px",
            paddingInlineStart: "12px",
            paddingInlineEnd: "6px",
        },
        cardNumber: {
            width: "18px",
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "semibold",
            lineHeight: "1",
            fontVariantNumeric: "tabular-nums",
            color: "fg.subtle",
        },
        cardIcon: {
            display: "inline-flex",
            justifyContent: "center",
            width: "14px",
            fontSize: "12px",
            color: "fg.muted",
        },
        cardTitle: {
            fontSize: "13px",
            fontWeight: "semibold",
            color: "fg",
        },
        cardSpacer: { flex: "1" },
        /* Move up, Move down and Remove: quiet until hovered. */
        cardActions: {
            display: "flex",
            alignItems: "center",
            gap: "2px",
            opacity: "0.6",
            transitionProperty: "opacity",
            transitionDuration: "{durations.fast}",
            _hover: { opacity: "1" },
            _focusWithin: { opacity: "1" },
        },
        cardBody: {
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            paddingInlineStart: "44px",
            paddingInlineEnd: "12px",
            paddingBottom: "12px",
        },
        unfinished: {
            fontSize: "11.5px",
            color: "fg.subtle",
        },
        /* A row of words and parts. */
        row: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "6px",
            minHeight: "28px",
        },
        /* `and`, `or`: a fixed column, so conditions line up. */
        joiner: {
            width: "30px",
            flexShrink: "0",
            fontSize: "12.5px",
            color: "fg.muted",
        },
        word: {
            fontSize: "12.5px",
            color: "fg.muted",
            whiteSpace: "nowrap",
        },
        /* A slot, over the select trigger: dashed while empty, the danger ink with a problem. */
        slot: {
            width: "auto",
            maxWidth: "200px",
            gap: "6px",
            paddingInlineEnd: "8px",
            "&[data-empty]": { borderStyle: "dashed", color: "fg.subtle" },
            "&[data-error]": { borderColor: "fg.danger", color: "fg.danger" },
            "&[data-open]": { borderColor: "{colors.brand.600}", boxShadow: "focus" },
            "&[data-mono]": { fontFamily: "mono", fontVariantNumeric: "tabular-nums" },
        },
        slotText: {
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        /* The slot's caret: Font Awesome's caret-down (#1263), its own width,
         * as the glyph it replaced, not Font Awesome's fixed 1.25em. */
        slotCaret: {
            "--fa-width": "auto",
            display: "inline-flex",
            flexShrink: "0",
            fontSize: "9px",
            color: "fg.subtle",
        },
        /* A count, a name, a value or a bound, over the input. */
        input: {
            "&[data-width=count]": { width: "56px" },
            "&[data-width=name]": { width: "120px" },
            "&[data-width=value]": { width: "120px" },
            "&[data-width=range]": { width: "64px" },
            "&[data-mono]": { fontFamily: "mono", fontVariantNumeric: "tabular-nums" },
            "&[data-error]": { borderColor: "fg.danger" },
        },
        /* A field a Look up brings in, with its ×. */
        chip: {
            display: "inline-flex",
            alignItems: "center",
            gap: "2px",
            height: "24px",
            paddingInlineStart: "8px",
            paddingInlineEnd: "2px",
            borderRadius: "{radii.sm}",
            background: "bg.brand.subtle",
            color: "fg",
            fontSize: "12px",
            fontWeight: "medium",
        },
        chipRemove: {
            width: "20px",
            height: "20px",
        },
        /* An add in a row, dashed; a foot's, a quiet link. */
        add: {
            ...dashed,
            "&[data-ghost]": {
                borderWidth: "0",
                color: "link",
                fontWeight: "semibold",
                paddingInline: "{spacing.1}",
                _hover: { background: "bg.subtle", color: "link" },
            },
        },
        /* A row's ×. */
        remove: {
            color: "fg.subtle",
        },
        /* A group of conditions: its joiner, and its box. */
        group: {
            display: "flex",
            gap: "6px",
        },
        groupBox: {
            flex: "1",
            minWidth: "0",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            paddingY: "{spacing.2}",
            paddingInlineStart: "10px",
            paddingInlineEnd: "6px",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.md}",
            background: "bg.panel",
        },
        groupHead: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "6px",
        },
        cardFoot: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "{spacing.3}",
            minHeight: "26px",
            paddingInlineStart: "32px",
        },
        note: {
            paddingInlineStart: "36px",
            fontSize: "12px",
            color: "fg.subtle",
        },
        /* A problem under its row, in its severity's ink, with its fixes. */
        problem: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingInlineStart: "36px",
            paddingBottom: "{spacing.1}",
            fontSize: "12px",
            lineHeight: "1.4",
            "&[data-severity=error]": { color: "fg.danger" },
            "&[data-severity=warning]": { color: "fg.warning" },
            "&[data-severity=note]": { color: "fg.muted" },
        },
        problemIcon: {
            display: "inline-flex",
            fontSize: "11px",
        },
        problemText: {
            flex: "1 1 180px",
        },
        /* The foot: Add a step at the end, and Quick add. */
        tabFoot: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
            flexShrink: "0",
            paddingTop: "10px",
            paddingX: "{spacing.4}",
            paddingBottom: "12px",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            background: "bg.panel",
        },
        addAtEnd: {
            ...dashed,
            width: "100%",
            height: "36px",
            borderRadius: "{radii.lg}",
        },
        quick: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "6px",
        },
        quickLabel: {
            fontFamily: "mono",
            fontSize: "9.5px",
            fontWeight: "semibold",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.subtle",
        },

        /* ── The status line ─────────────────────────────────────────────── */
        /* Its start: the check, the shape the query gives, and its fields. */
        statusCheck: {
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flex: "1 1 auto",
            minWidth: "0",
        },
        statusRule: {
            width: "1px",
            height: "12px",
            flexShrink: "0",
            background: "border.strong",
        },
        statusShape: {
            flexShrink: "0",
            fontSize: "12.5px",
            color: "fg",
        },
        statusFields: {
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontSize: "12px",
            color: "fg.subtle",
        },
        /* Its end: the save state and the name. */
        statusSave: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            flex: "0 1 auto",
            minWidth: "0",
            maxWidth: "45%",
        },
        statusName: {
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontSize: "12px",
            color: "fg.muted",
        },

        /* ── Dropping a query in (#939) ──────────────────────────────────── */
        /* Around the builder's frame while a drag layer is on the page: the one
         * cell a query library's card drops on. Its target draws the armed and
         * over looks, so the shared candidate and active frames give way to it,
         * as on Studio's canvas; the shared ⊘ refusal stays. */
        dropZone: {
            position: "relative",
            flex: "1",
            minHeight: "0",
            display: "flex",
            flexDirection: "column",
            "&[data-drag-cell][data-drop-valid]:not([data-drop-active]):not([data-drop-invalid])::before": { borderStyle: "none" },
            "&[data-drag-cell][data-drop-active]:not([data-drop-invalid])::before": { borderStyle: "none" },
            "&[data-drag-cell][data-drop-active]:not([data-drop-invalid])": { background: "transparent" },
        },
        /* The target over the body, as the canvas's end zone: hidden at rest;
         * armed — the dashed brand frame — while a card it takes is dragged;
         * over — the brand wash and its words — while one rests on it. */
        dropTarget: {
            position: "absolute",
            inset: "0",
            zIndex: 4,
            display: "none",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "{spacing.1}",
            padding: "{spacing.6}",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "brand.solid",
            textAlign: "center",
            pointerEvents: "none",
            transitionProperty: "background",
            transitionDuration: "{durations.fast}",
            "[data-drop-valid]:not([data-drop-invalid]) > &": { display: "flex" },
            "[data-drop-active]:not([data-drop-invalid]) > &": { display: "flex", background: "bg.brand.subtle" },
        },
        /* Its words, while a card rests on it: the query a drop opens, and its steps. */
        dropTitle: {
            display: "none",
            fontSize: "14px",
            fontWeight: "semibold",
            color: "brand.fg",
            "[data-drop-active] > * > &": { display: "block" },
        },
        dropMeta: {
            display: "none",
            fontSize: "12px",
            fontVariantNumeric: "tabular-nums",
            color: "fg.muted",
            "[data-drop-active] > * > &": { display: "block" },
        },
    },
});
