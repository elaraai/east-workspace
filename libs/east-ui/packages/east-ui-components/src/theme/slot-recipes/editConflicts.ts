/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Edit conflicts slot recipe — the body of the popover the history bar's
 * conflicts button opens (the bar's own recipe draws the button), as the
 * design's conflicts popover card draws it: an intro in the body face at 13
 * in `--ink-2`; a line with the live dot while the newest data is read, or
 * while choices are off; then one card for each conflict, pad 12, gap 8. A
 * card's head is its mark in a 14 column (the 8px warn dot until it is
 * chosen, then the check at 12 in `--pos`), its item at 13/500 in the ink and
 * Go to at 12.5/500 in the link's ink; under it the part's label, mono
 * 10/600/0.14em in capitals in `--ink-4`; then the choice group — Yours and
 * Theirs, two rows inside a `--rule-strong` edge at `--r-md`, a `--rule`
 * between — each row a whole 32px target (44 on a coarse pointer): its round
 * 14 radio, its key mono 10/600 in capitals in a 56 column, its value as the
 * component shows it (numbers, dates and ids mono 13/500 tabular, text up to
 * two lines, absence in the absent style); the chosen row is the active
 * control's `--brand-tint` with `--brand-dd` text, a row hovered `--paper-2`,
 * a focused one ringed inside. Under the group, where the newer value came
 * from and what both began from in mono 10 `--ink-4`, then Show all where a
 * value reads longer, which opens it in place. Once every one is chosen, each
 * card folds to a line saying how, which opens it again. The radio inputs are
 * the browser's own, hidden: the row and its mark show their state, and their
 * focus.
 *
 * @packageDocumentation
 */
import { defineSlotRecipe } from "@chakra-ui/react";

/** The item's column: the mark's 14 and the head's gap. */
const ITEM_COLUMN = "22px";

