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
        "resultRows", "resultRow", "resultKey", "resultValue", "resultHead", "resultLines", "resultActions", "resultAction",
        "live", "liveDot", "liveText", "liveClose"],
    base: {
        bar: { flex: "1", minWidth: "0", height: "44px", display: "flex", alignItems: "center", gap: "8px", paddingX: "12px", boxSizing: "border-box" },
        seg: { flex: "none", height: "32px", display: "inline-flex", boxSizing: "border-box", borderWidth: "1px", borderStyle: "solid", borderColor: "border.strong", borderRadius: "md", overflow: "hidden" },
        segItem: {
            position: "relative", height: "100%", display: "inline-flex", alignItems: "center", gap: "8px", paddingX: "12px", border: "none", background: "transparent", cursor: "pointer",
            fontFamily: "mono", fontSize: "label.lg", fontWeight: "600", letterSpacing: "0.16em", textTransform: "uppercase", color: "fg.subtle", whiteSpace: "nowrap",
            "&[data-state=on]": { background: "brandTint", color: "brandPressed" },
            _disabled: { color: "fg.faint", cursor: "default" },
            /* Its target the row's height, past the strip's 32. */
            "&::after": { content: '""', position: "absolute", insetInline: "0", top: "-6px", bottom: "-6px" },
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
        resultRows: { display: "flex", flexDirection: "column", gap: "8px" },
        resultRow: { display: "grid", gridTemplateColumns: "96px minmax(0, 1fr)", columnGap: "12px", fontSize: "body", lineHeight: "20px" },
        resultKey: { color: "fg.muted" },
        resultValue: { color: "fg", overflowWrap: "anywhere", "&[data-mono]": { fontFamily: "mono", fontSize: "label.md" } },
        resultHead: { marginTop: "4px", fontFamily: "heading", fontSize: "body", fontWeight: "700", color: "fg" },
        resultLines: { display: "flex", flexDirection: "column", gap: "4px", margin: "0", padding: "0", listStyle: "none", fontSize: "body.sm", lineHeight: "18px", color: "fg.strong", "& code": { display: "block", fontFamily: "mono", fontSize: "label.md", color: "fg.muted", overflowWrap: "anywhere" } },
        resultActions: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px", marginTop: "4px" },
        resultAction: { minHeight: "44px", width: "100%" },
        live: {
            minHeight: "44px", display: "flex", alignItems: "center", gap: "8px", paddingY: "4px", paddingInlineStart: "16px", paddingInlineEnd: "4px", boxSizing: "border-box",
            background: "bg.surface", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle",
        },
        liveDot: { flex: "none", width: "8px", height: "8px", borderRadius: "full", background: "status.info", "&[data-saved]": { background: "status.pos" } },
        liveText: { flex: "1", minWidth: "0", fontSize: "body.sm", lineHeight: "18px", color: "fg.strong" },
        liveClose: {
            flex: "none", width: "44px", height: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0", border: "none", background: "transparent",
            color: "fg.muted", cursor: "pointer", "& svg": { fontSize: "14px" }, _focusVisible: { outline: "none", boxShadow: "focusInset" },
        },
    },
});
