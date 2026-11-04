/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The snap grid's canvas on a phone (`Studio Mobile Spec.md`):
 *
 *   - scroll, head, title (ST8): the page on `--paper-2`, the project's eyebrow
 *     and the page's name scrolling with it, padded 16 16 8;
 *   - row, rowHead (ST9): the rows 16 apart, each under its eyebrow, its tiles
 *     12 apart;
 *   - caption, meter (ST10): 24 over a tile's frame: its name, twelve cells 4 × 8
 *     2 apart, and `N / 12`;
 *   - tile (ST11, ST12): the real component in its frame, taking no touch of its
 *     own, so a tap selects and a drag scrolls; selected, a 2 px `--brand-d`
 *     edge; in conflict, dashed `--warn` (ST37);
 *   - add (ST13): the page's last control, 44, dashed;
 *   - bar* (ST14–ST16): the tile bar under the page, its Move, stepper and Remove
 *     at 44 and its consequence line;
 *   - outline*, slot (ST17–ST19): the page as its outline while placing, 44 rows
 *     and dashed slots;
 *   - placeBar* (ST20): what placing says, and Cancel;
 *   - empty* (ST34), saved (ST36).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** Mono caps, 10/600. */
const EYEBROW = { fontFamily: "mono", fontSize: "label.xs", fontWeight: "600", letterSpacing: "0.14em", textTransform: "uppercase", lineHeight: "1.4" } as const;

/** A Default control at touch size. */
const CONTROL = {
    height: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", boxSizing: "border-box", padding: "0",
    background: "bg.surface", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md", cursor: "pointer",
    fontSize: "body.sm", fontWeight: "600", color: "fg", "& svg": { fontSize: "16px" },
    _disabled: { color: "fg.faint", cursor: "default" },
    _focusVisible: { outline: "none", boxShadow: "focus" },
} as const;

