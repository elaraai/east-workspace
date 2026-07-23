/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Flowchart slot recipe — the state-transition flowchart per the
 * `Flowchart` design spec: 44px eyebrow (slice cluster left; orientation
 * segment + freshness chip right), body canvas (lane bands, node cards,
 * H/V links), 38px derived-count footer. Node cards are 116×40 r6 with a
 * mono 12/700 code line and a 10.5px muted label; the hover-card SHELL is
 * paper / rule-strong / shadow-md / r6 (its body is dev-defined UI).
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const flowchartSlotRecipe = defineSlotRecipe({
    className: "elara-flowchart",
    slots: [
        "root", "eyebrow", "eyebrowLeft", "eyebrowRight",
        "orientationSegment", "freshnessChip", "freshnessDot", "freshnessDate",
        "body", "scroll", "canvasWrap",
        "node", "ghostNode", "nodeCode", "nodeLabel", "nodeBadge",
        "stateGhost", "stateEditor", "moveClone",
        "legend", "legendTitle", "legendRow",
        "minimap",
        "footer", "footerStrong", "footerNeg", "footerSplit",
        "hoverCard",
    ],
    base: {
        /* Bare like Table / Planner — identity chrome is host composition.
         * The --fc-* variables mirror the design spec's literal DS tokens
         * (--ink-2 / --ink-3 / --ink-4 / --paper / --paper-2 / --rule-strong /
         * --info / --brand / --brand-d / --brand-dd / --neg), with the spec's
         * dark-mode values — SVG geometry consumes them directly. */
        root: {
            "--fc-ink":         "{colors.brand.700}",
            "--fc-ink3":        "{colors.gray.600}",
            "--fc-ink4":        "{colors.gray.500}",
            "--fc-paper":       "{colors.white}",
            "--fc-lane":        "{colors.gray.50}",
            "--fc-rule-strong": "{colors.gray.300}",
            "--fc-info":        "{colors.brand.600}",
            "--fc-brand":       "{colors.brand.500}",
            "--fc-brand-d":     "{colors.brand.600}",
            "--fc-brand-dd":    "{colors.brand.700}",
            "--fc-neg":         "#b85a4a",
            _dark: {
                "--fc-ink":         "{colors.gray.300}",
                "--fc-ink3":        "{colors.gray.400}",
                "--fc-ink4":        "{colors.gray.500}",
                "--fc-paper":       "{colors.gray.900}",
                "--fc-lane":        "{colors.gray.800}",
                "--fc-rule-strong": "{colors.gray.600}",
                "--fc-info":        "#6fb3bb",
                "--fc-brand":       "{colors.brand.500}",
                "--fc-brand-d":     "#5ba9b3",
                "--fc-brand-dd":    "#79c4cd",
                "--fc-neg":         "#d98a7c",
            },
            background: "bg.surface",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            position: "relative",
        },

        /* ── eyebrow — one row, 44px, never wraps ─────────────────────── */
        eyebrow: {
            height: "44px",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "3",
            paddingX: "3",
            borderBottomWidth: "1px",
            borderColor: "border.subtle",
            overflow: "hidden",
        },
        eyebrowLeft: {
            display: "flex",
            alignItems: "center",
            gap: "2",
            minWidth: 0,
            flex: "1 1 auto",
            overflow: "hidden",
            /* Spec eyebrow anatomy: chips first, then a COMPACT find-state
             * field — never a full-width search box. */
            "& input": { maxWidth: "128px" },
        },
        /* Right zone, fixed: orientation segment then the freshness chip. */
        eyebrowRight: {
            display: "flex",
            alignItems: "center",
            gap: "2",
            flexShrink: 0,
        },
        orientationSegment: {
            display: "flex",
            alignItems: "stretch",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "4px",
            overflow: "hidden",
            "& > button": {
                fontFamily: "mono",
                fontSize: "10px",
                fontWeight: "600",
                letterSpacing: "0.5px",
                paddingX: "2",
                paddingY: "1",
                color: "fg.muted",
                background: "bg.panel",
                cursor: "pointer",
                _hover: { color: "fg" },
            },
            "& > button[data-active]": {
                background: "bg.surface",
                color: "fg",
            },
            "& > button + button": {
                borderLeftWidth: "1px",
                borderColor: "border.subtle",
            },
        },
        freshnessChip: {
            display: "flex",
            alignItems: "center",
            gap: "1.5",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            color: "fg.muted",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "full",
            paddingX: "2.5",
            paddingY: "1",
            whiteSpace: "nowrap",
        },
        freshnessDot: {
            width: "6px",
            height: "6px",
            borderRadius: "full",
            background: "status.pos",
            flexShrink: 0,
        },
        freshnessDate: { color: "fg.subtle", fontWeight: "400" },

        /* ── body ─────────────────────────────────────────────────────── */
        body: {
            flex: "1 1 0%",
            minHeight: 0,
            position: "relative",
        },
        scroll: {
            position: "absolute",
            inset: 0,
            overflow: "auto",
        },
        canvasWrap: {
            position: "relative",
        },

        /* ── node cards — 116×40, r6, mono code + muted label ─────────── */
        node: {
            position: "absolute",
            boxSizing: "border-box",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "6px",
            padding: "4px 10px",
            cursor: "pointer",
            "&[data-selected]": {
                borderWidth: "1.5px",
                borderColor: "brand.600",
            },
        },
        ghostNode: {
            position: "absolute",
            boxSizing: "border-box",
            background: "bg.surface",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "status.neg",
            borderRadius: "6px",
            padding: "4px 10px",
            cursor: "pointer",
            "& > div:first-of-type": { color: "status.neg" },
        },
        nodeCode: {
            fontFamily: "mono",
            fontSize: "12px",
            fontWeight: "700",
            lineHeight: "1.3",
            color: "fg",
            display: "flex",
            alignItems: "center",
            gap: "6px",
        },
        nodeLabel: {
            fontSize: "10.5px",
            color: "fg.muted",
            lineHeight: "1.1",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        nodeBadge: {
            marginLeft: "auto",
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "600",
            color: "fg.subtle",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "3px",
            padding: "0 3px",
            lineHeight: "1.4",
            whiteSpace: "nowrap",
            "& + &": { marginLeft: "4px" },
        },

        /* ── "+ STATE" ghost + inline node editor + move clone ────────── */
        /* The ghost is the placement preview — dashed rule-strong, the
         * exact node footprint, "+ state" centred (spec Flowchart.Lane). */
        stateGhost: {
            position: "absolute",
            boxSizing: "border-box",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "border.strong",
            borderRadius: "6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "1px",
            color: "fg.subtle",
            cursor: "pointer",
            background: "bg.surface",
            _hover: { borderColor: "brand.600", color: "fg.muted" },
        },
        /* Editing flips the dashed border to brand-d; code auto-focused,
         * label below. */
        stateEditor: {
            position: "absolute",
            zIndex: 11,
            boxSizing: "border-box",
            background: "bg.surface",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "brand.600",
            borderRadius: "6px",
            padding: "3px 9px",
            display: "flex",
            flexDirection: "column",
            gap: "1px",
            "& > input": {
                fontFamily: "mono",
                fontSize: "12px",
                fontWeight: "700",
                background: "transparent",
                outline: "none",
                width: "100%",
            },
            "& > input + input": {
                fontFamily: "body",
                fontSize: "10.5px",
                fontWeight: "400",
                color: "fg.muted",
            },
        },
        /* Translucent clone following the pointer during a cross-lane drag. */
        moveClone: {
            position: "absolute",
            zIndex: 12,
            pointerEvents: "none",
            boxSizing: "border-box",
            width: "116px",
            height: "40px",
            background: "bg.surface",
            opacity: 0.85,
            borderWidth: "1.5px",
            borderColor: "brand.600",
            borderRadius: "6px",
            padding: "4px 10px",
            boxShadow: "md",
        },

        /* ── legend ───────────────────────────────────────────────────── */
        legend: {
            position: "absolute",
            left: "16px",
            bottom: "16px",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "6px",
            padding: "10px 14px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
        },
        legendTitle: {
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "600",
            letterSpacing: "2px",
            textTransform: "uppercase",
            color: "fg.subtle",
            marginBottom: "2px",
        },
        legendRow: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "10.5px",
            color: "fg.muted",
        },

        /* ── minimap ──────────────────────────────────────────────────── */
        minimap: {
            position: "absolute",
            right: "16px",
            bottom: "16px",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "6px",
            padding: "6px",
            lineHeight: 0,
        },

        /* ── footer — 38px, derived count only ────────────────────────── */
        footer: {
            height: "38px",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: "1.5",
            paddingX: "3",
            borderTopWidth: "1px",
            borderColor: "border.subtle",
            fontFamily: "mono",
            fontSize: "10.5px",
            color: "fg.muted",
            whiteSpace: "nowrap",
            overflow: "hidden",
        },
        footerStrong: { color: "fg", fontWeight: "700" },
        footerNeg: { color: "status.neg", fontWeight: "600" },
        footerSplit: { marginLeft: "auto", color: "fg.subtle" },

        /* ── hover card — paper · rule-strong · shadow-md · r6 ────────── */
        /* Hover-card SHELL — paper · rule-strong · shadow-md · r6 per the
         * spec; the BODY is dev-defined UI (stateHover / linkHover /
         * triggerHover builders). */
        hoverCard: {
            position: "absolute",
            zIndex: 10,
            minWidth: "180px",
            maxWidth: "320px",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "6px",
            boxShadow: "md",
            padding: "10px 12px",
            pointerEvents: "auto",
        },
    },
});
