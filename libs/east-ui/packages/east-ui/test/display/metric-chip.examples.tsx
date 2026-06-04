/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { MetricChip, Text } from "@elaraai/east-ui/jsx";

export const metricChipPositive = example({
    keywords: ["MetricChip", "Root", "tone", "positive", "delta"],
    description: "Positive metric chip with subtle emphasis",
    fn: East.function([], UIComponentType, ($) => {
        return <MetricChip tone="positive" emphasis="subtle"><Text>+12.5%</Text></MetricChip>;
    }),
    inputs: [],
});

export const metricChipNegativeSolid = example({
    keywords: ["MetricChip", "Root", "tone", "negative", "solid"],
    description: "Negative metric chip rendered with solid emphasis",
    fn: East.function([], UIComponentType, ($) => {
        return <MetricChip tone="negative" emphasis="solid"><Text>-8.2%</Text></MetricChip>;
    }),
    inputs: [],
});

export const metricChipNeutralOutline = example({
    keywords: ["MetricChip", "Root", "tone", "neutral", "outline"],
    description: "Neutral metric chip with outline emphasis and unit",
    fn: East.function([], UIComponentType, ($) => {
        return <MetricChip tone="neutral" emphasis="outline" unit="ms"><Text>42</Text></MetricChip>;
    }),
    inputs: [],
});

export const metricChipInfo = example({
    keywords: ["MetricChip", "Root", "tone", "info"],
    description: "Informational metric chip with custom colour slots",
    fn: East.function([], UIComponentType, ($) => {
        return (
            <MetricChip tone="info" background="blue.100" color="blue.800" borderColor="blue.300">
                <Text>Forecast</Text>
            </MetricChip>
        );
    }),
    inputs: [],
});
