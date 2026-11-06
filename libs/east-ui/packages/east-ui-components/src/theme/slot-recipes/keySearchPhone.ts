/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A phone's Search Records view (`collections/key-search/`; `Mobile Filters
 * Spec.md` SL10), as the designer's `FiltersPhone` draws it, over the whole
 * builder as the Filters view is (ruled 3 Nov 2026):
 *
 *   - root: the frame's overlay slot's whole box, `--paper`, sliding in from
 *     the right over `--dur-base` on `--ease-out` (at once under reduced
 *     motion);
 *   - head: the field row, 44 over a `--rule` — the magnifier 14 in `--ink-4`
 *     in a 36 column, the input mono 13 in ink, Cancel 12.5/500 in
 *     `--brand-d` padded 0 12;
 *   - eyebrow: padded 8 16 4, mono 10/600 caps at 0.14em in `--ink-4`;
 *   - row: one a match, 44 at least, padded 0 16, 8 apart, a `--rule` above —
 *     its key mono 13/500 in ink, its note mono 10.5 in `--ink-4` beside it, or
 *     under it where it does not fit, wrapped and never cut: the hidden pick's
 *     line is what a pick will clear (hand test, 4 Nov 2026); `--paper-2` under
 *     the pointer;
 *   - hint: padded 8 16 12, mono 10.5 in `--ink-4`.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const keySearchPhoneSlotRecipe = defineSlotRecipe({
    className: "elara-key-search-phone",
    slots: ["root", "head", "icon", "input", "cancel", "body", "eyebrow", "row", "key", "note", "hint", "step"],
    base: {
        root: {
            position: "absolute", inset: "0", pointerEvents: "auto",
            display: "flex", flexDirection: "column", boxSizing: "border-box", background: "bg.surface",
            animationName: "slide-from-right-full", animationDuration: "normal", animationTimingFunction: "{easings.out}",
            _motionReduce: { animation: "none" },
        },
        head: {
            height: "44px", flex: "none", display: "flex", alignItems: "center", boxSizing: "border-box",
            borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
        },
        icon: { width: "36px", flex: "none", display: "inline-flex", justifyContent: "center", color: "fg.subtle", "& svg": { fontSize: "14px" } },
        input: {
            flex: "1", minWidth: "0", height: "44px", border: "none", outline: "none", padding: "0", background: "transparent",
            fontFamily: "mono", fontSize: "body", color: "fg",
            _placeholder: { color: "fg.subtle" },
            /* The field row is the field: no ring of its own, the caret says where typing goes. */
            _focus: { outline: "none", boxShadow: "none" },
            _focusVisible: { outline: "none", boxShadow: "none" },
        },
        cancel: {
            height: "44px", flex: "none", paddingX: "12px", border: "none", background: "transparent", cursor: "pointer",
            fontFamily: "body", fontSize: "body.sm", fontWeight: 500, color: "brand.solid",
            _hover: { color: "brandPressed" },
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        /* Previous and next match, while a query finds more than one: 44 squares in `--ink-3`. */
        step: {
            width: "44px", height: "44px", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
            border: "none", padding: "0", background: "transparent", color: "fg.muted", cursor: "pointer", "& svg": { fontSize: "12px" },
            _disabled: { color: "fg.faint", cursor: "default" },
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        body: { flex: "1", minHeight: "0", overflowY: "auto", scrollbarWidth: "none" },
        eyebrow: {
            paddingTop: "8px", paddingX: "16px", paddingBottom: "4px",
            fontFamily: "mono", fontSize: "label.sm", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "fg.subtle",
        },
        row: {
            width: "100%", minHeight: "44px", display: "flex", flexWrap: "wrap", alignItems: "center", alignContent: "center", columnGap: "8px", rowGap: "2px", paddingX: "16px", paddingY: "6px", boxSizing: "border-box",
            border: "none", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle",
            background: "transparent", textAlign: "start", cursor: "pointer",
            _hover: { background: "bg.canvas" },
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        key: { flex: "none", maxWidth: "100%", overflowWrap: "anywhere", fontFamily: "mono", fontSize: "body", fontWeight: 500, color: "fg" },
        note: {
            flex: "1 1 auto", minWidth: "0", maxWidth: "100%", overflowWrap: "anywhere", textAlign: "start",
            fontFamily: "mono", fontSize: "label.md", color: "fg.subtle",
        },
        hint: { paddingTop: "8px", paddingX: "16px", paddingBottom: "12px", fontFamily: "mono", fontSize: "label.md", color: "fg.subtle" },
    },
});
