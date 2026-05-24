/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Stat slot recipe — pattern_spec/spec.css `.cell` data-rail.
 *
 * Label: `caption.eyebrow` (mono 10 / 600 / 0.18 em / uppercase).
 * Value: `mono.kpi` (mono / 24 px / 600 / tight / tabular-nums).
 * HelpText: `mono.tabular.sm` muted body-sized numerics.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const statSlotRecipe = defineSlotRecipe({
    className: "elara-stat",
    slots: ["root", "label", "valueText", "valueUnit", "helpText", "indicator"],
    base: {
        root: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.1}",
        },
        label: {
            textStyle: "caption.eyebrow",
        },
        valueText: {
            fontFamily: "heading",
            fontWeight: "bold",
            letterSpacing: "-0.01em",
            fontVariantNumeric: "tabular-nums",
            color: "fg",
            lineHeight: "1",
        },
        valueUnit: {
            fontFamily: "mono",
            fontSize: "{fontSizes.sm}",
            color: "fg.muted",
            marginLeft: "{spacing.1}",
        },
        helpText: {
            textStyle: "mono.tabular.sm",
            color: "fg.muted",
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.1}",
        },
        indicator: {
            display: "inline-flex",
            alignItems: "center",
        },
    },
    variants: {
        size: {
            sm: { valueText: { fontSize: "{fontSizes.xl}" } },     // 20px
            md: { valueText: { fontSize: "26px" } },               // spec scorecard sc-val
            lg: { valueText: { fontSize: "{fontSizes.4xl}" } },    // 36px
        },
    },
    defaultVariants: {
        size: "md",
    },
});
