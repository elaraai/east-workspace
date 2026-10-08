/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Flowchart slot recipe — the state-transition flowchart per the
 * `Flowchart` design spec, in its builder frame (#1245): the root holding the
 * frame and the colours the canvas draws with; the freshness chip's dot (the
 * chip, a toolbar item, is the shared `chip`); the canvas filling main (lane
 * bands, node cards, H/V links), scrolling both ways in its own box; and the
 * 38px derived-count footer in the frame's footer, its rule its own. Node
 * cards are 116×40 r6
 * with a mono 12/700 code line and a 10.5px muted label; the hover-card SHELL
 * is paper / rule-strong / r6, with no shadow (its body is dev-defined UI).
 * The Flows tab (#1246) is the shared `library` recipe's cards over a foot
 * holding "+ New flow" — the Library's own foot and add action, its plus a
 * Font Awesome icon, a 44px target on a coarse pointer by its halo, which the
 * foot holds whole — and a flowchart with no flow is the shared empty state,
 * centred in its box. Where it edits (#1247), its gestures' controls are Font
 * Awesome's solid icons in the canvas's HTML layer: each lane's × beside its
 * header (off, dimmed, while the lane holds states; a 44px target on a coarse
 * pointer, by its halo), "+ LANE" at the band row's tail, its plus over its
 * word, and the "+ STATE" ghost's plus beside its word. The frame's own
 * regions are the `builderFrame` recipe's.
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

export const flowchartSlotRecipe = defineSlotRecipe({
    className: "elara-flowchart",
    slots: [
        "root", "freshnessDot",
        "body", "scroll", "canvasWrap",
        "node", "ghostNode", "nodeCode", "nodeLabel", "nodeBadge",
        "laneDelete", "addLane",
        "stateGhost", "stateEditor", "moveClone",
        "legend", "legendTitle", "legendRow",
        "minimap",
        "footer", "footerFlow", "footerStrong", "footerNeg", "footerSplit",
        "hoverCard",
        "flowsTab", "flowsList", "flowsFoot", "newFlow", "noFlows",
    ],
    base: {
        /* Fills the box it is given and draws no border: the frame inside it
         * fills it in turn (#1245). The --fc-* variables name the design
         * system's colours (--ink-2 / --ink-3 / --ink-4 / --paper / --paper-2
         * / --rule-strong / --info / --brand / --brand-d / --brand-dd / --neg)
         * through the theme's one token for each, so both modes follow it —
         * SVG geometry consumes them directly. */
        root: {
            "--fc-ink":         "{colors.fg.strong}",
            "--fc-ink3":        "{colors.fg.muted}",
            "--fc-ink4":        "{colors.fg.subtle}",
            "--fc-paper":       "{colors.bg.surface}",
            "--fc-lane":        "{colors.bg.canvas}",
            "--fc-rule-strong": "{colors.border.strong}",
            "--fc-info":        "{colors.status.info}",
            "--fc-brand":       "{colors.brandMark}",
            "--fc-brand-d":     "{colors.brand.solid}",
            "--fc-brand-dd":    "{colors.brandPressed}",
            "--fc-neg":         "{colors.status.neg}",
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            minWidth: 0,
            minHeight: 0,
            position: "relative",
        },

        /* ── the freshness chip's dot — the chip itself is the shared
         *    `chip` recipe's, a toolbar item (#1245) ───────────────────── */
        freshnessDot: {
            width: "6px",
            height: "6px",
            borderRadius: "full",
            background: "status.pos",
            flexShrink: 0,
        },

        /* ── body — main's whole box; the canvas scrolls inside it ─────── */
        body: {
            flex: "1 1 0%",
            minWidth: 0,
            minHeight: 0,
            position: "relative",
        },
        /* Focusable, so a press inside it takes its keys (Del, #1247); a
         * press draws no ring — the selection says what Del deletes. */
        scroll: {
            position: "absolute",
            inset: 0,
            overflow: "auto",
            _focus: { outline: "none" },
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
            /* The ↻ badge doubles as the folded self-loop's selection
             * surface — mirror the selected-node treatment. */
            "&[data-flowchart-inplace]": { cursor: "pointer" },
            "&[data-selected]": {
                color: "brand.600",
                borderColor: "brand.600",
                borderWidth: "1.5px",
            },
        },

        /* ── a lane's × and "+ LANE" (#1247) ─────────────────────────── */
        /* A lane's ×: Font Awesome's xmark, 14px square beside its header,
         * in the header's ink; off — faded, never a click — while the lane
         * holds states, its tooltip saying why. */
        laneDelete: {
            position: "absolute",
            zIndex: 1,
            boxSizing: "border-box",
            width: "14px",
            height: "14px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0",
            border: "none",
            background: "transparent",
            color: "fg.subtle",
            fontSize: "10px",
            cursor: "pointer",
            _hover: { color: "fg.muted" },
            "&[data-disabled]": { opacity: 0.4, cursor: "not-allowed", _hover: { color: "fg.subtle" } },
            ...coarseHitArea(),
        },
        /* "+ LANE": the band row's tail, full lane height, dashed rule-strong
         * r6 — Font Awesome's plus over the word in LR's tall column, beside
         * it on TD's wide band; mono 9px caps, 2px tracking, the header's ink. */
        addLane: {
            position: "absolute",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            gap: "8px",
            paddingTop: "22px",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "border.strong",
            borderRadius: "6px",
            background: "transparent",
            color: "fg.subtle",
            fontFamily: "mono",
            fontSize: "9px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            cursor: "pointer",
            "& svg": { fontSize: "12px" },
            _hover: { borderColor: "brand.600", color: "fg.muted" },
            "&[data-orientation='TD']": { flexDirection: "row", justifyContent: "center", alignItems: "center", paddingTop: "0" },
        },

        /* ── "+ STATE" ghost + inline node editor + move clone ────────── */
        /* The ghost is the placement preview — dashed rule-strong, the
         * exact node footprint, Font Awesome's plus and "state" centred
         * (spec Flowchart.Lane). */
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
            gap: "4px",
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

        /* ── footer — 38px, derived counts, in the frame's footer ──────── */
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
        /* The open flow's name, leading the counts over many flows. */
        footerFlow: { color: "fg", fontWeight: "600" },
        footerStrong: { color: "fg", fontWeight: "700" },
        footerNeg: { color: "status.neg", fontWeight: "600" },
        footerSplit: { marginLeft: "auto", color: "fg.subtle" },

        /* ── hover card — paper · rule-strong · r6, no shadow ─────────── */
        /* Hover-card SHELL — paper · rule-strong · r6 (the design system
         * shadows nothing but the focus ring); the BODY is dev-defined UI
         * (stateHover / linkHover / triggerHover builders). */
        hoverCard: {
            position: "absolute",
            zIndex: 10,
            minWidth: "180px",
            maxWidth: "320px",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "6px",
            padding: "10px 12px",
            pointerEvents: "auto",
        },

        /* ── the Flows tab — its cards, and "+ New flow" under them (#1246) ── */
        /* The tab's body: the cards filling the pane, the foot under them. */
        flowsTab: {
            flex: "1 1 0%",
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
        },
        /* The cards: the shared Library, filling what the foot leaves. */
        flowsList: {
            flex: "1 1 0%",
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
        },
        /* The foot: the Library's own — its rule over it — holding "+ New flow" at its end.
         * It sits on the pane's bottom edge, which clips: on a coarse pointer it is
         * as tall as the button's 44px halo and its rule, so the halo is whole. */
        flowsFoot: {
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingX: "14px",
            paddingY: "10px",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            _coarse: { minHeight: "45px" },
        },
        /* "+ New flow": the Library's add action — mono caps in the brand ink,
         * named by the design system's tokens (the 10px label, semibold, the
         * label's 0.14em tracking) — its plus a Font Awesome icon; a 44px target
         * on a coarse pointer, by its halo. */
        newFlow: {
            display: "inline-flex",
            alignItems: "center",
            gap: "1.5",
            fontFamily: "mono",
            fontSize: "label.sm",
            fontWeight: "semibold",
            letterSpacing: "label",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "brand.solid",
            cursor: "pointer",
            background: "transparent",
            border: "none",
            padding: "0",
            _hover: { color: "brand.fg" },
            ...coarseHitArea({ position: true }),
        },
        /* No flow: the shared empty state, centred in its box — the tab's, or main. */
        noFlows: {
            flex: "1 1 0%",
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "auto",
        },
    },
});
