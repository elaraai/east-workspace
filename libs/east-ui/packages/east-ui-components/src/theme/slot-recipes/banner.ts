/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Banner slot recipe — the design system's Banner (its card, `parts-banner`):
 * one row, its parts centred on it. A 14px mark column — the tone's icon
 * (`triangle-exclamation` in `--warn`, `circle-exclamation` in `--neg`), else
 * its 8px Status dot, a dashed ring for stale data — then its word, mono
 * 10/600/0.12em in capitals in the tone's text step; then the message in the
 * body face at 13 in the ink, anything under it smaller and muted; then its
 * actions at the end, a Link or one Default button (48 tall with one). Min
 * 36, pad 8/12, gap 8, `--r-md`: a solid edge in the valence base over its 6%
 * wash for guard, error and info; a dashed `--rule-strong` edge on `--paper-2`
 * for stale and partial data. The band form runs edge to edge where it
 * qualifies a whole frame, under its toolbar: radius 0, pad 8/20 (8/12 narrow),
 * its rule below only.
 *
 * @packageDocumentation
 */
import { defineSlotRecipe } from "@chakra-ui/react";

/** A solid edge in the valence base over its wash, the mark in the base and the word in the text step. */
const valence = (wash: string, base: string, text: string) => ({
    root: { background: wash, borderColor: base },
    mark: { color: base },
    word: { color: text },
});

/** Stale or partial data: a dashed edge on the second paper. */
const dashed = {
    root: { background: "bg.canvas", borderStyle: "dashed", borderColor: "border.strong" },
    mark: { color: "fg.subtle" },
    word: { color: "fg.muted" },
};

export const bannerSlotRecipe = defineSlotRecipe({
    className: "elara-banner",
    slots: ["root", "mark", "dot", "word", "body", "title", "description", "actions"],
    base: {
        root: {
            display: "flex",
            alignItems: "center",
            // A compact host drops the actions below the message (#349).
            flexWrap: "wrap",
            gap: "{spacing.2}",
            width: "100%",
            minHeight: "36px",
            paddingX: "12px",
            paddingY: "8px",
            borderWidth: "1px",
            borderStyle: "solid",
            borderRadius: "{radii.md}",
            animationName: "banner-in",
            animationDuration: "normal",
            animationTimingFunction: "out",
            _motionReduce: { animationName: "none" },
        },
        mark: { flex: "none", width: "14px", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "14px" },
        dot: { width: "8px", height: "8px", borderRadius: "full", background: "currentColor" },
        word: { flex: "none", textStyle: "eyebrow", whiteSpace: "nowrap" },
        body: { flex: "1", minWidth: "0" },
        title: { fontSize: "{fontSizes.body}", lineHeight: "20px", color: "fg", overflowWrap: "anywhere" },
        description: { textStyle: "body.sm", color: "fg.muted", overflowWrap: "anywhere" },
        // Its actions in the brand's palette.
        actions: { flex: "none", display: "flex", alignItems: "center", gap: "{spacing.2}", marginInlineStart: "auto", colorPalette: "brand" },
    },
    variants: {
        tone: {
            guard: valence("status.warnSubtle", "status.warn", "fg.warning"),
            error: valence("status.negSubtle", "status.neg", "fg.danger"),
            info: valence("status.infoSubtle", "status.info", "fg.info"),
            success: valence("status.posSubtle", "status.pos", "fg.success"),
            change: valence("bg.brand.subtle", "border.brand", "brandPressed"),
            elara: valence("color-mix(in oklch, {colors.elara} 6%, {colors.bg.surface})", "elara.ink", "elara.ink"),
            partial: dashed,
            stale: { ...dashed, dot: { background: "transparent", borderWidth: "1px", borderStyle: "dashed", borderColor: "fg.subtle" } },
        },
        form: {
            card: {},
            band: {
                root: {
                    borderWidth: "0 0 1px",
                    borderRadius: "0",
                    paddingX: "20px",
                    "@media (max-width: 479px)": { paddingX: "12px" },
                },
            },
        },
    },
    defaultVariants: { tone: "info", form: "card" },
});
