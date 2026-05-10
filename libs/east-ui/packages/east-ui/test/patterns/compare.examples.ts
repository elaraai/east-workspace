/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Compare-mode pattern *drafts* — compositions over existing east-ui
 * primitives. These shake out the visual direction before the IR
 * factories ship in `east-ui-patterns`. Each example is a self-contained
 * East program — no TS helpers, no escape hatches into Chakra.
 *
 * Patterns covered: DeltaPill · ContextSelector · VersusHeader · DiffView.
 */

import { East, example, variant } from "@elaraai/east";
import {
    Box,
    Card,
    Heading,
    Icon,
    MetricChip,
    Menu,
    Numeric,
    NumericFormatType,
    Stack,
    Tag,
    Text,
    UIComponentType,
} from "../../src/index.js";

// ============================================================================
// DeltaPill — compose `MetricChip` with a paired direction icon + mono value.
// Tone is pre-resolved from magnitude × direction.
// ============================================================================

export const deltaPillRevenueUp = example({
    keywords: ["DeltaPill", "compare", "positive", "higher-is-better"],
    description: "Revenue up vs baseline · higher-is-better → positive tone",
    fn: East.function([], UIComponentType, (_$) => {
        return MetricChip.Root(
            Stack.HStack([
                Icon.Root("fas", "caret-up", { size: "xs" }),
                Numeric.Root(3.2, { textStyle: "mono-kpi", showSign: true }),
                Text.Root("(+4.1%)", { textStyle: "caption" }),
            ], { gap: "1.5", align: "center" }),
            "positive",
            { emphasis: "subtle" },
        );
    }),
    inputs: [],
});

export const deltaPillDefectsDown = example({
    keywords: ["DeltaPill", "compare", "lower-is-better", "positive"],
    description: "Defect rate down · lower-is-better → positive tone",
    fn: East.function([], UIComponentType, (_$) => {
        return MetricChip.Root(
            Stack.HStack([
                Icon.Root("fas", "caret-down", { size: "xs" }),
                Numeric.Root(-0.008, {
                    textStyle: "mono-kpi",
                    format: East.value(variant("Percent", {
                        minimumFractionDigits: variant("none", null),
                        maximumFractionDigits: variant("some", 1n),
                        signDisplay: variant("some", variant("exceptZero", null)),
                    }), NumericFormatType),
                }),
            ], { gap: "1.5", align: "center" }),
            "positive",
            { emphasis: "subtle" },
        );
    }),
    inputs: [],
});

export const deltaPillOffTarget = example({
    keywords: ["DeltaPill", "compare", "target-is-best", "negative"],
    description: "Off-target vs tolerance band · target-is-best → negative tone",
    fn: East.function([], UIComponentType, (_$) => {
        return MetricChip.Root(
            Stack.HStack([
                Icon.Root("fas", "caret-up", { size: "xs" }),
                Numeric.Root(112.4, { textStyle: "mono-kpi" }),
                Text.Root("(target 100, ±5)", { textStyle: "caption" }),
            ], { gap: "1.5", align: "center" }),
            "negative",
            { emphasis: "subtle" },
        );
    }),
    inputs: [],
});

export const deltaPillInsignificant = example({
    keywords: ["DeltaPill", "compare", "significant", "muted"],
    description: "Below significance threshold · neutral tone with asterisk marker",
    fn: East.function([], UIComponentType, (_$) => {
        return MetricChip.Root(
            Stack.HStack([
                Icon.Root("fas", "caret-up", { size: "xs" }),
                Numeric.Root(0.3, { textStyle: "mono-kpi", showSign: true }),
                Text.Root("(p>0.05) ∗", { textStyle: "caption" }),
            ], { gap: "1.5", align: "center" }),
            "neutral",
            { emphasis: "subtle" },
        );
    }),
    inputs: [],
});

export const deltaPillWithCi = example({
    keywords: ["DeltaPill", "compare", "ci", "confidence"],
    description: "Delta with confidence-interval suffix",
    fn: East.function([], UIComponentType, (_$) => {
        return MetricChip.Root(
            Stack.HStack([
                Icon.Root("fas", "caret-up", { size: "xs" }),
                Numeric.Root(2.1, { textStyle: "mono-kpi", showSign: true }),
                Text.Root("± [0.5..3.7]", { textStyle: "caption" }),
            ], { gap: "1.5", align: "center" }),
            "positive",
            { emphasis: "subtle" },
        );
    }),
    inputs: [],
});

export const deltaPillFlat = example({
    keywords: ["DeltaPill", "compare", "flat", "neutral"],
    description: "Flat delta · neutral regardless of magnitude",
    fn: East.function([], UIComponentType, (_$) => {
        return MetricChip.Root(
            Stack.HStack([
                Icon.Root("fas", "minus", { size: "xs" }),
                Numeric.Root(0.0, { textStyle: "mono-kpi" }),
            ], { gap: "1.5", align: "center" }),
            "neutral",
            { emphasis: "subtle" },
        );
    }),
    inputs: [],
});