export const editConflictsSlotRecipe = defineSlotRecipe({
    className: "elara-edit-conflicts",
    slots: ["headCount", "intro", "notice", "live", "card", "head", "mark", "item", "goTo", "label", "choices", "choice", "radio", "radioMark", "choiceName", "choiceValue", "context", "was", "showAll", "line", "skeleton"],
    base: {
        // The head's count, in the active control's ink.
        headCount: { color: "brandPressed" },
        intro: {
            padding: "12px",
            fontSize: "{fontSizes.body}",
            lineHeight: "{lineHeights.normal}",
            color: "fg.strong",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            // Every one chosen: the check leads the line, in the ink.
            "&[data-done]": { display: "flex", alignItems: "center", gap: "{spacing.2}", color: "fg", "& svg": { color: "status.pos", flex: "none" } },
        },
        // That the newest data is being read, or why the choices are off: the live dot, then the line.
        notice: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "12px",
            paddingY: "8px",
            textStyle: "body.sm",
            color: "fg.muted",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        // The Loading Status's live dot: `--brand`, a 3px ring of it at 18%, its slow pulse the only one.
        live: {
            flex: "none",
            width: "8px",
            height: "8px",
            borderRadius: "full",
            background: "brandMark",
            boxShadow: "0 0 0 3px color-mix(in oklch, {colors.brandMark} 18%, transparent)",
            animation: "spec-pulse-live 2.4s ease-in-out infinite",
            _motionReduce: { animation: "none" },
        },
        card: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
            padding: "12px",
            "& + &": { borderTopWidth: "1px", borderTopColor: "border.subtle" },
        },
        head: { display: "flex", alignItems: "center", gap: "{spacing.2}", minWidth: "0" },
        mark: {
            flex: "none",
            width: "14px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px",
            color: "status.pos",
            "&:not([data-chosen])::before": { content: '""', width: "8px", height: "8px", borderRadius: "full", background: "status.warn" },
        },
        item: { flex: "1", minWidth: "0", fontSize: "13px", fontWeight: "medium", color: "fg", overflowWrap: "anywhere" },
        goTo: {
            flex: "none",
            fontSize: "{fontSizes.body.sm}",
            fontWeight: "medium",
            color: "link",
            cursor: "pointer",
            background: "transparent",
            borderWidth: "0",
            padding: "0",
            borderRadius: "{radii.xs}",
            _hover: { textDecoration: "underline", textUnderlineOffset: "2px" },
            _focusVisible: { outline: "none", boxShadow: "{shadows.focus}" },
        },
        label: { textStyle: "eyebrow", letterSpacing: "label", color: "fg.subtle", paddingLeft: ITEM_COLUMN, overflowWrap: "anywhere" },
        choices: {
            display: "flex",
            flexDirection: "column",
            marginLeft: ITEM_COLUMN,
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.md}",
            overflow: "hidden",
        },
        choice: {
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            minHeight: "32px",
            paddingX: "{spacing.2}",
            cursor: "pointer",
            color: "fg",
            background: "bg.surface",
            _coarse: { minHeight: "44px" },
            "& + &": { borderTopWidth: "1px", borderTopColor: "border.subtle" },
            _hover: { background: "bg.canvas" },
            "&[data-checked]": { background: "brandTint", color: "brandPressed" },
            "&:has(input:focus-visible)": { outline: "2px solid {colors.border.focus}", outlineOffset: "-2px" },
            // Off while a run of the optimiser is out: its place and its focus kept, its value still read in `--ink-3`.
            "&[data-disabled]": { cursor: "not-allowed", color: "fg.muted", _hover: { background: "bg.surface" } },
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
        // The Checkbox's 14 box made round: chosen, `--brand-d` with a 6 `--paper` centre; off, a `--rule` edge.
        radioMark: {
            flex: "none",
            width: "14px",
            height: "14px",
            borderRadius: "full",
            borderWidth: "1px",
            borderColor: "border.strong",
            background: "bg.surface",
            "[data-checked] > &": { borderColor: "link", boxShadow: "inset 0 0 0 3px {colors.link}" },
            "[data-disabled] > &": { borderColor: "border.subtle" },
        },
        choiceName: { flex: "none", width: "56px", textStyle: "eyebrow", "[data-checked] > &": { color: "inherit" } },
        choiceValue: {
            flex: "1",
            minWidth: "0",
            fontSize: "13px",
            overflowWrap: "anywhere",
            // Text reads two lines, then Show all opens the rest.
            "&[data-form=text]:not([data-open])": { lineClamp: "2" },
            "&[data-form=mono]": { fontFamily: "mono", fontWeight: "medium", fontVariantNumeric: "tabular-nums" },
            "&[data-form=absent]": { textStyle: "absent" },
            // The words that differ, marked in each version where it is open.
            "& mark": { background: "transparent", color: "inherit", fontWeight: "semibold", textDecoration: "underline", textDecorationColor: "status.warn", textUnderlineOffset: "3px" },
        },
        context: { marginLeft: ITEM_COLUMN, fontFamily: "mono", fontSize: "{fontSizes.label.sm}", lineHeight: "{lineHeights.normal}", color: "fg.subtle", overflowWrap: "anywhere" },
        was: {},
        showAll: {
            alignSelf: "flex-start",
            marginLeft: ITEM_COLUMN,
            fontSize: "{fontSizes.body.sm}",
            fontWeight: "medium",
            color: "link",
            cursor: "pointer",
            background: "transparent",
            borderWidth: "0",
            padding: "0",
            borderRadius: "{radii.xs}",
            _hover: { textDecoration: "underline", textUnderlineOffset: "2px" },
            _focusVisible: { outline: "none", boxShadow: "{shadows.focus}" },
        },
        // A chosen conflict, folded: how it is chosen, which opens its card again.
        line: {
            textAlign: "start",
            textStyle: "body.sm",
            color: "fg.muted",
            background: "transparent",
            borderWidth: "0",
            padding: "0",
            paddingLeft: ITEM_COLUMN,
            cursor: "pointer",
            borderRadius: "{radii.xs}",
            overflowWrap: "anywhere",
            _hover: { color: "fg" },
            _focusVisible: { outline: "none", boxShadow: "{shadows.focus}" },
        },
        // A card while the newest data is read: the Skeleton's static `--paper-3` shapes in the card's final layout.
        skeleton: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
            padding: "12px",
            "& + &": { borderTopWidth: "1px", borderTopColor: "border.subtle" },
            "& > span": { display: "block", height: "10px", borderRadius: "{radii.xs}", background: "bg.subtle" },
            "& > span:nth-of-type(1)": { width: "60%" },
            "& > span:nth-of-type(2)": { width: "35%", marginLeft: ITEM_COLUMN },
            "& > span:nth-of-type(3)": { height: "64px", marginLeft: ITEM_COLUMN, borderRadius: "{radii.md}" },
            // Shown only once the read has taken `--dur-base`.
            animationName: "banner-in",
            animationDuration: "0s",
            animationDelay: "{durations.normal}",
            animationFillMode: "both",
        },
    },
});
