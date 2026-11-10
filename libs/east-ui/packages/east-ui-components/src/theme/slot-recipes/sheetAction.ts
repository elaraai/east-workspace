/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Sheet action slot recipe — an action column's cell, its popover form, and a
 * phone's bottom container: its action bar and its cell editor (#1475–#1479,
 * `Sheet Action Column - Behaviour Spec.md` §1, §6, §12; `Mobile Sheet
 * Spec.md` SH9, SH10).
 *
 * The cell fills the grid's cell inside its rules: the left zone (the state's
 * word and dot, its summary, or the absent value), then the next half and the
 * ▾ part, each flush to the cell's height with a rule on its left and no
 * position or z-index of its own, so the grid's ring — the cell's last child —
 * paints over them. A held control (its menu or form open) keeps its fill.
 * The menu is the shared Menu card's and the popover the shared Popover
 * card's; this recipe lays out what is inside them. Every colour is a theme
 * token: `fg` … `fg.faint` the inks, `bg.surface` · `bg.canvas` · `bg.subtle`
 * the papers, `border.subtle` · `border.strong` the rules.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** The state's tones (S6): the dot's base and the word's text step, by `data-tone`. */
const TONES = {
    "&[data-tone=success]": { "--action-dot": "{colors.status.pos}", color: "fg.success" },
    "&[data-tone=warning]": { "--action-dot": "{colors.status.warn}", color: "fg.warning" },
    "&[data-tone=danger]": { "--action-dot": "{colors.status.neg}", color: "fg.danger" },
    "&[data-tone=info]": { "--action-dot": "{colors.status.info}", color: "fg.info" },
} as const;

/** A control flush inside the cell's rules (S9, S10, S12): transparent at rest, a hover a step darker than the cell's. */
const CONTROL = {
    flex: "none",
    alignSelf: "stretch",
    display: "inline-flex",
    alignItems: "center",
    boxSizing: "border-box",
    margin: 0,
    border: 0,
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: "border.subtle",
    borderRadius: 0,
    background: "transparent",
    color: "fg.strong",
    cursor: "pointer",
    outline: "none",
    transitionProperty: "background-color, color",
    transitionDuration: "fast",
    transitionTimingFunction: "ease-out",
    _hover: { background: "bg.subtle", color: "fg" },
    "&[data-held]": { background: "bg.subtle", color: "fg" },
    "&[data-disabled]": { color: "fg.faint", cursor: "default", _hover: { background: "transparent", color: "fg.faint" } },
    "& svg": { fontSize: "14px" },
} as const;

