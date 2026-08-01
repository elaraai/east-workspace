/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { MetricChip, Separator, Stack, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const metricChipBasic = example({
    keywords: ["MetricChip", "Root", "tone", "positive", "delta", "basic"],
    description: "Positive metric chip with subtle emphasis",
    fn: East.function([], UIComponentType, ($) => {
        return <MetricChip tone="positive" emphasis="subtle"><Text>+12.5%</Text></MetricChip>;
    }),
    inputs: [],
});

// ============================================================================
// MetricChip — tones, emphases, densities, colour slots (variant panel)
// ============================================================================

export const metricChipVariants = example({
    keywords: ["MetricChip", "Root", "tone", "negative", "solid", "neutral", "outline", "density", "condensed", "compact", "comfortable", "sizes", "info"],
    description: "MetricChip variant panel — chip negative solid (negative metric chip rendered with solid emphasis), chip neutral outline (neutral metric chip with outline emphasis and unit), chip densities (the three densities stacked — chip height + font scale condensed → compact → comfortable, matching ChipRail), chip info (informational metric chip with custom colour slots)",
    fn: East.function([], UIComponentType, ($) => {
        const condensed = $.const(<MetricChip tone="positive" density="condensed"><Text>+12.5%</Text></MetricChip>);
        const compact = $.const(<MetricChip tone="positive" density="compact"><Text>+12.5%</Text></MetricChip>);
        const comfortable = $.const(<MetricChip tone="positive" density="comfortable"><Text>+12.5%</Text></MetricChip>);
        return (
            <VStack gap="4" align="stretch">
                <Separator label="CHIP NEGATIVE SOLID" align="start" />
                <MetricChip tone="negative" emphasis="solid"><Text>-8.2%</Text></MetricChip>
                <Separator label="CHIP NEUTRAL OUTLINE" align="start" />
                <MetricChip tone="neutral" emphasis="outline" unit="ms"><Text>42</Text></MetricChip>
                <Separator label="CHIP DENSITIES" align="start" />
                <Stack direction="column" gap="6">
                    {condensed}
                    {compact}
                    {comfortable}
                </Stack>
                <Separator label="CHIP INFO" align="start" />
                <MetricChip tone="info" background="blue.100" color="blue.800" borderColor="blue.300">
                    <Text>Forecast</Text>
                </MetricChip>
            </VStack>
        );
    }),
    inputs: [],
});