export const deltaPillGallery = example({
    keywords: ["DeltaPill", "compare", "gallery", "matrix"],
    description: "Six-up gallery — magnitude × direction × significance × CI matrix",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            MetricChip.Root(
                Stack.HStack([
                    Icon.Root("fas", "caret-up", { size: "xs" }),
                    Numeric.Root(3.2, { textStyle: "mono-kpi", showSign: true }),
                    Text.Root("(+4.1%)", { textStyle: "caption" }),
                ], { gap: "1.5", align: "center" }),
                "positive",
                { emphasis: "subtle" },
            ),
            MetricChip.Root(
                Stack.HStack([
                    Icon.Root("fas", "caret-down", { size: "xs" }),
                    Numeric.Root(-0.8, { textStyle: "mono-kpi" }),
                    Text.Root("%", { textStyle: "caption" }),
                ], { gap: "1.5", align: "center" }),
                "positive",
                { emphasis: "subtle" },
            ),
            MetricChip.Root(
                Stack.HStack([
                    Icon.Root("fas", "caret-up", { size: "xs" }),
                    Numeric.Root(12.4, { textStyle: "mono-kpi", showSign: true }),
                ], { gap: "1.5", align: "center" }),
                "negative",
                { emphasis: "subtle" },
            ),
            MetricChip.Root(
                Stack.HStack([
                    Icon.Root("fas", "caret-up", { size: "xs" }),
                    Numeric.Root(0.3, { textStyle: "mono-kpi", showSign: true }),
                    Text.Root("(p>0.05) ∗", { textStyle: "caption" }),
                ], { gap: "1.5", align: "center" }),
                "neutral",
                { emphasis: "subtle" },
            ),
            MetricChip.Root(
                Stack.HStack([
                    Icon.Root("fas", "caret-up", { size: "xs" }),
                    Numeric.Root(2.1, { textStyle: "mono-kpi", showSign: true }),
                    Text.Root("± [0.5..3.7]", { textStyle: "caption" }),
                ], { gap: "1.5", align: "center" }),
                "positive",
                { emphasis: "subtle" },
            ),
            MetricChip.Root(
                Stack.HStack([
                    Icon.Root("fas", "minus", { size: "xs" }),
                    Numeric.Root(0.0, { textStyle: "mono-kpi" }),
                ], { gap: "1.5", align: "center" }),
                "neutral",
                { emphasis: "subtle" },
            ),
        ], { gap: "3", wrap: "wrap" });
    }),
    inputs: [],
});

// ============================================================================
// ContextSelector — labelled chip + Menu picker.
// ============================================================================

export const contextSelectorScenario = example({
    keywords: ["ContextSelector", "compare", "scenario", "menu"],
    description: "Scenario picker · label + Menu trigger with rich items",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("Scenario", { textStyle: "label-sm", color: "fg.muted" }),
            Menu.Root(
                Tag.Root("Baseline ▾", { variant: "outline", colorPalette: "gray" }),
                [
                    Menu.Item("baseline", "Baseline · last quarter actuals"),
                    Menu.Item("optimised", "Optimised · solver recommendation"),
                    Menu.Item("conservative", "Conservative · ±5% bounds"),
                    Menu.Separator(),
                    Menu.Item("custom", "Custom…"),
                ],
                { placement: "bottom-start" },
            ),
        ], { gap: "2", align: "center" });
    }),
    inputs: [],
});

// ============================================================================
// VersusHeader — A vs B side-by-side card with per-side accent stripe and
// a delta slot (here populated with a DeltaPill-shaped MetricChip).
// ============================================================================

export const versusHeaderScenarioCompare = example({
    keywords: ["VersusHeader", "compare", "scenario", "delta"],
    description: "Scenario A vs Scenario B with delta pill slot and per-side accent",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Stack.HStack([
                Stack.HStack([
                    Box.Root([], { width: "3px", height: "48px", background: "blue.500", borderRadius: "full" }),
                        Stack.VStack([
                            Text.Root("A — Baseline", { textStyle: "label-sm", color: "fg.muted" }),
                            Numeric.Root(8420, {
                                textStyle: "mono-kpi",
                                format: East.value(variant("Currency", {
                                    currency: variant("AUD", null),
                                    display: variant("some", variant("symbol", null)),
                                    compact: variant("some", variant("short", null)),
                                    minimumFractionDigits: variant("none", null),
                                    maximumFractionDigits: variant("none", null),
                                }), NumericFormatType),
                            }),
                        ], { gap: "0.5", align: "flex-start" }),
                    ], { gap: "3", align: "center" }),
                    Text.Root("vs", { textStyle: "label-sm", color: "fg.muted" }),
                    Stack.HStack([
                        Box.Root([], { width: "3px", height: "48px", background: "pink.500", borderRadius: "full" }),
                        Stack.VStack([
                            Text.Root("B — Optimised", { textStyle: "label-sm", color: "fg.muted" }),
                            Numeric.Root(7380, {
                                textStyle: "mono-kpi",
                                format: East.value(variant("Currency", {
                                    currency: variant("AUD", null),
                                    display: variant("some", variant("symbol", null)),
                                    compact: variant("some", variant("short", null)),
                                    minimumFractionDigits: variant("none", null),
                                    maximumFractionDigits: variant("none", null),
                                }), NumericFormatType),
                            }),
                        ], { gap: "0.5", align: "flex-start" }),
                    ], { gap: "3", align: "center" }),
                    Box.Root([
                        MetricChip.Root(
                            Stack.HStack([
                                Icon.Root("fas", "caret-down", { size: "xs" }),
                                Numeric.Root(-1040, {
                                    textStyle: "mono-kpi",
                                    format: East.value(variant("Currency", {
                                        currency: variant("AUD", null),
                                        display: variant("some", variant("symbol", null)),
                                        compact: variant("none", null),
                                        minimumFractionDigits: variant("none", null),
                                        maximumFractionDigits: variant("none", null),
                                    }), NumericFormatType),
                                }),
                            ], { gap: "1.5", align: "center" }),
                            "positive",
                            { emphasis: "subtle" },
                        ),
                    ]),
                ], { gap: "8", align: "center", justify: "space-between" }),
        ]);
    }),
    inputs: [],
});

