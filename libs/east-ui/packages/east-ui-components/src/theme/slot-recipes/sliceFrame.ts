/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Slice frame slot recipe.
 *
 * Two surfaces share this recipe:
 *   - The focused/standalone affordance card (`root` / `header` / `eyebrow` /
 *     `meta` / `body` / `footer` / `footerLabel` / `footerAction`) — the bsys
 *     observe `.frame` pattern: 1px rule, 10px radius, paper-2 header/footer.
 *   - `Slice.Frame` (`frameEyebrow` / `frameEyebrowControls` / `frameEyebrowMeta`
 *     / `frameBody` / `frameFooter` / `frameFooterStat` / `frameFooterDelta`) —
 *     the container that houses a slice consumer: a fixed-height one-row eyebrow
 *     (affordances left / meta right, never wraps), an unpadded body slot, and a
 *     derived-count footer. Matches `design/slice.html#slice-frame`.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const sliceFrameSlotRecipe = defineSlotRecipe({
    className: "elara-slice-frame",
    slots: [
        "root", "header", "eyebrow", "meta", "body", "footer", "footerLabel", "footerAction",
        "frameEyebrow", "frameEyebrowControls", "frameEyebrowMeta",
        "frameAffordanceIcon",
        "frameBody", "frameFooter", "frameFooterStat", "frameFooterDelta",
        "searchPill", "searchKbd",
        "legendRail", "legendItem", "legendSwatch", "legendLabel", "legendValue",
    ],
    base: {
        root: {
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "4px",
            background: "bg.surface",
            overflow: "hidden",
        },
        header: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "{spacing.3}",
            background: "bg.canvas",
            paddingX: "18px",
            paddingY: "12px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        eyebrow: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "semibold",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "fg",
            lineHeight: "1",
        },
        meta: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "medium",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "fg.muted",
            lineHeight: "1",
        },
        body: {
            paddingX: "18px",
            paddingY: "14px",
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.3}",
        },
        footer: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "{spacing.3}",
            background: "bg.canvas",
            paddingX: "18px",
            paddingY: "10px",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
        },
        footerLabel: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "medium",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "fg.muted",
            lineHeight: "1",
        },
        footerAction: {
            color: "link",
            fontWeight: "medium",
            cursor: "pointer",
            _hover: { textDecoration: "underline", textUnderlineOffset: "2px" },
        },

        // --- Slice.Frame eyebrow ---
        // One reflowing affordance bar + optional meta. One row when it fits
        // (min 44px), grows into stacked labeled rows when it doesn't.
        frameEyebrow: {
            display: "flex",
            alignItems: "flex-start",
            gap: "{spacing.3}",
            minHeight: "44px",
            paddingX: "12px",
            paddingY: "8px",
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        frameEyebrowControls: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            flexWrap: "nowrap",
            minWidth: "0",
            overflow: "hidden",
        },
        frameEyebrowMeta: {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "{spacing.2}",
            flexShrink: "0",
        },
        frameAffordanceIcon: {
            width: "14px",
            display: "inline-flex",
            justifyContent: "center",
            flexShrink: "0",
            color: "fg.subtle",
        },
        frameBody: {
            // The consumer renders here; the frame supplies no padding so the
            // visual owns its own gutters. May wrap; never re-flows the chrome.
            background: "bg.surface",
            minWidth: "0",
        },
        frameFooter: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            height: "38px",
            paddingX: "14px",
            background: "bg.canvas",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            fontFamily: "mono",
            fontSize: "10.5px",
            color: "fg.muted",
            fontVariantNumeric: "tabular-nums",
        },
        frameFooterStat: {
            color: "fg",
            fontWeight: "semibold",
        },
        frameFooterDelta: {
            color: "fg.success",
            fontWeight: "semibold",
        },

        // Compact search — the closed `.search` pill in the eyebrow's right zone.
        // Magnifier glyph + placeholder + `/` kbd hint; opens the dropdown below.
        searchPill: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.1.5}",
            paddingX: "10px",
            paddingY: "5px",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "4px",
            background: "bg.surface",
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.muted",
            // Tasteful focus: the pill border picks up the focus colour when the
            // inner input is focused (border-colour change, no shadow ring).
            transition: "border-color 0.12s ease",
            _focusWithin: { borderColor: "border.focus" },
            cursor: "text",
            width: "100%",
            minWidth: "160px",
            "& input": {
                fontFamily: "mono",
                fontSize: "11px",
                // Strip Chakra's default ~40px input box — the pill's own padding
                // sets the height; the input is just the text run inside it.
                height: "auto",
                minHeight: "0",
                lineHeight: "1.2",
                paddingInline: "0",
                paddingBlock: "0",
                background: "transparent",
                border: "none",
                // Reset Chakra's combobox input radius (`--chakra-radii-l2`); the
                // pill container owns the 4px corner, the inner input is square.
                borderRadius: "0",
                outline: "none",
                flex: "1",
                minWidth: "0",
                color: "fg",
                _placeholder: { color: "fg.muted" },
                // Kill Chakra's combobox focus ring on the inner input — the pill
                // container owns the only border; the input stays chromeless.
                _focus: { boxShadow: "none", outline: "none", borderColor: "transparent" },
                _focusVisible: { boxShadow: "none", outline: "none" },
            },
        },
        searchKbd: {
            paddingX: "5px",
            paddingY: "1px",
            background: "bg.canvas",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "2px",
            fontSize: "9px",
            fontWeight: "semibold",
            color: "fg.muted",
            lineHeight: "1",
        },

        // Slice.Legend — bare inline rail beneath a chart (spec `Slice.Legend`):
        // swatch · label · value% · eye, no chip chrome. The per-series swatch
        // colour + on/off opacity are data/state-driven (set inline).
        legendRail: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "{spacing.4}",
            paddingX: "14px",
            paddingY: "{spacing.2}",
            fontFamily: "mono",
            fontSize: "10.5px",
            lineHeight: "1",
        },
        legendItem: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.1.5}",
            background: "transparent",
            border: "none",
            padding: "0",
            cursor: "pointer",
        },
        legendSwatch: {
            width: "14px",
            height: "3px",
            borderRadius: "1px",
        },
        legendLabel: {
            fontWeight: "semibold",
            color: "fg",
        },
        legendValue: {
            fontVariantNumeric: "tabular-nums",
            fontWeight: "medium",
            color: "fg.muted",
        },
    },
});
