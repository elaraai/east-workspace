/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Edit conflicts slot recipe — the body of the popover the history bar's
 * conflicts button opens (the bar's own recipe draws the button): an intro,
 * then one card for each part of a draft another write changed differently.
 * A card's head is its mark (the 8px warn dot until it is chosen, then the
 * check in `--pos`), its item in the body face at 13/500 and Go to in the
 * link's ink; under it the part's label, a mono label in capitals; then Yours
 * and Theirs, the rows of a radio group, each a whole 32px target (44 on a
 * coarse pointer) whose chosen row is the active control's `--brand-tint`
 * with `--brand-dd` text; then, under Theirs, where the newer value came from
 * and what both began from in mono `--ink-4`. Once every one is chosen, each
 * card folds to a line saying how, which opens it again. The radio inputs are
 * the browser's own, hidden: the row shows their state, and their focus.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const editConflictsSlotRecipe = defineSlotRecipe({
    className: "elara-edit-conflicts",
    slots: ["intro", "notice", "card", "head", "mark", "item", "goTo", "label", "choices", "choice", "radio", "choiceName", "choiceValue", "context", "was", "line"],
    base: {
        intro: {
            paddingX: "14px",
            paddingY: "10px",
            textStyle: "body.sm",
            color: "fg.muted",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            // Every one chosen: the check leads the line, in the ink.
            "&[data-done]": { display: "flex", alignItems: "center", gap: "{spacing.2}", color: "fg", "& svg": { color: "status.pos", flex: "none" } },
        },
        // Why the choices are off, or that the newest data is being read.
        notice: {
            paddingX: "14px",
            paddingY: "8px",
            textStyle: "body.sm",
            color: "fg.warning",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        card: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.1.5}",
            paddingX: "14px",
            paddingY: "12px",
            "& + &": { borderTopWidth: "1px", borderTopColor: "border.subtle" },
        },
        head: { display: "flex", alignItems: "center", gap: "{spacing.2}", minWidth: "0" },
        mark: {
            flex: "none",
            width: "12px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "11px",
            color: "status.pos",
            "&:not([data-chosen])::before": { content: '""', width: "8px", height: "8px", borderRadius: "full", background: "status.warn" },
        },
        item: { flex: "1", minWidth: "0", fontSize: "13px", fontWeight: "medium", color: "fg", overflowWrap: "anywhere" },
        goTo: {
            flex: "none",
            textStyle: "body.sm",
            color: "link",
            cursor: "pointer",
            background: "transparent",
            borderWidth: "0",
            padding: "0",
            borderRadius: "{radii.xs}",
            _hover: { textDecoration: "underline", textUnderlineOffset: "2px" },
            _focusVisible: { outline: "none", boxShadow: "{shadows.focus}" },
        },
        label: { textStyle: "caption.eyebrow", color: "fg.subtle", paddingLeft: "20px", overflowWrap: "anywhere" },
        choices: { display: "flex", flexDirection: "column", gap: "2px" },
        choice: {
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: "{spacing.3}",
            minHeight: "32px",
            paddingX: "{spacing.2}",
            borderRadius: "{radii.sm}",
            cursor: "pointer",
            color: "fg",
            _coarse: { minHeight: "44px" },
            _hover: { background: "bg.subtle" },
            "&[data-checked]": { background: "brandTint", color: "brandPressed" },
            "&:has(input:focus-visible)": { boxShadow: "{shadows.focus}" },
            "&[data-disabled]": { cursor: "not-allowed", opacity: 0.5, _hover: { background: "transparent" } },
            "&[data-checked][data-disabled]": { _hover: { background: "brandTint" } },
        },
        radio: {
            position: "absolute",
            width: "1px",
            height: "1px",
            padding: "0",
            margin: "-1px",
            overflow: "hidden",
            clipPath: "inset(50%)",
            whiteSpace: "nowrap",
            borderWidth: "0",
        },
        choiceName: { flex: "none", width: "56px", textStyle: "body.sm", color: "fg.muted", "[data-checked] > &": { color: "inherit" } },
        choiceValue: { flex: "1", minWidth: "0", fontSize: "13px", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" },
        context: { paddingLeft: "{spacing.2}", textStyle: "body.sm", color: "fg.subtle", overflowWrap: "anywhere" },
        was: { fontFamily: "mono", fontSize: "{fontSizes.label.lg}", color: "fg.subtle" },
        // A chosen conflict, folded: how it is chosen, which opens its card again.
        line: {
            textAlign: "start",
            textStyle: "body.sm",
            color: "fg.muted",
            background: "transparent",
            borderWidth: "0",
            padding: "0",
            paddingLeft: "20px",
            cursor: "pointer",
            borderRadius: "{radii.xs}",
            overflowWrap: "anywhere",
            _hover: { color: "fg" },
            _focusVisible: { outline: "none", boxShadow: "{shadows.focus}" },
        },
    },
});
