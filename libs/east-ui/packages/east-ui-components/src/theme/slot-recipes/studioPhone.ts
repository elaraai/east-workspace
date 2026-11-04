/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio's own parts on a phone (`Studio Mobile Spec.md`):
 *
 *   - bar, status, target, box, more (ST1–ST3): the first row, 44 — the status
 *     in mono caps, each button a 32 box in a 44 target, 8 apart, ⋯ a 44 ghost;
 *   - intro (ST22, ST23): a pane's first line;
 *   - field*, heights, height* (ST24, ST25): the inspector's layout at touch size;
 *   - inspectorEmpty*, meta (ST24, ST26);
 *   - preview* (ST30–ST33): the publish preview in the builder's place.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** Mono caps. */
const CAPS = { fontFamily: "mono", fontWeight: "600", textTransform: "uppercase" } as const;

/** A 32 box drawn inside a 44 target: the target has no box of its own. */
const TARGET = {
    flex: "none", height: "44px", display: "inline-flex", alignItems: "center", padding: "0", border: "none", background: "transparent", cursor: "pointer", color: "inherit",
    _focusVisible: { outline: "none", "& > *": { boxShadow: "focus" } },
    _disabled: { cursor: "default" },
} as const;

/** A Default control at touch size. */
const CONTROL = {
    height: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", boxSizing: "border-box", paddingX: "12px",
    background: "bg.surface", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md", cursor: "pointer",
    fontSize: "body.sm", fontWeight: "500", color: "fg", _focusVisible: { outline: "none", boxShadow: "focus" },
} as const;