export const sheetActionSlotRecipe = defineSlotRecipe({
    className: "elara-sheet-action",
    slots: [
        "root", "zone", "state", "dot", "summary", "absent", "start", "next", "icon", "caret", "more", "moreSpace",
        "menu", "menuHead", "menuKbd", "menuReason",
        "form", "formHead", "formLabel", "formEyebrow", "formMeta", "formClose", "formBody", "formError", "formFoot", "formConsequence", "formButton",
        "panel", "panelState", "panelActions", "panelChoices", "panelForm",
        "bar", "barHead", "barEyebrow", "barState", "barFirst", "barRest", "barButton", "barConsequence", "barBack", "barChoice", "barClose", "barWhy",
        "cellLine", "cellStep", "cellInput", "cellUnit", "cellHelp", "cellClear", "cellForm",
    ],
    base: {
        /* The cell's content, filling it inside its rules; the ring the grid draws after it paints over. */
        root: {
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "stretch",
            lineHeight: "16px",
            minWidth: 0,
            /* A selected or dirty cell keeps its fill: the control's ink carries the hover (ST2). */
            "&[data-on] [data-slot=actionNext]:not([data-held]), &[data-on] [data-slot=actionMore]:not([data-held])": { _hover: { background: "transparent", color: "fg" } },
        },
        /* The state, then its summary (S3). */
        zone: {
            flex: "1 1 auto",
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            paddingX: "8px",
            cursor: "default",
            /* A phone's (SH7): the state over its summary, 2 apart, padded as the grid's cells are. */
            "[data-sheet-card][data-phone] &": { flexDirection: "column", alignItems: "stretch", justifyContent: "center", gap: "2px" },
        },
        /* The state's word after its dot (S4), its slot as wide as the column's widest word (S5). */
        state: {
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            flex: "none",
            minWidth: "var(--action-slot, 0px)",
            boxSizing: "border-box",
            fontFamily: "mono",
            fontSize: "label.md",
            fontWeight: 600,
            lineHeight: "16px",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: "fg.muted",
            "--action-dot": "{colors.fg.subtle}",
            ...TONES,
            /* A dirty cell's words in brand (ST3); the dot keeps its tone. */
            "&[data-dirty]": { color: "brandPressed" },
        },
        dot: {
            width: "8px",
            height: "8px",
            flex: "none",
            borderRadius: "full",
            background: "var(--action-dot)",
        },
        /* What follows the state (S7). */
        summary: {
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "body.sm",
            lineHeight: "16px",
            color: "fg.muted",
            "&[data-dirty]": { color: "brandPressed" },
            "& [data-num]": { fontFamily: "mono", fontWeight: 500 },
            /* A phone's (SH7): under the state, 16 in, 12.5 in `--ink-3` — only where a 44px row has room for its
             * line; on a fine pointer's 32px row the state stands alone. */
            "[data-sheet-card][data-phone] &": { flex: "none", display: "none", paddingLeft: "16px", _coarse: { display: "block" } },
        },
        /* A phone's cell with nothing taken, its row free to act (SH7): `▶ Start` 12.5/500 in the brand. */
        start: {
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            flex: "none",
            fontSize: "body.sm",
            fontWeight: 500,
            lineHeight: "16px",
            color: "brand.solid",
            whiteSpace: "nowrap",
            "& svg": { fontSize: "12px" },
        },
        /* Nothing taken (S8): not started, or why the row waits. */
        absent: {
            flex: "none",
            fontFamily: "mono",
            fontSize: "body",
            fontStyle: "italic",
            fontWeight: 400,
            lineHeight: "16px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        /* The offer's first case (S9): its icon slot kept, its label, a choice's caret. */
        next: {
            ...CONTROL,
            width: "112px",
            justifyContent: "flex-start",
            gap: "8px",
            paddingX: "8px",
            fontSize: "body.sm",
            fontWeight: 500,
            whiteSpace: "nowrap",
        },
        icon: {
            width: "14px",
            flex: "none",
            display: "inline-flex",
            justifyContent: "center",
            "&[data-check] svg": { color: "status.pos" },
        },
        caret: { color: "fg.muted", display: "inline-flex", "& svg": { fontSize: "14px" } },
        /* The rest of the offer, behind ▾ (S10). */
        more: {
            ...CONTROL,
            width: "24px",
            justifyContent: "center",
            padding: 0,
            color: "fg.muted",
        },
        /* Where a column's ▾ part stands on a row offered one case: kept, so the next halves line up down the column (F16 of the hand test). */
        moreSpace: { flex: "none", width: "24px" },
        /* The menu card (M1, M7): 240 wide, appearing at once — the Menu recipe's open state animates it, so that state too (F9 of the hand retest). */
        menu: {
            minWidth: "240px", animation: "none",
            /* The Menu recipe animates its open state by placement, so the placement's selector too (the hand retest's 5). */
            _open: { animation: "none", "&[data-placement]": { animation: "none" } },
        },
        /* The menu: a group's head (M2), a direct action's Kbd cap and a disabled item's reason (M3, M4). */
        menuHead: {
            height: "24px",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "flex-end",
            paddingX: "12px",
            paddingBottom: "4px",
            fontFamily: "mono",
            fontSize: "label.xs",
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        menuKbd: {
            marginLeft: "auto",
            height: "20px",
            minWidth: "20px",
            boxSizing: "border-box",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            paddingX: "4px",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "sm",
            background: "bg.canvas",
            fontFamily: "mono",
            fontSize: "label.lg",
            fontWeight: 500,
            lineHeight: 1,
            color: "fg.strong",
        },
        menuReason: { marginLeft: "auto", paddingLeft: "24px", fontFamily: "mono", fontSize: "label.md", color: "fg.subtle" },
        /* The popover form (F1–F8): head, body of fields, foot with the consequence and the verb. */
        form: { width: "320px", maxWidth: "100%", display: "flex", flexDirection: "column" },
        formHead: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            paddingX: "12px",
            paddingY: "8px",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderBottomColor: "border.subtle",
        },
        /* The form's label: its eyebrow, then the row's words beside it, on one line (F11 of the hand retest). */
        formLabel: { display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 },
        formEyebrow: {
            flex: "none",
            fontFamily: "mono",
            fontSize: "label.sm",
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg",
        },
        formMeta: {
            flex: 1,
            minWidth: 0,
            fontFamily: "mono",
            fontSize: "label.xs",
            letterSpacing: "0.04em",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        formClose: { flex: "none" },
        formBody: { padding: "12px", display: "flex", flexDirection: "column", gap: "12px" },
        formError: { fontFamily: "mono", fontSize: "label.md", color: "fg.danger" },
        formFoot: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            paddingX: "12px",
            paddingY: "8px",
            borderTopWidth: "1px",
            borderTopStyle: "solid",
            borderTopColor: "border.subtle",
            background: "bg.canvas",
            borderBottomRadius: "md",
        },
        formConsequence: {
            flex: 1,
            minWidth: 0,
            fontFamily: "mono",
            fontSize: "label.md",
            color: "fg.muted",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        formButton: { flex: "none" },
        /* The inspector's action field (#1478): the state as its cell draws it, the offered cases, a choice's reasons or a form inline. */
        panelState: {
            position: "relative",
            height: "32px",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.subtle",
            borderRadius: "md",
            background: "bg.surface",
            /* A phone's Details (SH12): the state alone at the end of the field's label row, as the designer draws it. */
            "&[data-phone]": {
                position: "absolute", top: "16px", right: "20px", width: "50%", height: "18px",
                border: "none", borderRadius: "0", background: "transparent",
                "& [data-slot=actionZone]": { justifyContent: "flex-end", paddingX: "0" },
            },
        },
        /* The inspector's field: inside the pane's width, as the form it holds (#1478, F8 of the hand retest). */
        panel: { minWidth: 0, maxWidth: "100%" },
        panelActions: { minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginTop: "8px", "& svg": { fontSize: "12px" } },
        panelChoices: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", marginTop: "8px" },
        panelForm: {
            /* Inside the pane's width, every field with it (#1478, the hand test's F8). */
            minWidth: 0,
            maxWidth: "100%",
            "& [data-field-form], & [data-field], & [data-field-line]": { minWidth: 0, maxWidth: "100%" },
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            marginTop: "8px",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.subtle",
            borderRadius: "md",
            paddingTop: "8px",
            paddingX: "8px",
            "& [data-slot=actionFoot]": { marginX: "-8px" },
            /* The pane is narrow: its consequence wraps rather than cut. */
            "& [data-consequence]": { whiteSpace: "normal" },
        },
        /* A phone's action bar (X5–X7; `Mobile Sheet Spec.md` SH9, the designer's `WorkOrdersPhone`): in the bottom
         * container — `--paper-2`, a `--rule-strong` above, padded 0 16 12, its parts 8 apart, at most 420 then scrolling. */
        bar: {
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            paddingTop: "0",
            paddingX: "16px",
            paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
            background: "bg.canvas",
            borderTopWidth: "1px",
            borderTopStyle: "solid",
            borderTopColor: "border.strong",
            maxHeight: "420px",
            overflowY: "auto",
            /* The grid gives way to the bar, never the bar to the grid (X7): a scroller's least height is 0. */
            flexShrink: 0,
        },
        /* Its head, 44: ‹ back in a sub-view, the eyebrow, the state, ⌄ close — the close 12 into the bar's padding. */
        barHead: { flex: "none", height: "44px", display: "flex", alignItems: "center", gap: "8px", marginRight: "-12px" },
        barEyebrow: {
            flex: "1",
            minWidth: 0,
            fontFamily: "mono",
            fontSize: "label.sm",
            fontWeight: 600,
            lineHeight: "1.4",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg",
            /* Two lines before an ellipsis: the step's name is what the bar is for. */
            lineClamp: 2,
            overflowWrap: "anywhere",
        },
        barState: { flex: "none" },
        barFirst: { display: "flex" },
        barRest: { display: "grid", gridTemplateColumns: "repeat(var(--action-rest, 3), minmax(0, 1fr))", gap: "8px" },
        /* Default 44 buttons on `--r-md` (`--rule-strong`, the paper): the first full width at 12.5/600, the rest 12.5/500. */
        barButton: {
            minHeight: "44px",
            height: "44px",
            width: "100%",
            justifyContent: "center",
            gap: "8px",
            paddingX: "8px",
            borderColor: "border.strong",
            borderRadius: "md",
            background: "bg.surface",
            fontSize: "body.sm",
            fontWeight: 500,
            color: "fg",
            whiteSpace: "nowrap",
            "&[data-first]": { paddingX: "12px", fontWeight: 600 },
            "& svg": { fontSize: "16px" },
            "& [data-check] svg": { color: "status.pos" },
        },
        barConsequence: { fontFamily: "mono", fontSize: "label.md", lineHeight: "1.5", color: "fg.muted" },
        /* Why a blocked row waits (SH9.3): running text in `--ink-2`. */
        barWhy: { paddingBottom: "4px", fontSize: "body", lineHeight: "1.5", color: "fg.strong" },
        /* ‹ back: 44 on `--r-md`, 14 into the bar's padding, its chevron 14 in `--ink-3`. */
        barBack: {
            flex: "none", width: "44px", height: "44px", marginLeft: "-14px", marginRight: "-4px",
            display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", padding: "0", borderRadius: "md",
            background: "transparent", color: "fg.muted", cursor: "pointer", "& svg": { fontSize: "14px" },
            _hover: { background: "bg.subtle", color: "fg" },
        },
        /* ⌄ close: the same, at the head's end. */
        barClose: {
            flex: "none", width: "44px", height: "44px",
            display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", padding: "0", borderRadius: "md",
            background: "transparent", color: "fg.muted", cursor: "pointer", "& svg": { fontSize: "14px" },
            _hover: { background: "bg.subtle", color: "fg" },
        },
        /* A choice's reasons (SH9.2): a 44 row each, outlined, body 13 in ink, left-aligned. */
        barChoice: {
            minHeight: "44px", height: "44px", width: "100%", justifyContent: "flex-start", paddingX: "12px",
            borderColor: "border.strong", borderRadius: "md", background: "bg.surface", fontSize: "body", fontWeight: 400, color: "fg",
        },
        /* A phone's cell editor (SH10), in the same bottom container under the same head: its controls on one line, 8 apart. */
        cellLine: { display: "flex", alignItems: "center", gap: "8px" },
        /* A number's − and + : 44 squares on `--r-md`, outlined in `--rule-strong` on the paper, the icon 16 in ink. */
        cellStep: {
            flex: "none", width: "44px", height: "44px", boxSizing: "border-box", padding: "0",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md",
            background: "bg.surface", color: "fg", cursor: "pointer", "& svg": { fontSize: "16px" },
            _hover: { background: "bg.canvas" },
            _focusVisible: { outline: "2px solid {colors.brand.solid}", outlineOffset: "2px" },
            _disabled: { color: "fg.faint", borderColor: "border.subtle", cursor: "default", _hover: { background: "bg.surface" } },
        },
        /* The field: 44 tall, padded 0 12, mono 13/500 in tabular figures at its end; a drafted value on the brand's tint;
         * a value its bounds don't hold, its edge in the tone its row's Save stands in, as the form's is (#1585). */
        cellInput: {
            flex: "1", minWidth: 0, height: "44px", boxSizing: "border-box", paddingX: "12px",
            borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md",
            background: "bg.surface", color: "fg",
            fontFamily: "mono", fontSize: "body", fontWeight: 500, fontVariantNumeric: "tabular-nums", textAlign: "right",
            outline: "none",
            "&[data-dirty]": { background: "brandTint", color: "brandPressed" },
            "&[data-breach=warn]": { borderColor: "status.warn" },
            "&[data-breach=error]": { borderColor: "status.neg" },
            _focusVisible: { borderColor: "brand.solid", boxShadow: "inset 0 0 0 1px {colors.brand.solid}" },
            _placeholder: { color: "fg.faint" },
        },
        /* A number's unit after the field: mono 10.5/500 in `--ink-4`. */
        cellUnit: { flex: "none", fontFamily: "mono", fontSize: "label.md", fontWeight: 500, lineHeight: "1.4", color: "fg.subtle" },
        /* The help line under the field: mono 10.5 in `--ink-4` — naming bounds its value doesn't hold, in the tone its row's
         * Save stands in, as the form says it (#1585): a warning as stored, an error once its change holds Save. */
        cellHelp: {
            fontFamily: "mono", fontSize: "label.md", lineHeight: "1.4", color: "fg.subtle",
            "&[data-breach=warn]": { color: "fg.warning" },
            "&[data-breach=error]": { color: "fg.danger" },
        },
        /* A time's Clear: a Default 44 button, padded 0 16, 12.5/500 in ink. */
        cellClear: {
            flex: "none", height: "44px", boxSizing: "border-box", paddingX: "16px",
            display: "inline-flex", alignItems: "center",
            borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md",
            background: "bg.surface", fontFamily: "body", fontSize: "body.sm", fontWeight: 500, color: "fg", cursor: "pointer",
            _hover: { background: "bg.canvas" },
            _focusVisible: { outline: "2px solid {colors.brand.solid}", outlineOffset: "2px" },
            _disabled: { color: "fg.faint", borderColor: "border.subtle", cursor: "default", _hover: { background: "bg.surface" } },
        },
        /* Every other kind (R9): the inspector's form at touch size, its field's label the eyebrow's, its controls 44 tall. */
        cellForm: {
            minWidth: 0,
            "& [data-field-form], & [data-field], & [data-field-line]": { minWidth: 0, maxWidth: "100%" },
            "& [data-field] label": { display: "none" },
            "& [data-field-line] input, & [data-field-line] button, & [data-field-line] [data-part=trigger]": { minHeight: "44px" },
        },
    },
});
