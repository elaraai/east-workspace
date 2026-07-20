/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tag slot recipe — pattern_spec/spec.css `.chip` chrome.
 *
 * Slots:
 *  - `root` — outer container (inline-flex + padding + border).
 *  - `label` — text content (body 12 / weight 500).
 *  - `closeTrigger` — the trailing × dismiss button.
 *
 * Default `variant="outline"` is the spec base chip; `brand` / `dashed`
 * variants follow the spec `.chip.brand` / `.chip.dashed`.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const tagSlotRecipe = defineSlotRecipe({
    className: "elara-tag",
    slots: ["root", "label", "closeTrigger", "startElement", "endElement"],
    base: {
        root: {
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
                    background: "{colors.brand.600}",
                    borderColor: "{colors.brand.600}",
                    color: "white",
                },
                closeTrigger: { color: "white", _hover: { color: "white" } },
            },
        },
        size: {
            sm: { root: { fontSize: "11px", paddingX: "{spacing.2}", paddingY: "2px" } },
            md: { root: { fontSize: "var(--cr-fs, {fontSizes.xs})", paddingX: "var(--cr-px, 10px)", paddingY: "var(--cr-py, {spacing.1})" } },
            lg: { root: { fontSize: "{fontSizes.control}", paddingX: "{spacing.3}", paddingY: "{spacing.1}" } },
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
    },
    defaultVariants: {
        variant: "outline",
        size: "md",
    },
});
