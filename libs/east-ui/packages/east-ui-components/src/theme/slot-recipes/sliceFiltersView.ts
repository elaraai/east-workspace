/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A phone's Filters view (`src/slice/rail/filters-view.tsx`; `Mobile Filters
 * Spec.md` SL3–SL9), as the designer's `FiltersPhone` draws it:
 *
 *   - root: the frame's overlay slot's whole box; panel: all of it, edge to
 *     edge (ruled 3 Nov 2026, in place of the designer's 48px strip),
 *     `--paper`, sliding in from the right over `--dur-base` on `--ease-out`
 *     (at once under reduced motion);
 *   - head: 44 over a `--rule`, padded 0 8 0 0, 8 apart — ← back 44 (its arrow
 *     16 in `--ink-3`), `Filters` DM Sans 16/700 at −0.01em, the active count
 *     mono 10.5 in `--ink-4`, Done a Default 36 (padded 0 12, 12.5/500);
 *   - presets: at least 52, padded 0 16, over a `--rule`, its label in a 72px
 *     column (mono 10/600 caps at 0.14em, `--ink-4`), then its chips;
 *   - row: one 44 a field, padded 0 16, 8 apart, over a `--rule` — its name
 *     13/500 in a 72px column, its choice 13 right-aligned (`Any` in
 *     `--ink-4`), `Applied` (20 tall, padded 0 8, a `--rule` on `--r-sm`,
 *     `--paper-3`, mono 10/500 in `--ink-3`) and a chevron 10 in `--ink-4`;
 *   - editor: the open field's, under its row on `--paper-2` over a `--rule`,
 *     its controls 44 tall;
 *   - foot: padded 12 16 (and the safe area), 8 apart, over a
 *     `--rule-strong` — the count mono 11 in `--ink-3`, its number 600 in
 *     ink — then Clear all and Done, 44 each, side by side, Default buttons,
 *     Done 600.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** A Default button: `--rule-strong` on `--r-md`, the paper, 12.5/500 in ink; `--paper-2` under the pointer. */
const DEFAULT_BUTTON = {
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "border.strong",
    borderRadius: "md",
    background: "bg.surface",
    fontFamily: "body",
    fontSize: "body.sm",
    fontWeight: 500,
    color: "fg",
    cursor: "pointer",
    _hover: { background: "bg.canvas" },
    _focusVisible: { outline: "2px solid {colors.brand.solid}", outlineOffset: "2px" },
    _disabled: { color: "fg.faint", borderColor: "border.subtle", cursor: "default", _hover: { background: "bg.surface" } },
} as const;

/** A label in the mono caps of a 72px column. */
const COLUMN = { width: "72px", flex: "none" } as const;

export const sliceFiltersViewSlotRecipe = defineSlotRecipe({
    className: "elara-slice-filters-view",
    slots: [
        "root", "panel", "head", "back", "title", "active", "headDone", "body",
        "presets", "presetsLabel", "presetsChips", "group", "groupIcon", "groupLabel", "groupCount",
        "row", "rowLabel", "rowChoice", "applied", "chevron", "editor", "foot", "count", "actions", "action",
        "choices", "choice", "choiceBox", "choiceText", "choiceLabel", "choiceHint", "choiceCount", "choiceError",
    ],
    base: {
        root: { position: "absolute", inset: "0", pointerEvents: "auto" },
        panel: {
            position: "absolute", inset: "0",
            display: "flex", flexDirection: "column", boxSizing: "border-box",
            background: "bg.surface",
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
        title: { fontFamily: "heading", fontSize: "title.sm", fontWeight: 700, letterSpacing: "-0.01em", color: "fg", lineHeight: "1.4" },
        active: { flex: "1", minWidth: "0", fontFamily: "mono", fontSize: "label.md", lineHeight: "1.4", color: "fg.subtle", whiteSpace: "nowrap" },
        headDone: { ...DEFAULT_BUTTON, height: "36px", paddingX: "12px" },
        body: { flex: "1", minHeight: "0", overflowY: "auto", scrollbarWidth: "none" },
        presets: {
            minHeight: "52px", display: "flex", alignItems: "center", gap: "8px", paddingX: "16px", boxSizing: "border-box",
            borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
        },
        presetsLabel: {
            ...COLUMN, fontFamily: "mono", fontSize: "label.sm", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "fg.subtle",
        },
        presetsChips: {
            flex: "1", minWidth: "0", paddingY: "8px",
            /* Its chips 34 tall, mono 11/500. */
            "& button": { minHeight: "34px", fontFamily: "mono", fontSize: "label.lg", fontWeight: 500 },
        },
        group: {
            display: "flex", alignItems: "center", gap: "8px", minHeight: "36px", paddingX: "16px", boxSizing: "border-box",
            background: "bg.canvas", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
            fontFamily: "mono", fontSize: "label.sm", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "fg.subtle",
        },
        groupIcon: { display: "inline-flex", fontSize: "12px" },
        groupLabel: { flex: "1", minWidth: "0" },
        groupCount: { flex: "none", letterSpacing: "0", textTransform: "none", fontWeight: 500 },
        row: {
            width: "100%", height: "44px", display: "flex", alignItems: "center", gap: "8px", paddingX: "16px", boxSizing: "border-box",
            border: "none", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
            background: "bg.surface", color: "fg", textAlign: "start", cursor: "pointer",
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        rowLabel: { ...COLUMN, fontSize: "body", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
        rowChoice: {
            flex: "1", minWidth: "0", textAlign: "end", fontSize: "body", color: "fg",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            "&[data-any]": { color: "fg.subtle" },
        },
        applied: {
            height: "20px", flex: "none", display: "inline-flex", alignItems: "center", paddingX: "8px", boxSizing: "border-box",
            borderWidth: "1px", borderStyle: "solid", borderColor: "border.subtle", borderRadius: "sm", background: "bg.subtle",
            fontFamily: "mono", fontSize: "label.sm", fontWeight: 500, color: "fg.muted",
        },
        chevron: { width: "12px", flex: "none", display: "inline-flex", justifyContent: "center", fontSize: "10px", color: "fg.subtle" },
        editor: {
            display: "grid", gap: "8px", padding: "12px 16px",
            background: "bg.canvas", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
            /* Its controls at touch size (SL9.7): every field and button 44 tall. */
            "& input, & button:not([role=checkbox]):not([role=radio])": { minHeight: "44px" },
            /* A field of values: its rows from edge to edge, then its Clear, a brand link in line with their labels. */
            "&:has([data-slice-choice-rows])": {
                padding: "0",
                "& [data-record-slice-editor]": { gap: "0" },
                "& [data-slice-field-actions]": { padding: "0", margin: "0" },
                "& [data-slice-field-actions] button": {
                    height: "44px", paddingInlineStart: "42px", paddingInlineEnd: "16px", background: "transparent",
                    fontFamily: "body", fontSize: "body.sm", fontWeight: 500, color: "brand.solid",
                    "& svg": { display: "none" },
                    _hover: { background: "transparent", color: "brandPressed" },
                },
            },
        },
        /* A field's values (SL7): one 44 row each, padded 6 16, 12 apart; `--paper-3` under the pointer. */
        choices: { display: "flex", flexDirection: "column" },
        choice: {
            width: "100%", minHeight: "44px", display: "flex", alignItems: "center", gap: "12px", padding: "6px 16px", boxSizing: "border-box",
            border: "none", background: "transparent", color: "fg", textAlign: "start", cursor: "pointer",
            _hover: { background: "bg.subtle" },
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
            _disabled: { cursor: "default", _hover: { background: "transparent" } },
        },
        /* Its checkbox: 14 on a 3px radius, `--rule-strong` on the paper; checked, `--brand-d` with the paper's tick. */
        choiceBox: {
            width: "14px", height: "14px", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box",
            borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "3px", background: "bg.surface",
            color: "bg.surface", fontSize: "9px",
            "[aria-checked=true] > &": { borderColor: "brand.solid", background: "brand.solid" },
        },
        choiceText: { flex: "1", minWidth: "0", display: "grid", gap: "2px" },
        /* Its label 13; one that cannot be picked in `--ink-5` (SL9.4). */
        choiceLabel: { fontSize: "body", "[disabled] &": { color: "fg.faint" } },
        /* What picking it does, or what to choose first (SL9.3, SL9.4): mono 10.5 in `--ink-3`, `--ink-4` while it cannot be picked. */
        choiceHint: { fontFamily: "mono", fontSize: "label.md", color: "fg.muted", "[disabled] &": { color: "fg.subtle" } },
        /* Its count: mono 13/500 tabular in `--ink-2`. */
        choiceCount: { flex: "none", fontFamily: "mono", fontVariantNumeric: "tabular-nums", fontSize: "body", fontWeight: 500, color: "fg.strong" },
        choiceError: { paddingX: "16px" },
        foot: {
            flex: "none", display: "grid", gap: "8px", boxSizing: "border-box",
            paddingTop: "12px", paddingX: "16px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
            background: "bg.surface", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.strong",
        },
        count: { fontFamily: "mono", fontSize: "label.lg", fontVariantNumeric: "tabular-nums", color: "fg.muted", minHeight: "16px" },
        actions: { display: "flex", gap: "8px" },
        action: { ...DEFAULT_BUTTON, flex: "1", height: "44px", "&[data-primary]": { fontWeight: 600 } },
    },
});
