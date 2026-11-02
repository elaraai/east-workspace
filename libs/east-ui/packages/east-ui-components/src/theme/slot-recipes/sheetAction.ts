/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Sheet action slot recipe — an action column's cell, its popover form and a
 * phone's action bar (#1475–#1479, `Sheet Action Column - Behaviour Spec.md`
 * §1, §6, §12).
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
        "root", "zone", "state", "dot", "summary", "absent", "next", "icon", "caret", "more", "moreSpace",
        "menu", "menuHead", "menuKbd", "menuReason",
        "form", "formHead", "formLabel", "formEyebrow", "formMeta", "formClose", "formBody", "formError", "formFoot", "formConsequence", "formButton",
        "panel", "panelState", "panelActions", "panelChoices", "panelForm",
        "bar", "barHead", "barEyebrow", "barState", "barFirst", "barRest", "barButton", "barConsequence", "barBack", "barChoice",
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
            position: "relative",
            /* While an auto save is in flight, an echo of the dot (N2). */
            "&[data-live]::after": {
                content: '""',
                position: "absolute",
                inset: 0,
                borderRadius: "full",
                background: "var(--action-dot)",
                animation: "elara-live-pulse calc({durations.slow} * 4) {easings.out} infinite",
                _motionReduce: { animation: "none" },
            },
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
            /* A phone's frame shows the state alone (X4): no sliver of a summary (the hand retest's 3). */
            "[data-sheet-card][data-phone] &": { display: "none" },
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
        /* A phone's action bar (X5–X7): the docked strip as the selected row's actions. */
        bar: {
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "12px",
            paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
            background: "bg.canvas",
            borderTopWidth: "1px",
            borderTopStyle: "solid",
            borderTopColor: "border.strong",
            maxHeight: "60%",
            overflowY: "auto",
            /* The grid gives way to the bar, never the bar to the grid (X7): a scroller's least height is 0. */
            flexShrink: 0,
        },
        barHead: { display: "flex", alignItems: "center", gap: "8px", minHeight: "20px" },
        barEyebrow: {
            fontFamily: "mono",
            fontSize: "label.sm",
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "brand.solid",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        barState: { marginLeft: "auto" },
        barFirst: { display: "flex" },
        barRest: { display: "grid", gridTemplateColumns: "repeat(var(--action-rest, 3), minmax(0, 1fr))", gap: "8px" },
        barButton: {
            minHeight: "44px",
            width: "100%",
            justifyContent: "center",
            gap: "8px",
            whiteSpace: "nowrap",
            "& svg": { fontSize: "16px" },
            "& [data-check] svg": { color: "status.pos" },
        },
        barConsequence: { fontFamily: "mono", fontSize: "label.md", color: "fg.muted" },
        barBack: { minWidth: "44px", minHeight: "44px" },
        barChoice: { minHeight: "44px", justifyContent: "flex-start" },
    },
});
