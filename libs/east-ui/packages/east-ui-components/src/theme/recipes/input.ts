/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Input recipe — enforces the canonical input shape.
 *
 *  - 4 px radius (spec `--r-sm`), 1 px subtle border.
 *  - Focus: brand-500 border + 3 px brand-tinted box-shadow.
 *  - Error: muted-danger border. Helper text becomes danger ink.
 *  - Variant `numeric` switches font to mono + right-align (used inside
 *    parameter forms, matrix cells, KPI inputs).
 *  - Variant `dirty` highlights uncommitted edits (matrix dirty cells).
 *  - Always paired with a static `<label>` above. No floating labels.
 *
 * @packageDocumentation
 */

import { defineRecipe } from "@chakra-ui/react";

export const inputRecipe = defineRecipe({
    className: "elara-input",
    base: {
        fontFamily: "body",
        fontSize: "{fontSizes.sm}",   // 14 px
        background: "bg.surface",
        color: "fg",
        borderRadius: "{radii.sm}",    // 4 px (spec)
        borderWidth: "1px",
        borderColor: "border.subtle",  // gray.200 (spec rule)
        paddingX: "{spacing.3}",       // 12 px
        paddingY: "{spacing.2}",       // 8 px → ~32 px hit-target with 14 px body
        outline: "none",
        transitionProperty: "border-color, box-shadow, background",
        transitionDuration: "{durations.fast}",
        transitionTimingFunction: "{easings.out}",
        _placeholder: { color: "fg.subtle" },
        _hover: { borderColor: "border.strong" },
        _focusVisible: {
            borderColor: "{colors.brand.500}",
            boxShadow: "none",
        },
        _invalid: {
            borderColor: "fg.danger",
            _focusVisible: {
                borderColor: "fg.danger",
                boxShadow: "none",
            },
        },
        _disabled: {
            background: "bg.subtle",
            color: "fg.muted",
            cursor: "not-allowed",
        },
    },
    variants: {
        variant: {
            default: {},
            /** Mono + right-aligned for numeric form rows. */
            numeric: {
                fontFamily: "mono",
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
                fontFeatureSettings: '"tnum"',
            },
            /** Uncommitted edit — spec `.mx-num.dirty` */
            dirty: {
                background: "warning.subtle.strong",
                boxShadow: "inset 2px 0 0 {colors.fg.warning}",
                fontWeight: "semibold",
                color: "fg",
            },
            /** Borderless variant for command-palette input strips. */
            flushed: {
                borderWidth: "0",
                borderRadius: "0",
                paddingX: "0",
                borderBottomWidth: "1px",
                borderBottomColor: "border.subtle",
                _focusVisible: {
                    borderBottomColor: "{colors.brand.500}",
                    boxShadow: "none",
                },
            },
        },
        size: {
            sm: { fontSize: "{fontSizes.xs}" /* 12 */, paddingX: "{spacing.2}", paddingY: "{spacing.1}" },
            md: { fontSize: "{fontSizes.sm}" /* 14 */, paddingX: "{spacing.3}", paddingY: "{spacing.2}" },
            lg: { fontSize: "{fontSizes.md}" /* 16 */, paddingX: "{spacing.4}", paddingY: "{spacing.3}" },
        },
    },
    defaultVariants: {
        variant: "default",
        size: "md",
    },
});
