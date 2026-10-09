/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Chip recipe — spec `.chip`.
 *
 * A neutral inline chip: paper surface, 1 px `rule-strong` border, 4 px
 * radius, body type. Counts and values inside use mono via the `numeric`
 * variant. The only tonal escape hatches are `brand` (brand-tint fill),
 * `dashed`, and `warn` — an advisory count, the Plan's overlaps and the
 * Calendar's conflicts (#1198), in the warn rule over its 6% wash with its text
 * step, as the design system draws an advisory readout. Saturated red/green
 * chips are not part of the vocabulary; carry +/− semantics on the glyph or
 * text colour instead.
 *
 * Nothing is pill-shaped (`component-rules.md` §3, #949): a chip keeps its
 * 4px radius at every density. A control's own label (`+ FILTER`) takes the
 * `caps` variant — the toolbar's mono uppercase label voice. Numerals set in
 * mono at most 11.5px: mono runs larger than the body face at the same size,
 * so a value never reads as the loudest text beside its body-type siblings.
 *
 * A chip's own parts are styled here, by attribute, never inline: a leading
 * icon (`data-chip-icon`), the disclosure caret (`data-chip-caret`), a
 * muted meta word such as a day count (`data-chip-meta`), and a clause's
 * remove (`data-chip-remove`) — the pointer's, in the link's ink (#1231). The
 * icon, the caret and the remove are Font Awesome's — the caret its caret-down,
 * the remove its xmark — never a text glyph (#1263). The caret and the remove
 * take their own width (`--fa-width: auto`), never Font Awesome 7's fixed
 * 1.25em, so each is as wide as the glyph it replaced and the chip keeps its
 * width: the caret, 5px at its 8px; the remove, at 0.8em, the mono `×`'s 0.6em
 * (the xmark is three quarters as wide as it is tall). The leading icon was
 * Font Awesome's already, and keeps its width.
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
        /* A rail chip's text is `--ink-2`; the brand tone's is `--brand-dd`
         * (base-components › Toolbar & slice). */
        color: "fg.strong",
        whiteSpace: "nowrap",
        lineHeight: "1",
        fontVariantNumeric: "tabular-nums",
        "& [data-chip-icon]": { fontSize: "10px" },
        "& [data-chip-caret]": { fontSize: "8px", "--fa-width": "auto" },
        "& [data-chip-meta]": { color: "fg.muted" },
        "& [data-chip-remove]": { color: "link", cursor: "pointer", flexShrink: "0", fontSize: "0.8em", "--fa-width": "auto" },
    },
    variants: {
        tone: {
            neutral: {},
            brand: { background: "bg.brand.subtle", borderColor: "border.brand", color: "brand.fg" },
            dashed: { borderStyle: "dashed", color: "fg.subtle" },
            /** Overflow `+M more` chip — paper fill, brand border, bold (spec `.more-chip`). */
            more: { background: "bg.surface", borderColor: "brand.solid", color: "brand.fg", fontWeight: "bold" },
            /** An advisory count (#1198) — the warn rule over its 6% wash, in the warn text step. */
            warn: { background: "bg.warning.subtle", borderColor: "status.warn", color: "fg.warning" },
        },
        numeric: {
            true: { fontFamily: "mono", fontSize: "min(var(--cr-fs, 12px), 11.5px)" },
            false: {},
        },
        /** Corner shape — the 4px `.chip`; the design system has no pill. */
        shape: {
            rounded: { borderRadius: "4px" },
        },
        /** A control's own label — mono 10.5 / 600, uppercase, tracked. */
        caps: {
            true: { fontFamily: "mono", fontSize: "10.5px", fontWeight: "semibold", letterSpacing: "0.08em", textTransform: "uppercase" },
            false: {},
        },
        size: {
            sm: { fontSize: "11.5px", paddingInline: "8px", paddingBlock: "3px" },
            md: {},
        },
    },
    defaultVariants: { tone: "neutral", numeric: false, shape: "rounded", caps: false, size: "md" },
});
