/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tag slot recipe — pattern_spec/spec.css `.chip` chrome.
 *
 * Slots:
 *  - `root` — outer container (inline-flex + padding + border).
 *  - `label` — text content (body 12.5 / weight 500).
 *  - `closeTrigger` — the trailing dismiss button: Font Awesome's xmark
 *    (#1263), as a chip's remove takes it — 0.8em of the tag's text, its own
 *    width. Chakra's own icon took no size there and drew nothing.
 *
 * Default `variant="outline"` is the spec base chip; `brand` / `dashed`
 * variants follow the spec `.chip.brand` / `.chip.dashed`.
 *
 * A tag given no `colorPalette` draws in the chip's own colours, whatever its
 * variant. A tag given one is `colored` — its renderer passes the variant
 * prop with the palette — and `solid`, `subtle` and `outline` draw in that
 * palette: solid filled with it and its contrast text, subtle on its subtle
 * fill with its text, outline on one 1px rule of it with its text. A colour, a
 * fill or a rule the author sets still wins, as over any variant.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const tagSlotRecipe = defineSlotRecipe({
    className: "elara-tag",
    slots: ["root", "label", "closeTrigger", "startElement", "endElement"],
    base: {
        root: {
            /* A tag's chrome is neutral: each variant names its colours, and
             * only a `colored` tag draws in its palette (the compound variants
             * below). */
            colorPalette: "gray",
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--cr-igap, 6px)",
            fontFamily: "body",
            fontWeight: "medium",
            lineHeight: "1",
            borderRadius: "var(--cr-radius, {radii.sm})",
            borderWidth: "1px",
            paddingX: "{spacing.2}",
            paddingY: "{spacing.1}",
            whiteSpace: "nowrap",
        },
        label: {
            lineHeight: "1",
        },
        closeTrigger: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "fg.subtle",
            cursor: "pointer",
            fontSize: "0.8em",
            "--fa-width": "auto",
            _hover: { color: "fg" },
        },
    },
    variants: {
        variant: {
            outline: {
                root: {
                    background: "bg.surface",
                    borderColor: "border.strong",
                    color: "brand.fg",
                    /* Chakra's outline rings the tag inside, in its palette, as
                     * well: the 1px rule is its one edge. */
                    shadow: "none",
                },
            },
            brand: {
                root: {
                    background: "bg.brand.subtle",
                    borderColor: "border.brand",
                    color: "brand.fg",
                },
            },
            subtle: {
                root: {
                    background: "bg.subtle",
                    borderColor: "transparent",
                    color: "fg",
                },
            },
            dashed: {
                root: {
                    background: "bg.surface",
                    borderStyle: "dashed",
                    borderColor: "border.strong",
                    color: "fg.subtle",
                },
            },
            solid: {
                root: {
                    background: "brand.solid",
                    borderColor: "brand.solid",
                    color: "brand.contrast",
                },
                closeTrigger: { color: "brand.contrast", _hover: { color: "brand.contrast" } },
            },
        },
        size: {
            sm: { root: { fontSize: "11px", paddingX: "{spacing.2}", paddingY: "2px" } },
            md: { root: { fontSize: "var(--cr-fs, {fontSizes.body.sm})", paddingX: "var(--cr-px, 10px)", paddingY: "var(--cr-py, {spacing.1})" } },
            lg: { root: { fontSize: "{fontSizes.body}", paddingX: "{spacing.3}", paddingY: "{spacing.1}" } },
        },
        // Density cascade — values mirror the `chipRail` `--cr-*` sets so a
        // tag with an explicit density matches a rail (and a Trace step) at
        // the same density. No default: an undensified tag keeps the `size`
        // look. Declared after `size` so density wins the merge.
        density: {
            condensed: { root: { fontSize: "9px", lineHeight: "1", paddingX: "7px", paddingY: "2px", borderRadius: "3px", gap: "4px" } },
            compact: { root: { fontSize: "10px", lineHeight: "1", paddingX: "10px", paddingY: "5px", borderRadius: "4px", gap: "5px" } },
            comfortable: { root: { fontSize: "12.5px", lineHeight: "1", paddingX: "15px", paddingY: "9.75px", borderRadius: "6px", gap: "7px" } },
        },
        // A tag given a `colorPalette`: the compound variants draw it there.
        colored: {
            true: {},
        },
    },
    compoundVariants: [
        {
            variant: "solid",
            colored: true,
            css: {
                root: { background: "colorPalette.solid", borderColor: "colorPalette.solid", color: "colorPalette.contrast" },
                closeTrigger: { color: "colorPalette.contrast", _hover: { color: "colorPalette.contrast" } },
            },
        },
        {
            variant: "subtle",
            colored: true,
            css: { root: { background: "colorPalette.subtle", color: "colorPalette.fg" } },
        },
        {
            variant: "outline",
            colored: true,
            css: { root: { borderColor: "colorPalette.border", color: "colorPalette.fg" } },
        },
    ],
    defaultVariants: {
        variant: "outline",
        size: "md",
    },
});
