/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Chip recipe — spec `.chip`.
 *
 * A neutral inline pill: paper surface, 1 px `rule-strong` border, 4 px
 * radius, body type. Counts and values inside use mono via the `numeric`
 * variant. The only tonal escape hatches are `brand` (brand-tint fill) and
 * `dashed` — saturated red/green chips are not part of the vocabulary; carry
 * +/− semantics on the glyph or text colour instead.
 */

import { defineRecipe } from "@chakra-ui/react";

export const chipRecipe = defineRecipe({
    className: "elara-chip",
    base: {
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--cr-igap, 6px)",
        fontFamily: "body",
        fontSize: "var(--cr-fs, 12px)",
        fontWeight: "medium",
        paddingInline: "var(--cr-px, 10px)",
        paddingBlock: "var(--cr-py, 4px)",
        borderRadius: "var(--cr-radius, 4px)",
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "border.strong",
        background: "bg.surface",
        color: "{colors.brand.700}",
        whiteSpace: "nowrap",
        lineHeight: "1",
        fontVariantNumeric: "tabular-nums",
    },
    variants: {
        tone: {
            neutral: {},
            brand: { background: "bg.brand.subtle", borderColor: "border.brand", color: "{colors.brand.700}" },
            dashed: { borderStyle: "dashed", color: "fg.subtle" },
            /** Overflow `+M more` pill — paper fill, brand border, bold (spec `.more-chip`). */
            more: { background: "bg.surface", borderColor: "{colors.brand.600}", color: "{colors.brand.700}", fontWeight: "bold" },
        },
        numeric: {
            true: { fontFamily: "mono" },
            false: {},
        },
        /** Corner shape — `rounded` is the 4px `.chip`; `pill` is the 9999px eyebrow chip. */
        shape: {
            rounded: { borderRadius: "4px" },
            pill: { borderRadius: "9999px" },
        },
        size: {
            sm: { fontSize: "11.5px", paddingInline: "8px", paddingBlock: "3px" },
            md: {},
        },
    },
    defaultVariants: { tone: "neutral", numeric: false, shape: "rounded", size: "md" },
});
