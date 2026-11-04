/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder on a phone (`Query Builder Phone Spec.md`):
 *
 *   - bar (QP1): the first row, padded 0 12, 8 apart — Table · Tree, the count,
 *     Run against its end, each a 32 box in a 44 target;
 *   - seg, segItem (QP2): the strip, `--rule-strong` on `--r-md`, its options
 *     padded 0 12, mono 11/600/0.16em caps in `--ink-4`, active `brandTint`;
 *   - count (QP3): the count line, a 32 ghost box, mono 10.5 `--ink-3`, its
 *     number's words wrapping at spaces to two lines at most;
 *   - run (QP4): the one Primary, 12.5/600;
 *   - result* (QP34): This result's key/value rows and its downloads;
 *   - live* (QP16): the band of one notice over the strip.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** A 32 box drawn inside a 44 target: the target has no box of its own. */
const TARGET = {
    flex: "none", height: "44px", display: "inline-flex", alignItems: "center", padding: "0", border: "none", background: "transparent", cursor: "pointer", color: "inherit",
    _focusVisible: { outline: "none", "& > *": { boxShadow: "focus" } },
} as const;

export const queryPhoneSlotRecipe = defineSlotRecipe({
    className: "elara-query-phone",
    slots: ["bar", "seg", "segItem", "segIcon", "countTarget", "count", "runTarget", "run", "runIcon", "runLive",
        "result", "resultSection", "resultNote", "viewContext", "liveCheck", "resultRow", "resultKey", "resultValue", "resultHead", "resultLines", "resultActions", "resultAction",
        "live", "liveDot", "liveText", "liveClose",
        "queryNotice", "noMatch", "emptySteps", "emptyGlyph", "emptyTitle", "emptyList", "emptyLink", "optionRow", "optionIcon", "optionBody", "optionLabel", "optionSub", "optionCheck", "viewFieldIcon", "tabHint", "queryView", "queryBand", "copy", "queryScroll", "queryHead", "queryEyebrow", "queryName", "queryDescription", "queryNotices", "queryJq", "querySteps",
        "source", "sourceTile", "sourceText", "sourceTitle", "sourceKind", "shape", "shapeText", "shapeInsert",
        "card", "cardHead", "cardNumber", "cardIcon", "cardTitle", "cardMore", "cardActions", "cardAction",
        "clause", "clauseStatic", "clauseRead", "clauseJoiner", "clauseText", "clauseWord", "clauseValue", "clauseEmpty", "clauseChevron", "clauseEditor",
        "slotRow", "slotLabel", "slotTrigger", "slotField", "removeLink", "addLink", "feet", "group", "groupLines", "note", "code",
        "problem", "problemLine", "problemIcon", "problemFix", "addEnd",
        "queryFoot", "footStatus", "footDot", "footWord", "footGives", "footButtons", "footButton",
        "view", "viewHead", "viewBack", "viewTitle", "viewBand", "viewField", "viewList", "viewGroup", "viewFoot"],
    base: {
        bar: { flex: "1", minWidth: "0", height: "44px", display: "flex", alignItems: "center", gap: "8px", paddingX: "12px", boxSizing: "border-box" },
        seg: { "[data-query-phone-view] &": { height: "44px" }, flex: "none", height: "32px", display: "inline-flex", boxSizing: "border-box", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md", overflow: "hidden" },
        segItem: {
            position: "relative", height: "100%", display: "inline-flex", alignItems: "center", gap: "8px", paddingX: "12px", border: "none", background: "transparent", cursor: "pointer",
            fontFamily: "mono", fontSize: "label.lg", fontWeight: "600", letterSpacing: "0.16em", textTransform: "uppercase", color: "fg.subtle", whiteSpace: "nowrap",
            "&[data-state=on]": { background: "brandTint", color: "brandPressed" },
            "[data-query-phone-view] &": { height: "100%" },
            _disabled: { color: "fg.faint", cursor: "default" },
            /* Its target the row's height, past the strip's 32. */
            "&::after": { content: '""', position: "absolute", insetInline: "0", top: "-6px", bottom: "-6px", "[data-query-phone-view] &": { display: "none" } },
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
            "&[data-icons]": { width: "44px", paddingX: "0", justifyContent: "center" },
            "& + &": { borderInlineStartWidth: "1px", borderInlineStartStyle: "solid", borderInlineStartColor: "border.strong" },
        },
        segIcon: { display: "inline-flex", fontSize: "14px" },
        countTarget: { ...TARGET, flex: "0 1 auto", minWidth: "0", _disabled: { cursor: "default" } },
        count: {
            minHeight: "32px", display: "inline-flex", alignItems: "center", gap: "4px", paddingX: "8px", boxSizing: "border-box", borderRadius: "md",
            fontFamily: "mono", fontSize: "label.md", lineHeight: "14px", color: "fg.muted", textAlign: "left",
            "[aria-expanded=true] > &": { background: "bg.subtle" },
            "button:not(:disabled):hover > &": { background: "bg.canvas" },
            "& svg": { flex: "none", fontSize: "10px", color: "fg.subtle" },
            "&[data-idle]": { fontStyle: "italic", color: "fg.subtle" },
        },
        runTarget: { ...TARGET, marginInlineStart: "auto" },
        run: {
            height: "32px", display: "inline-flex", alignItems: "center", gap: "8px", paddingX: "12px", boxSizing: "border-box", borderRadius: "md",
            background: "brand.solid", color: "brand.contrast", fontSize: "body.sm", fontWeight: "600", whiteSpace: "nowrap",
        },
        runIcon: { display: "inline-flex", fontSize: "14px" },
        runLive: {
            position: "relative", width: "8px", height: "8px", borderRadius: "full", background: "currentColor",
            "&::after": { content: '""', position: "absolute", inset: "0", borderRadius: "full", background: "currentColor", animation: "elara-live-pulse calc({durations.slow} * 4) {easings.out} infinite", _motionReduce: { animation: "none" } },
        },
        /* Inside the view's own padding, edge to edge: its sections split by rules. */
        result: { display: "flex", flexDirection: "column", marginX: "-16px", marginY: "-12px" },
        resultSection: { display: "flex", flexDirection: "column", gap: "8px", paddingY: "16px", paddingX: "16px", "& + &": { borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle" } },
        resultNote: { fontFamily: "mono", fontSize: "label.xs", lineHeight: "1.4", color: "fg.subtle" },
        viewContext: { fontFamily: "mono", fontSize: "label.md", fontWeight: "400", letterSpacing: "0", color: "fg.subtle" },
        liveCheck: { flex: "none", display: "inline-flex", fontSize: "14px", color: "status.pos" },
        resultRow: { display: "grid", gridTemplateColumns: "96px minmax(0, 1fr)", columnGap: "12px", fontSize: "body", lineHeight: "20px" },
        resultKey: { color: "fg.muted" },
        resultValue: { color: "fg", overflowWrap: "anywhere", "&[data-mono]": { fontFamily: "mono", fontSize: "label.md" } },
        resultHead: { fontFamily: "mono", fontSize: "label.xs", fontWeight: "600", letterSpacing: "0.14em", textTransform: "uppercase", color: "fg.subtle" },
        resultLines: { display: "flex", flexDirection: "column", gap: "4px", margin: "0", padding: "0", listStyle: "none", fontSize: "body.sm", lineHeight: "18px", color: "fg.strong", "& code": { display: "block", fontFamily: "mono", fontSize: "label.md", color: "fg.muted", overflowWrap: "anywhere" } },
        resultActions: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" },
        resultAction: { minHeight: "44px", width: "100%" },
        live: {
            minHeight: "44px", display: "flex", alignItems: "center", gap: "8px", paddingY: "4px", paddingInlineStart: "16px", paddingInlineEnd: "4px", boxSizing: "border-box",
            background: "bg.surface", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle",
        },
        liveDot: { flex: "none", width: "8px", height: "8px", borderRadius: "full", background: "status.info", },
        liveText: { flex: "1", minWidth: "0", fontSize: "body.sm", lineHeight: "18px", color: "fg.strong" },
        liveClose: {
            flex: "none", width: "44px", height: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0", border: "none", background: "transparent",
            color: "fg.muted", cursor: "pointer", "& svg": { fontSize: "14px" }, _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        /* The Query view (QP20–QP29): the band, the scrolling body on `--paper-2`, the sticky foot. */
        queryView: { flex: "1", minHeight: "0", height: "100%", display: "flex", flexDirection: "column", background: "bg.surface" },
        queryBand: { flex: "none", height: "56px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", paddingInlineStart: "16px", paddingInlineEnd: "8px", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        copy: {
            flex: "none", height: "44px", display: "inline-flex", alignItems: "center", gap: "8px", paddingX: "8px", border: "none", background: "transparent", borderRadius: "md", cursor: "pointer",
            fontSize: "body.sm", fontWeight: "500", color: "fg.strong", whiteSpace: "nowrap", "& svg": { fontSize: "12px" },
            "&[data-copied]": { "& svg": { color: "status.pos" } }, _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        queryScroll: { flex: "1", minHeight: "0", overflowY: "auto", overflowX: "hidden", background: "bg.canvas", "&[data-mode=jq]": { display: "flex", flexDirection: "column", overflow: "hidden", background: "bg.surface" } },
        queryNotice: { flex: "none", minHeight: "44px", display: "flex", alignItems: "center", gap: "8px", paddingY: "4px", paddingInlineStart: "16px", paddingInlineEnd: "4px", background: "bg.canvas", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.strong" },
        emptySteps: { display: "flex", flexDirection: "column", gap: "8px", padding: "16px", background: "bg.surface", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md" },
        noMatch: { display: "flex", flexDirection: "column", gap: "8px", paddingY: "8px" },
        emptyGlyph: { fontFamily: "mono", fontSize: "26px", lineHeight: "1.2", color: "border.strong" },
        emptyTitle: { fontFamily: "heading", fontSize: "15px", fontWeight: "700", color: "fg" },
        emptyList: { margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "8px", fontSize: "body", lineHeight: "20px", color: "fg.strong", "& li": { display: "flex", gap: "8px" }, "& li::before": { content: '"☐"', flex: "none", color: "fg.subtle" } },
        emptyLink: { alignSelf: "flex-start", minHeight: "44px", padding: "0", border: "none", background: "transparent", fontSize: "body.sm", fontWeight: "500", color: "brand.solid", cursor: "pointer" },
        queryHead: { display: "flex", flexDirection: "column", gap: "4px", paddingY: "12px", paddingX: "16px", background: "bg.surface", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        queryEyebrow: { fontFamily: "mono", fontSize: "label.xs", fontWeight: "600", letterSpacing: "0.14em", textTransform: "uppercase", color: "fg.subtle" },
        queryName: { fontFamily: "heading", fontSize: "title.sm", fontWeight: "700", letterSpacing: "-0.01em", color: "fg", lineHeight: "1.3" },
        queryDescription: { fontSize: "body.sm", lineHeight: "18px", color: "fg.muted" },
        queryNotices: { display: "flex", flexDirection: "column", gap: "8px", paddingX: "16px", paddingTop: "12px" },
        queryJq: { flex: "1", minHeight: "0", display: "flex", flexDirection: "column" },
        querySteps: { display: "flex", flexDirection: "column", paddingX: "16px", paddingY: "12px" },
        /* The source (QP22): an item card, its tile 36. */
        source: { display: "flex", alignItems: "center", gap: "12px", padding: "12px", background: "bg.surface", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md" },
        sourceTile: { flex: "none", width: "36px", height: "36px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "md", background: "bg.subtle", color: "fg.muted", fontSize: "14px" },
        sourceText: { flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" },
        sourceTitle: { fontSize: "body", fontWeight: "600", color: "fg" },
        sourceKind: { fontSize: "body.sm", color: "fg.muted", overflowWrap: "anywhere" },
        /* The line between steps: min 44, a rule 20 in, its count or words, Insert a 44 ghost. */
        shape: {
            position: "relative", minHeight: "44px", display: "flex", alignItems: "center", gap: "8px", paddingInlineStart: "32px",
            "&::before": { content: '""', position: "absolute", top: "0", bottom: "0", insetInlineStart: "20px", width: "1px", background: "border.strong" },
        },
        shapeText: { flex: "1", minWidth: "0", fontFamily: "mono", fontSize: "label.md", lineHeight: "16px", color: "fg.muted", "& b": { fontWeight: "600", color: "fg" } },
        shapeInsert: {
            flex: "none", height: "44px", display: "inline-flex", alignItems: "center", gap: "4px", paddingX: "8px", border: "none", background: "transparent", borderRadius: "md", cursor: "pointer",
            fontSize: "body.sm", fontWeight: "500", color: "fg.muted", "& svg": { fontSize: "12px" }, _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        /* A step (QP23): its head min 44, dashed while unfinished. */
        card: {
            background: "bg.surface", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md", overflow: "hidden",
            "&[data-unfinished]": { borderStyle: "dashed" },
            "&[data-focus]": { borderColor: "brand.solid" },
        },
        cardHead: { minHeight: "44px", display: "flex", alignItems: "center", gap: "4px", paddingInlineStart: "12px" },
        cardNumber: { flex: "none", width: "16px", fontFamily: "mono", fontSize: "label.md", color: "fg.subtle" },
        cardIcon: { flex: "none", width: "16px", display: "inline-flex", justifyContent: "center", fontSize: "14px", color: "fg.muted", marginInlineEnd: "4px" },
        cardTitle: { flex: "1", minWidth: "0", fontSize: "body", fontWeight: "600", lineHeight: "18px", color: "fg" },
        cardMore: {
            flex: "none", width: "44px", height: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0", border: "none", background: "transparent", color: "fg.muted", cursor: "pointer",
            "&[aria-expanded=true]": { background: "bg.subtle" }, _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        /* ⋯, inline (QP27). */
        cardActions: { display: "flex", flexWrap: "wrap", gap: "8px", padding: "12px", background: "bg.canvas", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle" },
        cardAction: { minHeight: "44px" },
        /* A clause (QP24): min 44, padded 8 12, its joiner in a 28 column, a chevron 12. */
        clause: {
            width: "100%", minHeight: "44px", display: "flex", alignItems: "center", gap: "8px", paddingY: "8px", paddingX: "12px", boxSizing: "border-box", textAlign: "left",
            border: "none", background: "transparent", cursor: "pointer", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle",
            _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        clauseStatic: { display: "flex", flexDirection: "column", minHeight: "44px", justifyContent: "center", paddingY: "8px", paddingX: "12px", boxSizing: "border-box", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle" },
        clauseRead: { flex: "1", minWidth: "0", display: "flex", alignItems: "baseline" },
        optionRow: {
            minHeight: "44px", display: "flex", alignItems: "center", gap: "8px", paddingY: "8px", paddingX: "16px", boxSizing: "border-box", cursor: "pointer", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle",
            "&[data-current]": { background: "bg.subtle" },
            "&[data-disabled]": { cursor: "default", color: "fg.faint" },
        },
        optionIcon: { flex: "none", width: "16px", display: "inline-flex", justifyContent: "center", fontSize: "14px", color: "fg.muted", "[data-disabled] > &": { color: "fg.faint" } },
        optionBody: { flex: "1", minWidth: "0", display: "flex", flexDirection: "column" },
        optionLabel: { fontSize: "body", lineHeight: "18px", color: "fg", "&[data-mono]": { fontFamily: "mono", fontWeight: "500" }, "[data-disabled] &": { color: "fg.faint" } },
        optionSub: { fontFamily: "mono", fontSize: "label.md", lineHeight: "14px", color: "fg.subtle" },
        optionCheck: { flex: "none", display: "inline-flex", fontSize: "12px", color: "brand.solid" },
        viewFieldIcon: { position: "absolute", insetInlineStart: "28px", fontSize: "14px", color: "fg.subtle", pointerEvents: "none" },
        tabHint: { flex: "none", minHeight: "44px", display: "flex", alignItems: "center", paddingX: "16px", boxSizing: "border-box", fontFamily: "mono", fontSize: "label.lg", color: "fg.muted", background: "bg.surface", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle" },
        clauseJoiner: { flex: "none", width: "28px", fontSize: "body.sm", color: "fg.subtle" },
        clauseText: { flex: "1", minWidth: "0", fontSize: "body", lineHeight: "20px" },
        clauseWord: { color: "fg.muted" },
        clauseValue: { fontWeight: "500", color: "fg", "&[data-mono]": { fontFamily: "mono" } },
        clauseEmpty: { fontStyle: "italic", color: "fg.subtle" },
        clauseChevron: { flex: "none", display: "inline-flex", fontSize: "12px", color: "fg.subtle", transitionProperty: "transform", transitionDuration: "fast", "&[data-open]": { transform: "rotate(180deg)" }, _motionReduce: { transition: "none" } },
        /* Its slots, open under it (QP25). */
        clauseEditor: { display: "flex", flexDirection: "column", gap: "8px", padding: "12px", background: "bg.canvas" },
        slotRow: { display: "grid", gridTemplateColumns: "72px minmax(0, 1fr)", alignItems: "center", columnGap: "8px" },
        slotLabel: { fontSize: "body.sm", fontWeight: "500", color: "fg.muted" },
        slotTrigger: {
            minWidth: "0", minHeight: "44px", width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", paddingX: "12px", paddingY: "8px", boxSizing: "border-box", textAlign: "left",
            background: "bg.surface", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md", fontSize: "body", color: "fg", cursor: "pointer",
            "& svg": { flex: "none", fontSize: "10px", color: "fg.muted" },
            "&[data-mono]": { fontFamily: "mono" },
            "&[data-empty]": { borderStyle: "dashed", color: "fg.subtle" },
            "&[data-dirty]": { background: "brandTint", color: "brandPressed" },
            "&[data-error]": { borderColor: "status.neg" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
        },
        slotField: { minWidth: "0", "& input": { width: "100%", height: "44px", minHeight: "44px", fontSize: "body" } },
        removeLink: {
            alignSelf: "flex-start", minHeight: "44px", display: "inline-flex", alignItems: "center", gap: "8px", paddingX: "8px", border: "none", background: "transparent", borderRadius: "md", cursor: "pointer",
            fontSize: "body.sm", fontWeight: "500", color: "fg.muted", "& svg": { fontSize: "14px" }, _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        addLink: {
            minHeight: "44px", display: "inline-flex", alignItems: "center", gap: "8px", paddingX: "12px", border: "none", background: "transparent", cursor: "pointer",
            fontSize: "body.sm", fontWeight: "500", color: "brand.solid", "& svg": { fontSize: "12px" }, _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
        feet: { display: "flex", flexWrap: "wrap", paddingInlineStart: "28px", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle" },
        group: {},
        groupLines: { marginInlineStart: "12px", borderInlineStartWidth: "1px", borderInlineStartStyle: "solid", borderInlineStartColor: "border.subtle" },
        note: { padding: "12px", fontSize: "body.sm", lineHeight: "18px", color: "fg.muted" },
        code: { margin: "0", padding: "12px", fontFamily: "mono", fontSize: "label.md", lineHeight: "16px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "fg.strong", background: "bg.canvas" },
        /* A problem under its clause (QP26). */
        problem: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "8px", paddingY: "8px", paddingX: "12px", background: "color-mix(in srgb, {colors.status.neg} 6%, transparent)", "&[data-severity=warning], &[data-severity=note]": { background: "bg.canvas" } },
        problemLine: { display: "flex", gap: "8px", fontSize: "body.sm", lineHeight: "18px", color: "fg.danger", "[data-severity=warning] > &": { color: "fg.warning" }, "[data-severity=note] > &": { color: "fg.muted" } },
        problemIcon: { flex: "none", fontSize: "14px" },
        problemFix: { minHeight: "44px", whiteSpace: "normal", height: "auto" },
        addEnd: {
            minHeight: "44px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginTop: "4px", background: "transparent", cursor: "pointer",
            borderWidth: "1px", borderStyle: "dashed", borderColor: "border.strong", borderRadius: "md", fontSize: "body.sm", fontWeight: "500", color: "fg.strong", "& svg": { fontSize: "12px" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
        },
        /* The sticky foot (QP29). */
        queryFoot: { flex: "none", display: "flex", flexDirection: "column", gap: "8px", paddingTop: "12px", paddingX: "16px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))", background: "bg.surface", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.strong" },
        footStatus: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: "8px", rowGap: "2px" },
        footDot: { flex: "none", width: "8px", height: "8px", borderRadius: "full", background: "status.pos", "&[data-tone=warning]": { background: "status.warn" }, "&[data-tone=danger]": { background: "status.neg" } },
        footWord: { fontFamily: "mono", fontSize: "label.md", fontWeight: "600", letterSpacing: "0.1em", textTransform: "uppercase", color: "fg.muted", "&[data-tone=warning]": { color: "fg.warning" }, "&[data-tone=danger]": { color: "fg.danger" } },
        footGives: { fontSize: "body.sm", color: "fg.strong" },
        footButtons: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" },
        footButton: { minHeight: "44px", width: "100%" },
        /* A full-height view (QP33): a slot's choices. */
        view: { position: "absolute", inset: "0", pointerEvents: "auto", display: "flex", flexDirection: "column", background: "bg.surface" },
        viewHead: { flex: "none", minHeight: "44px", display: "flex", alignItems: "center", gap: "8px", paddingInlineEnd: "8px", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        viewBack: { flex: "none", width: "44px", height: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0", border: "none", background: "transparent", color: "fg.muted", cursor: "pointer", "& svg": { fontSize: "16px" }, _focusVisible: { outline: "none", boxShadow: "focusInset" } },
        viewTitle: { flex: "1", minWidth: "0", fontFamily: "heading", fontSize: "title.sm", fontWeight: "700", letterSpacing: "-0.01em", color: "fg" },
        viewBand: { position: "relative", flex: "none", height: "56px", display: "flex", alignItems: "center", paddingX: "16px", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.subtle" },
        viewField: { width: "100%", height: "44px", paddingInlineStart: "36px", paddingInlineEnd: "12px", boxSizing: "border-box", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md", background: "bg.surface", fontSize: "body", color: "fg", _placeholder: { color: "fg.subtle" }, _focusVisible: { outline: "none", boxShadow: "focus" } },
        viewList: { flex: "1", minHeight: "0", overflowY: "auto" },
        viewGroup: { paddingTop: "16px", paddingBottom: "8px", paddingX: "16px", fontFamily: "mono", fontSize: "label.xs", fontWeight: "600", letterSpacing: "0.14em", textTransform: "uppercase", color: "fg.subtle" },
        viewFoot: { flex: "none", paddingTop: "12px", paddingX: "16px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))", fontFamily: "mono", fontSize: "label.md", color: "fg.subtle", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle" },
    },
});