export const snapGridPhoneSlotRecipe = defineSlotRecipe({
    className: "elara-snap-grid-phone",
    slots: ["root", "scroll", "head", "eyebrow", "title", "rows", "row", "rowHead", "tiles", "caption", "captionName", "captionSpan", "captionConflict", "conflictDot", "meter", "cell", "tile", "frame",
        "add", "empty", "emptyGlyph", "emptyTitle", "emptyList",
        "bar", "barHead", "barTitle", "barClose", "barMove", "barControls", "stepper", "stepperButton", "stepperValue", "barRemove", "barLine",
        "outline", "outlineRow", "outlineName", "outlineIcon", "slot",
        "placeBar", "placeHead", "placeTitle", "placeCancel", "placeLine", "placeCount", "saved", "savedCheck",
        "issues", "issuesIntro", "issuesNone", "issue", "issueHead", "issueTitle", "issueLine", "issueKey", "issueValue", "issueActions", "issueAction"],
    base: {
        root: { flex: "1", minWidth: "0", minHeight: "0", display: "flex", flexDirection: "column", background: "bg.canvas" },
        scroll: { flex: "1", minHeight: "0", overflowY: "auto", overflowX: "hidden", background: "bg.canvas" },
        head: { display: "flex", flexDirection: "column", gap: "4px", paddingTop: "16px", paddingX: "16px", paddingBottom: "8px" },
        eyebrow: { ...EYEBROW, color: "fg.subtle" },
        title: { fontFamily: "heading", fontSize: "18px", fontWeight: "700", lineHeight: "1.3", letterSpacing: "-0.01em", color: "fg" },
        rows: { display: "flex", flexDirection: "column", gap: "16px", paddingX: "16px", paddingTop: "8px", paddingBottom: "16px" },
        row: { display: "flex", flexDirection: "column", gap: "8px" },
        rowHead: { ...EYEBROW, color: "fg.subtle", minHeight: "24px", display: "flex", alignItems: "center" },
        tiles: { display: "flex", flexDirection: "column", gap: "12px" },
        caption: { minHeight: "24px", display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" },
        captionName: { flex: "1", minWidth: "0", fontSize: "body.sm", fontWeight: "500", lineHeight: "16px", color: "fg.strong" },
        captionSpan: { flex: "none", fontFamily: "mono", fontSize: "label.md", fontWeight: "500", color: "fg.subtle", whiteSpace: "nowrap" },
        captionConflict: { ...EYEBROW, flex: "none", display: "inline-flex", alignItems: "center", gap: "8px", color: "fg.warning" },
        conflictDot: { width: "8px", height: "8px", borderRadius: "full", background: "status.warn" },
        meter: { flex: "none", display: "inline-flex", gap: "2px" },
        cell: {
            width: "4px", height: "8px", background: "border.subtle",
            "&[data-on]": { background: "fg.subtle", "[data-tile-selected] &": { background: "brand.solid" }, "[data-outline-moving] &": { background: "brand.solid" } },
        },
        /* A tile: its frame first, as the desktop's is; a tap on it is its own. */
        tile: { position: "relative", cursor: "pointer", outline: "none", _focusVisible: { "& > [data-snap-grid-phone-frame]": { boxShadow: "focus" } } },
        frame: {
            display: "flex", flexDirection: "column", overflow: "hidden", boxSizing: "border-box", borderRadius: "10px",
            "& > *": { flex: "1 1 auto", minHeight: "0", pointerEvents: "none" },
            "&[data-frame]": { background: "bg.surface", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong" },
            "[data-selected] > &": { outlineWidth: "2px", outlineStyle: "solid", outlineColor: "brand.solid", outlineOffset: "-1px" },
            "[data-conflict] > &": { borderWidth: "1px", borderStyle: "dashed", borderColor: "status.warn", outline: "none" },
        },
        add: {
            width: "100%", height: "44px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", boxSizing: "border-box",
            background: "transparent", borderWidth: "1px", borderStyle: "dashed", borderColor: "border.strong", borderRadius: "10px", cursor: "pointer",
            ...EYEBROW, fontSize: "label.md", color: "fg.muted", "& svg": { fontSize: "14px" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
        },
        empty: { display: "flex", flexDirection: "column", gap: "8px", paddingX: "4px", paddingTop: "24px", paddingBottom: "16px" },
        emptyGlyph: { fontFamily: "mono", fontSize: "26px", lineHeight: "1.2", color: "border.strong" },
        emptyTitle: { fontFamily: "heading", fontSize: "15px", fontWeight: "700", color: "fg" },
        emptyList: { margin: "0", paddingInlineStart: "16px", listStyle: "disc", display: "flex", flexDirection: "column", gap: "4px", fontSize: "body", lineHeight: "20px", color: "fg.strong" },
        /* The bottom container's tile bar: `--paper` (D11). */
        bar: { "[data-frame-slot=bottomPanel]:has([data-frame-panel]) &": { display: "none" }, flex: "none", display: "flex", flexDirection: "column", gap: "8px", paddingTop: "0", paddingX: "16px", paddingBottom: "12px", background: "bg.surface", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.strong" },
        barHead: { height: "44px", display: "flex", alignItems: "center", gap: "8px", marginInlineEnd: "-12px" },
        barTitle: { ...EYEBROW, flex: "1", minWidth: "0", color: "fg", overflowWrap: "anywhere" },
        barClose: {
            flex: "none", width: "44px", height: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0", border: "none", background: "transparent",
            color: "fg.muted", cursor: "pointer", "& svg": { fontSize: "14px" }, _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        barMove: { ...CONTROL, width: "100%" },
        barControls: { display: "flex", gap: "8px" },
        stepper: { flex: "none", display: "inline-flex", height: "44px", boxSizing: "border-box", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md", background: "bg.surface", overflow: "hidden" },
        stepperButton: {
            flex: "none", width: "42px", height: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0", border: "none", background: "transparent", cursor: "pointer", color: "fg",
            "& svg": { fontSize: "14px" }, _disabled: { color: "fg.faint", cursor: "default" }, _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        stepperValue: {
            minWidth: "64px", paddingX: "8px", boxSizing: "border-box", display: "inline-flex", alignItems: "center", justifyContent: "center",
            borderInlineWidth: "1px", borderInlineStyle: "solid", borderInlineColor: "border.subtle",
            fontFamily: "mono", fontSize: "body", fontWeight: "500", color: "fg", whiteSpace: "nowrap",
            "&[data-dirty]": { background: "brandTint", color: "brandPressed" },
        },
        barRemove: { ...CONTROL, flex: "1", minWidth: "0" },
        barLine: { fontFamily: "mono", fontSize: "label.md", lineHeight: "16px", color: "fg.muted" },
        /* The page as its outline (ST17): 44 rows and dashed slots. */
        outline: { display: "flex", flexDirection: "column", gap: "8px" },
        outlineRow: {
            minHeight: "44px", display: "flex", alignItems: "center", gap: "8px", paddingX: "12px", boxSizing: "border-box", width: "100%", textAlign: "start",
            background: "bg.surface", borderWidth: "1px", borderStyle: "solid", borderColor: "border.subtle", borderRadius: "md",
            "&[data-outline-moving]": { borderColor: "brand.solid", cursor: "pointer" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
        },
        outlineIcon: { flex: "none", width: "16px", display: "inline-flex", justifyContent: "center", fontSize: "14px", color: "fg.muted", "[data-outline-moving] > &": { color: "brand.solid" } },
        outlineName: { flex: "1", minWidth: "0", fontSize: "body", fontWeight: "500", lineHeight: "16px", color: "fg" },
        slot: {
            width: "100%", minHeight: "44px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", paddingX: "12px", boxSizing: "border-box",
            background: "transparent", borderWidth: "1px", borderStyle: "dashed", borderColor: "brand.solid", borderRadius: "md", cursor: "pointer",
            ...EYEBROW, fontSize: "label.md", color: "brand.solid", "& svg": { fontSize: "14px" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
        },
        placeBar: { flex: "none", display: "flex", flexDirection: "column", paddingTop: "0", paddingX: "16px", paddingBottom: "12px", background: "bg.surface", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.strong" },
        placeHead: { height: "44px", display: "flex", alignItems: "center", gap: "8px" },
        placeTitle: { ...EYEBROW, flex: "1", minWidth: "0", color: "fg" },
        placeCancel: { flex: "none", height: "44px", padding: "0", border: "none", background: "transparent", cursor: "pointer", fontSize: "body.sm", fontWeight: "500", color: "brand.solid", _focusVisible: { outline: "none", boxShadow: "focus" } },
        placeLine: { fontSize: "body", lineHeight: "20px", color: "fg.strong" },
        placeCount: { marginTop: "4px", fontFamily: "mono", fontSize: "label.md", lineHeight: "16px", color: "fg.muted" },
        saved: { flex: "none", minHeight: "44px", display: "flex", alignItems: "center", gap: "8px", paddingY: "4px", paddingX: "16px", boxSizing: "border-box", background: "bg.surface", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle", fontSize: "body.sm", lineHeight: "18px", color: "fg.strong" },
        savedCheck: { flex: "none", display: "inline-flex", fontSize: "14px", color: "status.pos" },
        /* A phone's inspector's Issues tab (ST37). */
        issues: { flex: "1", minHeight: "0", overflowY: "auto", display: "flex", flexDirection: "column", background: "bg.surface" },
        issuesIntro: { paddingY: "12px", paddingX: "20px", fontSize: "body", lineHeight: "20px", color: "fg.strong", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle", "&[data-flush]": { padding: "0", border: "none" } },
        issuesNone: { padding: "20px", fontSize: "body", lineHeight: "20px", color: "fg.muted" },
        issue: { display: "flex", flexDirection: "column", gap: "8px", paddingY: "16px", paddingX: "20px", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        issueHead: { ...EYEBROW, display: "flex", alignItems: "center", gap: "8px", color: "fg.warning" },
        issueTitle: { fontFamily: "heading", fontSize: "15px", fontWeight: "700", lineHeight: "20px", color: "fg" },
        issueLine: { display: "grid", gridTemplateColumns: "96px minmax(0, 1fr)", columnGap: "12px", alignItems: "baseline" },
        issueKey: { ...EYEBROW, color: "fg.muted" },
        issueValue: { fontFamily: "mono", fontSize: "body", lineHeight: "20px", color: "fg" },
        issueActions: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px", marginTop: "4px" },
        issueAction: { ...CONTROL, width: "100%", fontWeight: "500" },
    },
});
