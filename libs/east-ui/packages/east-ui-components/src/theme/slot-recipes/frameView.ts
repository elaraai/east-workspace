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
 * And what a phone's main or pane opens instead, in a frame that takes it
 * (`Mobile Builder Frame Spec.md` FR9): the bottom panel, the Sheet's bottom
 * container (`sheetAction`'s `bar`, `Mobile Sheet Spec.md` SH9) —
 *
 *   - panel: `--paper-2`, a `--rule-strong` above, padded 0 16 12 (and the safe
 *     area), its parts 8 apart;
 *   - panelHead: 44 — the label in mono caps, ⌄ close 44 at its end, 12 into the
 *     padding, its chevron 14 in `--ink-3`;
 *   - panelBody: what the popover holds, scrolling while head and foot stay, at
 *     touch size; a list (`data-flush`) edge to edge;
 *   - panelFoot: its actions, 44 tall, 8 apart at its end.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const frameViewSlotRecipe = defineSlotRecipe({
    className: "elara-frame-view",
    slots: ["hold", "root", "head", "back", "title", "body", "foot", "footActions", "panel", "panelHead", "panelTitle", "panelClose", "panelBody", "panelFoot"],
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
            minHeight: "44px", flex: "none", display: "flex", alignItems: "center", gap: "8px", paddingInlineEnd: "8px", boxSizing: "border-box",
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
            color: "fg",
        },
        body: {
            flex: "1", minHeight: "0", overflowY: "auto", scrollbarWidth: "none",
            display: "flex", flexDirection: "column", gap: "12px", paddingY: "12px", paddingX: "16px",
            /* Its controls at touch size: every field and button 44 tall, but a number's two steppers, which share its field's height. */
            "& input, & button:not([role=checkbox]):not([role=radio]):not([data-scope=number-input])": { minHeight: "44px" },
            /* Its segment strips across the view, each segment an equal 44 target. */
            "& [data-slot=seg]": { display: "flex", width: "100%", height: "auto", "& > [role=radio]": { flex: "1 1 0", minHeight: "44px", justifyContent: "center" } },
        },
        foot: {
            flex: "none", display: "flex", alignItems: "center", gap: "8px", boxSizing: "border-box",
            paddingTop: "12px", paddingX: "16px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
            background: "bg.surface", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.strong",
            "& button": { minHeight: "44px", fontSize: "body.sm" },
        },
        footActions: {
            marginInlineStart: "auto", display: "flex", alignItems: "center", gap: "8px",
            /* A view's foot: its actions equal halves across it. */
            "[data-frame-view] &": { flex: "1", "& > button": { flex: "1 1 0" } },
        },
        panel: {
            flex: "0 1 auto", minHeight: "0", display: "flex", flexDirection: "column", gap: "8px", boxSizing: "border-box",
            paddingTop: "0", paddingX: "16px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
            background: "bg.canvas", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.strong",
        },
        panelHead: { flex: "none", height: "44px", display: "flex", alignItems: "center", gap: "8px", marginInlineEnd: "-12px" },
        panelTitle: {
            flex: "1", minWidth: "0", fontFamily: "mono", fontSize: "label.sm", fontWeight: 600, lineHeight: "1.4", letterSpacing: "0.14em", textTransform: "uppercase",
            color: "fg", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        },
        panelClose: {
            flex: "none", width: "44px", height: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center",
            border: "none", padding: "0", borderRadius: "md", background: "transparent", color: "fg.muted", cursor: "pointer", "& svg": { fontSize: "14px" },
            _hover: { background: "bg.subtle", color: "fg" },
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        panelBody: {
            flex: "0 1 auto", minHeight: "0", overflowY: "auto", scrollbarWidth: "none", display: "flex", flexDirection: "column", gap: "12px",
            "& input, & button:not([role=checkbox]):not([role=radio]):not([data-scope=number-input])": { minHeight: "44px" },
            "& [data-slot=seg]": { display: "flex", width: "100%", height: "auto", "& > [role=radio]": { flex: "1 1 0", minHeight: "44px", justifyContent: "center" } },
            "&[data-flush]": { gap: "0", marginX: "-16px", marginTop: "-8px" },
            /* A select on the field's paper, as the dates and numbers beside it are, the panel being `--paper-2`. */
            "& [data-scope=select][data-part=trigger]": { background: "bg.surface" },
        },
        panelFoot: { flex: "none", display: "flex", alignItems: "center", gap: "8px", "& button": { minHeight: "44px" } },
    },
});
