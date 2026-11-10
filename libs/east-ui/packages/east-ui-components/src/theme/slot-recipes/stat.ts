/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Stat slot recipe — pattern_spec/spec.css `.cell` data-rail.
 *
 * Label: `caption.eyebrow` (mono 11 / 600 / 0.18 em / uppercase).
 * Value: the design system's large number (`num-lg`: mono, tabular, 600) at
 * the size variant — 20 (sm) or 26 (md, lg; `--fs-num`). Unit: mono 10.5 (the
 * design system's unit suffix).
 * HelpText: `mono.tabular.sm` muted numerics.
 * Indicator: Font Awesome's caret (#1263) in the 1em square Chakra's arrow
 * took — Chakra sizes its height, `--fa-width` its width.
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
        // Chakra's own stat sets its tracking and proportional figures outright, and a text style's own
        // yield to those: they are the large number's again here.
        valueText: {
            textStyle: "num-lg",
            letterSpacing: "normal",
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
            color: "fg",
        },
        valueUnit: {
            fontFamily: "mono",
            fontSize: "{fontSizes.label.md}",
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
            "--fa-width": "1em",
        },
    },
    variants: {
        // Each size restates the large number: Chakra's own stat sets a text style of its own in each.
        size: {
            sm: { valueText: { textStyle: "num-lg", fontSize: "{fontSizes.title.lg}" } },   // 20px
            md: { valueText: { textStyle: "num-lg", fontSize: "{fontSizes.num}" } },        // 26px — the large number
            lg: { valueText: { textStyle: "num-lg", fontSize: "{fontSizes.num}" } },        // 26px — no larger number exists
        },
        // Density cascade — value/label/help text tighten with the
        // chipRail/trace rhythm so a stat block shares a surface with chips
        // and traces without dwarfing them. No default: an undensified stat
        // keeps the `size` look. Declared after `size` so density wins the
        // merge.
        density: {
            condensed: {
                root: { gap: "2px" },
                valueText: { fontSize: "14px" },
                label: { fontSize: "8.5px" },
                helpText: { fontSize: "9px" },
            },
            compact: {
                root: { gap: "3px" },
                valueText: { fontSize: "18px" },
                label: { fontSize: "9.5px" },
                helpText: { fontSize: "10px" },
            },
            comfortable: {
                root: { gap: "{spacing.1}" },
                valueText: { fontSize: "26px" },
                label: { fontSize: "11px" },
                helpText: { fontSize: "12.5px" },
            },
        },
    },
    defaultVariants: {
        size: "md",
    },
});
