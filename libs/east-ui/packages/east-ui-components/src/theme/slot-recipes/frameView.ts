/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A phone's view of a toolbar's popover (`slice/edit/`, ruled 3 Nov 2026):
 * what `SliceEditPopover` opens in a phone's frame — the date navigator's
 * View, a builder's View bundle, a chip's editor — over the whole builder,
 * as the Filters view is:
 *
 *   - root: the frame's overlay slot's whole box, `--paper`, sliding in from
 *     the right over `--dur-base` on `--ease-out` (at once under reduced
 *     motion);
 *   - head: 44 over a `--rule`, padded 0 8 0 0 — ← back 44 (its arrow 16 in
 *     `--ink-3`), the title DM Sans 16/700 at −0.01em;
 *   - body: what the popover holds, padded 12 16, scrolling;
 *   - foot: its actions, padded 12 16 (and the safe area), over a
 *     `--rule-strong`, 8 apart at its end.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const frameViewSlotRecipe = defineSlotRecipe({
    className: "elara-frame-view",
    slots: ["hold", "root", "head", "back", "title", "body", "foot", "footActions"],
    base: {
        /* What holds the trigger: no box of its own. */
        hold: { display: "contents" },
        root: {
            position: "absolute", inset: "0", pointerEvents: "auto",
            display: "flex", flexDirection: "column", boxSizing: "border-box", background: "bg.surface",
            animationName: "slide-from-right-full", animationDuration: "normal", animationTimingFunction: "{easings.out}",
            _motionReduce: { animation: "none" },
        },
        head: {
            height: "44px", flex: "none", display: "flex", alignItems: "center", gap: "8px", paddingInlineEnd: "8px", boxSizing: "border-box",
            borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
        },
        back: {
            width: "44px", height: "44px", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: "0", border: "none", background: "transparent", color: "fg.muted", cursor: "pointer", "& svg": { fontSize: "16px" },
            _hover: { color: "fg" },
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        title: {
            flex: "1", minWidth: "0", fontFamily: "heading", fontSize: "title.sm", fontWeight: 700, letterSpacing: "-0.01em", lineHeight: "1.4",
            color: "fg", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        },
        body: {
            flex: "1", minHeight: "0", overflowY: "auto", scrollbarWidth: "none",
            display: "flex", flexDirection: "column", gap: "12px", paddingY: "12px", paddingX: "16px",
            /* Its controls at touch size: every field and button 44 tall. */
            "& input, & button:not([role=checkbox]):not([role=radio])": { minHeight: "44px" },
            /* Its segment strips across the view, each segment an equal 44 target. */
            "& [data-slot=seg]": { display: "flex", width: "100%", height: "auto", "& > [role=radio]": { flex: "1 1 0", minHeight: "44px", justifyContent: "center" } },
        },
        foot: {
            flex: "none", display: "flex", alignItems: "center", gap: "8px", boxSizing: "border-box",
            paddingTop: "12px", paddingX: "16px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
            background: "bg.surface", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.strong",
            "& button": { minHeight: "44px" },
        },
        footActions: { marginInlineStart: "auto", display: "flex", alignItems: "center", gap: "8px" },
    },
});
