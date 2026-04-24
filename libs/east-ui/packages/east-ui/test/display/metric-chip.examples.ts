/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, example } from "@elaraai/east";
import { MetricChip, Text, UIComponentType } from "../../src/index.js";

export const metricChipPositive = example({
    keywords: ["MetricChip", "Root", "tone", "positive", "delta"],
    description: "Positive metric chip with subtle emphasis",
    fn: East.function([], UIComponentType, ($) => {
        return MetricChip.Root(Text.Root("+12.5%"), "positive", { emphasis: "subtle" });
    }),
    inputs: [],
});

export const metricChipNegativeSolid = example({
    keywords: ["MetricChip", "Root", "tone", "negative", "solid"],
    description: "Negative metric chip rendered with solid emphasis",
    fn: East.function([], UIComponentType, ($) => {
        return MetricChip.Root(Text.Root("-8.2%"), "negative", { emphasis: "solid" });
    }),
    inputs: [],
});

export const metricChipNeutralOutline = example({
    keywords: ["MetricChip", "Root", "tone", "neutral", "outline"],
    description: "Neutral metric chip with outline emphasis and unit",
    fn: East.function([], UIComponentType, ($) => {
        return MetricChip.Root(Text.Root("42"), "neutral", { emphasis: "outline", unit: "ms" });
    }),
    inputs: [],
});

export const metricChipInfo = example({
    keywords: ["MetricChip", "Root", "tone", "info"],
    description: "Informational metric chip with custom colour slots",
    fn: East.function([], UIComponentType, ($) => {
        return MetricChip.Root(Text.Root("Forecast"), "info", {
            background: "blue.100",
            color: "blue.800",
            borderColor: "blue.300",
        });
    }),
    inputs: [],
});