export const studioPhoneSlotRecipe = defineSlotRecipe({
    className: "elara-studio-phone",
    slots: ["bar", "status", "statusDot", "target", "box", "more", "paneBody", "intro",
        "meta", "layoutRows", "layoutRow", "layoutLabel", "readout", "rowControl", "rowValue", "move", "heightTrigger", "heights", "heightRow", "alignSeg", "alignItem", "inspectorEmpty", "inspectorEmptyGlyph", "inspectorEmptyTitle", "inspectorEmptyList",
        "preview", "previewHead", "previewBack", "previewTitle", "previewSub", "previewTabs", "previewTab", "previewBody", "devices", "device", "pageHead", "pageEyebrow", "pageTitle", "pageBody",
        "wireCaption", "wire", "wireRow", "wireTile", "wireName", "wireSpan", "wireFree",
        "changesHead", "changes", "change", "changeSign", "changeText", "changeLine", "changeDetail", "facts", "fact", "factLabel", "factValue", "refusal",
        "foot", "footLine", "footButtons", "footButton"],
    base: {
        bar: {
            flex: "1", minWidth: "0", height: "44px", display: "flex", alignItems: "center", gap: "8px", paddingInlineStart: "16px", paddingInlineEnd: "12px", boxSizing: "border-box",
            "&[data-ends-more]": { paddingInlineEnd: "4px" },
        },
        status: { ...CAPS, marginInlineEnd: "auto", display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "label.lg", letterSpacing: "0.16em", color: "fg.muted", whiteSpace: "nowrap" },
        statusDot: {
            flex: "none", width: "8px", height: "8px", borderRadius: "full", boxSizing: "border-box", borderWidth: "1px", borderStyle: "solid", borderColor: "fg.faint",
            "&[data-tone=success]": { background: "status.pos", borderColor: "status.pos" },
            "&[data-tone=warning]": { background: "status.warn", borderColor: "status.warn" },
        },
        target: TARGET,
        box: {
            height: "32px", display: "inline-flex", alignItems: "center", paddingX: "12px", boxSizing: "border-box", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md",
            background: "bg.surface", fontSize: "body.sm", fontWeight: "500", color: "fg", whiteSpace: "nowrap",
            "button:disabled > &": { color: "fg.faint", borderColor: "border.subtle" },
            "[aria-expanded=true] > &": { background: "bg.subtle" },
        },
        more: {
            flex: "none", width: "44px", height: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0", border: "none", background: "transparent", borderRadius: "md", cursor: "pointer", color: "fg.muted",
            "& svg": { fontSize: "16px" }, "&[aria-expanded=true]": { background: "bg.subtle" }, _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        paneBody: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column" },
        intro: { flex: "none", paddingY: "12px", paddingX: "20px", fontSize: "body", lineHeight: "20px", color: "fg.strong", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        meta: { fontFamily: "mono", fontSize: "label.md", lineHeight: "16px", color: "fg.subtle" },
        layoutRows: { display: "flex", flexDirection: "column" },
        layoutRow: { minHeight: "52px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", paddingY: "4px" },
        layoutLabel: { fontSize: "body", color: "fg" },
        rowControl: { display: "inline-flex", alignItems: "center", gap: "12px" },
        rowValue: { fontFamily: "mono", fontSize: "body", fontWeight: "500", color: "fg", whiteSpace: "nowrap" },
        move: { ...CONTROL, "& svg": { fontSize: "14px" } },
        heightTrigger: {
            ...CONTROL, minWidth: "132px", justifyContent: "space-between", fontFamily: "mono", fontSize: "body", fontWeight: "500",
            "& svg": { fontSize: "12px", color: "fg.muted" },
        },
        heights: { display: "flex", flexDirection: "column", marginX: "-16px", marginY: "-12px" },
        heightRow: {
            width: "100%", minHeight: "44px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", paddingX: "16px", border: "none", background: "transparent", cursor: "pointer",
            fontFamily: "mono", fontSize: "body", fontWeight: "500", color: "fg", textAlign: "start",
            borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
            "& svg": { fontSize: "14px", color: "brand.solid" }, _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        alignSeg: { display: "inline-flex", height: "44px", boxSizing: "border-box", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md", overflow: "hidden" },
        alignItem: {
            width: "48px", height: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0", border: "none", background: "bg.surface", cursor: "pointer", color: "fg.muted",
            "& + &": { borderInlineStartWidth: "1px", borderInlineStartStyle: "solid", borderInlineStartColor: "border.strong" },
            "&[data-state=on]": { background: "brandTint", color: "brandPressed" },
            "& svg": { fontSize: "14px" }, _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        inspectorEmpty: { display: "flex", flexDirection: "column", gap: "8px", padding: "20px" },
        /* Its empty square, drawn: never a text glyph (#1263). */
        inspectorEmptyGlyph: { display: "block", flex: "none", width: "20px", height: "20px", boxSizing: "border-box", borderWidth: "1.5px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "2px" },
        inspectorEmptyTitle: { fontFamily: "heading", fontSize: "15px", fontWeight: "700", color: "fg" },
        inspectorEmptyList: { margin: "0", paddingInlineStart: "16px", listStyle: "disc", display: "flex", flexDirection: "column", gap: "4px", fontSize: "body", lineHeight: "20px", color: "fg.strong" },
        /* The preview, in the builder's place. */
        preview: { flex: "1", minHeight: "0", height: "100%", display: "flex", flexDirection: "column", background: "bg.surface", overflow: "hidden" },
        previewHead: { flex: "none", height: "44px", display: "flex", alignItems: "center", gap: "8px", paddingInlineEnd: "16px", boxSizing: "border-box", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        previewBack: { flex: "none", width: "44px", height: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0", border: "none", background: "transparent", color: "fg.muted", cursor: "pointer", "& svg": { fontSize: "16px" }, _focusVisible: { outline: "none", boxShadow: "focusInset" } },
        previewTitle: { flex: "none", fontFamily: "heading", fontSize: "title.sm", fontWeight: "700", letterSpacing: "-0.01em", color: "fg" },
        previewSub: { flex: "1", minWidth: "0", fontFamily: "mono", fontSize: "label.md", color: "fg.subtle", whiteSpace: "nowrap", overflow: "hidden" },
        previewTabs: { flex: "none", height: "44px", display: "flex", gap: "20px", paddingX: "20px", boxSizing: "border-box", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        previewTab: {
            ...CAPS, position: "relative", height: "100%", padding: "0", border: "none", background: "transparent", cursor: "pointer", fontSize: "label.lg", letterSpacing: "0.16em", color: "fg.subtle", whiteSpace: "nowrap",
            "&[aria-selected=true]": { color: "fg", boxShadow: "inset 0 -2px 0 0 {colors.fg}" }, _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        previewBody: { flex: "1", minHeight: "0", overflowY: "auto", overflowX: "hidden", background: "bg.canvas", "&[data-tab=changes]": { background: "bg.surface" } },
        devices: { position: "sticky", top: "0", zIndex: "1", display: "flex", padding: "8px 16px", background: "bg.surface", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        device: {
            ...CAPS, flex: "1 1 0", minWidth: "0", height: "44px", border: "1px solid {colors.border.strong}", background: "bg.surface", cursor: "pointer", fontSize: "label.md", letterSpacing: "0.16em", color: "fg.muted",
            "& + &": { borderInlineStartWidth: "0" }, "&:first-of-type": { borderStartRadius: "md" }, "&:last-of-type": { borderEndRadius: "md" },
            "&[data-state=on]": { background: "brandTint", color: "brandPressed" }, _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        pageHead: { display: "flex", flexDirection: "column", gap: "4px", paddingTop: "16px", paddingX: "16px", paddingBottom: "8px" },
        pageEyebrow: { ...CAPS, fontSize: "label.xs", letterSpacing: "0.14em", color: "fg.subtle" },
        pageTitle: { fontFamily: "heading", fontSize: "18px", fontWeight: "700", lineHeight: "1.3", letterSpacing: "-0.01em", color: "fg" },
        pageBody: { paddingX: "16px", paddingBottom: "16px" },
        wireCaption: { paddingBottom: "8px", fontFamily: "mono", fontSize: "label.md", lineHeight: "16px", color: "fg.muted" },
        wire: { display: "flex", flexDirection: "column", gap: "4px", padding: "8px", background: "bg.surface", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "10px" },
        wireRow: { display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", columnGap: "4px" },
        wireTile: { minWidth: "0", minHeight: "56px", display: "flex", flexDirection: "column", gap: "4px", padding: "8px", boxSizing: "border-box", overflow: "hidden", background: "bg.canvas", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md" },
        wireName: { fontSize: "body.sm", lineHeight: "16px", color: "fg", whiteSpace: "nowrap", overflow: "hidden", "&[data-unfit]": { visibility: "hidden" } },
        wireSpan: { fontFamily: "mono", fontSize: "label.md", color: "fg.subtle" },
        wireFree: { minWidth: "0", borderWidth: "1px", borderStyle: "dashed", borderColor: "border.strong", borderRadius: "md" },
        changesHead: { ...CAPS, paddingY: "16px", paddingX: "20px", fontSize: "label.xs", letterSpacing: "0.14em", color: "fg.muted", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        changes: { margin: "0", padding: "0", listStyle: "none" },
        change: { display: "grid", gridTemplateColumns: "16px minmax(0, 1fr)", gap: "8px", paddingY: "16px", paddingX: "20px", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        changeSign: { "--fa-width": "auto", fontSize: "12px", lineHeight: "20px", color: "fg.muted" },
        changeText: { display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" },
        changeLine: { fontSize: "body", lineHeight: "20px", color: "fg.strong", "& strong": { fontWeight: "600", color: "fg" } },
        changeDetail: { fontFamily: "mono", fontSize: "label.md", lineHeight: "16px", color: "fg.subtle" },
        facts: { display: "flex", flexDirection: "column", gap: "8px", paddingY: "16px", paddingX: "20px" },
        fact: { minHeight: "24px", display: "grid", gridTemplateColumns: "96px minmax(0, 1fr)", columnGap: "16px", alignItems: "baseline" },
        factLabel: { ...CAPS, fontSize: "label.xs", letterSpacing: "0.14em", color: "fg.muted" },
        factValue: { fontSize: "body", lineHeight: "20px", color: "fg" },
        refusal: { paddingX: "20px", paddingBottom: "16px", fontSize: "body.sm", lineHeight: "18px", color: "fg.danger" },
        foot: { flex: "none", display: "flex", flexDirection: "column", gap: "8px", paddingTop: "12px", paddingX: "16px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))", background: "bg.surface", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.strong" },
        footLine: { fontFamily: "mono", fontSize: "label.md", lineHeight: "16px", color: "fg.muted" },
        footButtons: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px", "&[data-stacked]": { gridTemplateColumns: "minmax(0, 1fr)" } },
        footButton: { minHeight: "44px", width: "100%", whiteSpace: "normal" },
    },
});