// ============================================================================
// DiffView — recursive render keyed on `PatchTypeOf<T>` variant tags
// (`unchanged | replace | patch`). Drafts cover Struct.patch with `replace`
// rows and Array.patch with delete / update / insert rows.
// ============================================================================

export const diffViewStructSimple = example({
    keywords: ["DiffView", "compare", "struct", "patch", "replace"],
    description: "Struct with two changed fields rendered as before → after rows",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Stack.VStack([
                Stack.HStack([
                    Text.Root("name", { textStyle: "code-sm", color: "fg.muted", width: "200px" }),
                    Box.Root([Text.Root('"Baseline"', { textStyle: "code-sm" })], {
                        background: "red.50",
                        borderColor: "red.200",
                        borderWidth: "thin",
                        borderRadius: "sm",
                        padding: "2",
                    }),
                    Text.Root("→", { color: "fg.muted" }),
                    Box.Root([Text.Root('"Optimised"', { textStyle: "code-sm" })], {
                        background: "green.50",
                        borderColor: "green.200",
                        borderWidth: "thin",
                        borderRadius: "sm",
                        padding: "2",
                    }),
                ], { gap: "2", align: "center" }),
                Stack.HStack([
                    Text.Root("budget.cap", { textStyle: "code-sm", color: "fg.muted", width: "200px" }),
                    Box.Root([Text.Root("10000", { textStyle: "code-sm" })], {
                        background: "red.50",
                        borderColor: "red.200",
                        borderWidth: "thin",
                        borderRadius: "sm",
                        padding: "2",
                    }),
                    Text.Root("→", { color: "fg.muted" }),
                    Box.Root([Text.Root("8500", { textStyle: "code-sm" })], {
                        background: "green.50",
                        borderColor: "green.200",
                        borderWidth: "thin",
                        borderRadius: "sm",
                        padding: "2",
                    }),
                ], { gap: "2", align: "center" }),
                Text.Root("3 unchanged fields hidden", { textStyle: "caption", color: "fg.muted" }),
            ], { gap: "2", align: "stretch" }),
        ], {
            header: Heading.Root("Scenario.config — patch", { textStyle: "heading-sm" }),
        });
    }),
    inputs: [],
});

export const diffViewArrayOps = example({
    keywords: ["DiffView", "compare", "array", "patch", "delete", "insert", "update"],
    description: "Array.patch with delete / update / insert ops — no Move",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Stack.VStack([
                    Stack.HStack([
                        Tag.Root("delete", { variant: "subtle", colorPalette: "red", size: "sm" }),
                        Box.Root([Text.Root('"deprecated"', { textStyle: "code-sm" })], {
                            background: "red.50",
                            borderColor: "red.200",
                            borderWidth: "thin",
                            borderRadius: "sm",
                            padding: "2",

                        }),
                    ], { gap: "2", align: "center" }),
                    Stack.HStack([
                        Tag.Root("update", { variant: "subtle", colorPalette: "yellow", size: "sm" }),
                        Box.Root([Text.Root('"v1" → "v1.1"', { textStyle: "code-sm" })], {
                            background: "yellow.50",
                            borderColor: "yellow.200",
                            borderWidth: "thin",
                            borderRadius: "sm",
                            padding: "2",

                        }),
                    ], { gap: "2", align: "center" }),
                    Stack.HStack([
                        Tag.Root("insert", { variant: "subtle", colorPalette: "green", size: "sm" }),
                        Box.Root([Text.Root('"prod-eu"', { textStyle: "code-sm" })], {
                            background: "green.50",
                            borderColor: "green.200",
                            borderWidth: "thin",
                            borderRadius: "sm",
                            padding: "2",

                        }),
                    ], { gap: "2", align: "center" }),
            ], { gap: "2", align: "stretch" }),
        ], {
            header: Heading.Root("items[*] — Array.patch", { textStyle: "heading-sm" }),
        });
    }),
    inputs: [],
});
