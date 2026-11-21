/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio publish slot recipe — the publish preview: the bar on the inverse
 * ground, "● Preview", the device strip, the Env pill and Exit, as the Studio
 * spec draws it; the page on the quiet panel, its project and title over the
 * page at the device's width, the preview's whole width its own; and the rail
 * along its foot, across it (ruled 20 November 2026) — its row: where the page
 * stands and its versions, how many changes, the Audience and Rollout, and
 * the actions; what refused a write over the row, and the change list, while
 * it shows, over that, in columns as the rail's width allows.
 *
 * Only the layout and the bar are the preview's own. Its toggle and its
 * actions are the `button` recipe's.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { centredLine, oneLineBox } from "../one-line-box.js";

/** The bar's rules and its quiet ink, as the spec's secondary and faintest ink fall on the inverse ground. */
const BAR_RULE = { base: "gray.600", _dark: "gray.400" } as const;
const BAR_QUIET = { base: "gray.400", _dark: "gray.600" } as const;

/** Mono caps — the bar's label, the device strip, the page's eyebrow, the rail's Audience and Rollout. */
const CAPS = {
    fontFamily: "mono",
    fontWeight: "600",
    textTransform: "uppercase",
} as const;

export const studioPublishSlotRecipe = defineSlotRecipe({
    className: "elara-studio-publish",
    slots: [
        "root", "bar", "barLabel", "barDot", "devices", "device", "deviceIcon", "env", "envName", "envCaret", "exit",
        "main", "head", "eyebrow", "title", "frame",
        "rail", "list", "change", "sign", "changeText", "changeLine", "changeName", "changeDetail", "refusal",
        "row", "state", "stateTitle", "stateSub", "stateVersion", "count", "end", "facts", "fact", "factLabel", "factValue", "foot",
    ],
    base: {
        /* The preview's own panel, as tall as its host lets it be — no border
           of its own: a host frames it, or places it bare. */
        root: {
            display: "flex",
            flexDirection: "column",
            height: "100%",
            minHeight: "0",
            background: "bg.surface",
            overflow: "hidden",
        },
        /* The bar, headerless, on the inverse ground. */
        bar: {
            display: "flex",
            alignItems: "center",
            gap: "14px",
            flexShrink: "0",
            height: "44px",
            paddingX: "{spacing.4}",
            background: "bg.inverse",
            color: "fg.inverse",
        },
        barLabel: {
            ...CAPS,
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
            marginRight: "auto",
            fontSize: "10.5px",
            letterSpacing: "0.16em",
            color: "fg.inverse",
        },
        barDot: { width: "8px", height: "8px", borderRadius: "full", background: "brand.500" },
        /* Desktop · Tablet · Mobile. */
        devices: {
            display: "inline-flex",
            borderWidth: "1px",
            borderColor: BAR_RULE,
            borderRadius: "6px",
            overflow: "hidden",
        },
        device: {
            ...CAPS,
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            /* A one-line box with no edge above or below (#1638): its line its own 26px. */
            ...oneLineBox(26, 0),
            paddingX: "10px",
            border: "none",
            borderLeftWidth: "1px",
            borderLeftStyle: "solid",
            borderLeftColor: BAR_RULE,
            background: "transparent",
            fontSize: "10px",
            letterSpacing: "0.1em",
            color: BAR_QUIET,
            cursor: "pointer",
            "&:first-of-type": { borderLeftWidth: "0" },
            '&[data-state="on"]': { background: "brandPressed", color: "fg.inverse" },
            "&:focus-visible": {
                outlineWidth: "2px",
                outlineStyle: "solid",
                outlineColor: "border.focus",
                outlineOffset: "-2px",
            },
        },
        /* Its icon at its middle on whole pixels, as an icon button's: an even glyph in the even 26px, out of the line's
           baseline. */
        deviceIcon: { display: "inline-flex", fontSize: centredLine(26, 10) },
        /* The environment it publishes to. */
        env: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
            /* A one-line box (#1638): its words' line the 24px inside its edge. */
            ...oneLineBox(26),
            paddingX: "10px",
            borderWidth: "1px",
            borderColor: BAR_RULE,
            borderRadius: "6px",
            fontFamily: "mono",
            fontSize: "11px",
            color: BAR_QUIET,
            whiteSpace: "nowrap",
        },
        envName: { fontWeight: "600", color: "fg.inverse" },
        envCaret: { fontSize: "8px" },
        exit: {
            display: "inline-flex",
            alignItems: "center",
            /* A one-line box (#1638): its word's line the 26px inside its edge. */
            ...oneLineBox(28),
            paddingX: "{spacing.3}",
            borderWidth: "1px",
            borderColor: BAR_RULE,
            borderRadius: "6px",
            background: "transparent",
            fontSize: "12.5px",
            fontWeight: "500",
            color: "fg.inverse",
            cursor: "pointer",
            _hover: { borderColor: BAR_QUIET },
            _focusVisible: { outline: "none", boxShadow: "focus" },
            _disabled: { cursor: "not-allowed", opacity: "0.5", _hover: { borderColor: BAR_RULE } },
        },
        /* The page, over the rail: the preview's whole width, and its height but the bar's and the rail's. */
        main: {
            flex: "1",
            minWidth: "0",
            minHeight: "0",
            overflowY: "auto",
            paddingX: "28px",
            paddingY: "{spacing.6}",
            background: "bg.panel",
        },
        head: { display: "flex", flexDirection: "column", gap: "{spacing.1}" },
        eyebrow: { ...CAPS, fontSize: "10px", letterSpacing: "0.16em", color: "link" },
        title: {
            fontFamily: "heading",
            fontSize: "26px",
            fontWeight: "700",
            letterSpacing: "-0.015em",
            lineHeight: "1.1",
            color: "fg",
        },
        /* The page's head and the page, together at most the device's width. */
        frame: { display: "flex", flexDirection: "column", gap: "{spacing.4}", width: "100%", marginInline: "auto" },
        /* The rail along the preview's foot, under its rule: its row, and over it what refused a write and the change list. */
        rail: {
            display: "flex",
            flexDirection: "column",
            flexShrink: "0",
            minWidth: "0",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            background: "bg.surface",
        },
        /* The change list, while it shows: in columns as the rail's width allows, at most its own height — it scrolls past
           it — over its rule. Shut, it is `hidden`, whatever its display. */
        list: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            columnGap: "32px",
            rowGap: "14px",
            maxHeight: "232px",
            overflowY: "auto",
            margin: "0",
            paddingX: "20px",
            paddingY: "16px",
            listStyle: "none",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            "&[hidden]": { display: "none" },
        },
        /* One change: its sign, its words, its detail. */
        change: {
            display: "grid",
            gridTemplateColumns: "18px minmax(0, 1fr)",
            gap: "10px",
            minWidth: "0",
        },
        /* The sign: Font Awesome's plus, minus or plus-minus (#1263), on the
         * change line's first line, in its tone's ink, its own width, not Font
         * Awesome's fixed 1.25em. */
        sign: {
            "--fa-width": "auto",
            fontSize: "13px",
            lineHeight: "1.3",
            color: "link",
            "&[data-sign=added]": { color: "fg.success" },
            "&[data-sign=removed]": { color: "fg.danger" },
        },
        changeText: { display: "flex", flexDirection: "column", gap: "3px", minWidth: "0" },
        /* A change's words — the strong secondary ink, `--ink-2`. */
        changeLine: { fontSize: "13px", color: "fg.strong", overflowWrap: "anywhere" },
        changeName: { fontWeight: "600", color: "fg" },
        changeDetail: { fontFamily: "mono", fontSize: "10.5px", color: "fg.subtle", overflowWrap: "anywhere" },
        /* What refused the drafts' apply, or the publish: over the row. */
        refusal: { paddingX: "20px", paddingTop: "12px", fontSize: "12px", lineHeight: "1.4", color: "fg.danger" },
        /* The rail's row: where the page stands, how many changes, then — at its end — who sees it and the actions. A row
           too narrow for them all wraps, its end under the rest, never wider than the rail. */
        row: {
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            columnGap: "20px",
            rowGap: "10px",
            minWidth: "0",
            paddingX: "20px",
            paddingY: "12px",
        },
        /* Where the page stands, over the version it replaces and the one it becomes. */
        state: { display: "flex", flexDirection: "column", gap: "3px", minWidth: "0" },
        stateTitle: {
            fontFamily: "heading",
            fontSize: "17px",
            fontWeight: "700",
            letterSpacing: "-0.01em",
            color: "fg",
        },
        stateSub: { fontFamily: "mono", fontSize: "11px", color: "fg.subtle" },
        stateVersion: { fontWeight: "600", color: "link" },
        /* How many changes, where there are none to list. */
        count: { fontSize: "13px", color: "fg.subtle" },
        end: {
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            columnGap: "20px",
            rowGap: "10px",
            minWidth: "0",
            marginInlineStart: "auto",
        },
        /* Who sees it, and when. */
        facts: { display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: "16px", rowGap: "4px", minWidth: "0" },
        fact: { display: "inline-flex", alignItems: "baseline", gap: "6px", minWidth: "0" },
        factLabel: { ...CAPS, flexShrink: "0", fontSize: "10px", letterSpacing: "0.14em", color: "fg.subtle" },
        factValue: { fontFamily: "mono", fontSize: "11px", color: "fg", overflowWrap: "anywhere" },
        foot: { display: "flex", alignItems: "center", gap: "{spacing.2}", flexShrink: "0" },
    },
});
