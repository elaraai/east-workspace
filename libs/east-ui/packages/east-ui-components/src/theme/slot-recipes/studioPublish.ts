/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio publish slot recipe — the publish preview as the Studio spec draws
 * it: the bar on the inverse ground, "● Preview", the device strip, the Env
 * pill and Exit; the page on the quiet panel, its project and title over the
 * page at the device's width; and the aside — its head, the change list, the
 * banner, the Audience and Rollout rows, and the footer.
 *
 * Only the layout and the bar are the preview's own. Its banner is the
 * design system's, on the theme's banner layer styles, and its footer's
 * buttons are the `button` recipe's.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** Strong secondary ink — a change's words. */
const INK_2 = { base: "brand.700", _dark: "gray.300" } as const;
/** The bar's rules and its quiet ink, as the spec's secondary and faintest ink fall on the inverse ground. */
const BAR_RULE = { base: "gray.600", _dark: "gray.400" } as const;
const BAR_QUIET = { base: "gray.400", _dark: "gray.600" } as const;

/** Mono caps — the bar's label, the device strip, the aside's captions. */
const CAPS = {
    fontFamily: "mono",
    fontWeight: "600",
    textTransform: "uppercase",
} as const;

export const studioPublishSlotRecipe = defineSlotRecipe({
    className: "elara-studio-publish",
    slots: [
        "root", "bar", "barLabel", "barDot", "devices", "device", "deviceIcon", "env", "envName", "envCaret", "exit",
        "body", "main", "head", "eyebrow", "title", "frame",
        "aside", "asideHead", "asideTitle", "asideSub", "asideVersion", "asideBody", "listHead", "list",
        "change", "sign", "changeText", "changeLine", "changeName", "changeDetail",
        "banner", "bannerGlyph", "bannerText", "facts", "fact", "factLabel", "factValue", "refusal", "foot",
    ],
    base: {
        /* The preview's own panel, as tall as its host lets it be. */
        root: {
            display: "flex",
            flexDirection: "column",
            height: "100%",
            minHeight: "0",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "10px",
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
            height: "26px",
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
        deviceIcon: { fontSize: "9.5px" },
        /* The environment it publishes to. */
        env: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
            height: "26px",
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
            height: "28px",
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
        /* The page beside the aside. */
        body: {
            flex: "1",
            minHeight: "0",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 320px",
        },
        main: {
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
        aside: {
            display: "flex",
            flexDirection: "column",
            minHeight: "0",
            borderLeftWidth: "1px",
            borderLeftColor: "border.subtle",
            background: "bg.surface",
        },
        asideHead: {
            display: "flex",
            flexDirection: "column",
            gap: "5px",
            paddingX: "20px",
            paddingY: "18px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        asideTitle: {
            fontFamily: "heading",
            fontSize: "17px",
            fontWeight: "700",
            letterSpacing: "-0.01em",
            color: "fg",
        },
        asideSub: { fontFamily: "mono", fontSize: "11px", color: "fg.subtle" },
        asideVersion: { fontWeight: "600", color: "link" },
        asideBody: {
            flex: "1",
            minHeight: "0",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            paddingX: "20px",
            paddingY: "18px",
            overflowY: "auto",
        },
        listHead: { ...CAPS, fontSize: "10px", letterSpacing: "0.16em", color: "fg.subtle" },
        list: { display: "flex", flexDirection: "column", margin: "0", padding: "0", listStyle: "none" },
        /* One change: its sign, its words, its detail. */
        change: {
            display: "grid",
            gridTemplateColumns: "18px minmax(0, 1fr)",
            gap: "10px",
            paddingY: "10px",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            "&:last-of-type": { borderBottomWidth: "1px", borderBottomColor: "border.subtle" },
        },
        sign: {
            fontFamily: "mono",
            fontSize: "13px",
            fontWeight: "700",
            lineHeight: "1.3",
            color: "link",
            "&[data-sign=added]": { color: "fg.success" },
            "&[data-sign=removed]": { color: "fg.danger" },
        },
        changeText: { display: "flex", flexDirection: "column", gap: "3px", minWidth: "0" },
        changeLine: { fontSize: "13px", color: INK_2, overflowWrap: "anywhere" },
        changeName: { fontWeight: "600", color: "fg" },
        changeDetail: { fontFamily: "mono", fontSize: "10.5px", color: "fg.subtle", overflowWrap: "anywhere" },
        /* The design system's banner: its glyph, then its words; its ground
           is the banner layer style its tone names. */
        banner: {
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            fontSize: "13px",
            lineHeight: "1.5",
            color: "fg",
            "&[data-tone=warning]": { color: INK_2 },
        },
        bannerGlyph: {
            flex: "none",
            fontFamily: "mono",
            fontWeight: "700",
            color: "link",
            "[data-tone=warning] > &": { color: "fg.warning" },
        },
        bannerText: { minWidth: "0" },
        /* Who sees it, and when. */
        facts: { marginTop: "auto", display: "flex", flexDirection: "column", gap: "10px" },
        fact: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "{spacing.3}" },
        factLabel: { ...CAPS, flexShrink: "0", fontSize: "10px", letterSpacing: "0.14em", color: "fg.subtle" },
        factValue: { fontFamily: "mono", fontSize: "11px", color: "fg", textAlign: "end", overflowWrap: "anywhere" },
        /* What refused the drafts' apply, or the publish. */
        refusal: { fontSize: "12px", lineHeight: "1.4", color: "fg.danger" },
        foot: {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "{spacing.2}",
            flexShrink: "0",
            paddingX: "20px",
            paddingY: "14px",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            background: "bg.panel",
        },
    },
});
