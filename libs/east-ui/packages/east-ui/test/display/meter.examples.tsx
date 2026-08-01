/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Meter, Separator, Stack, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const meterBasic = example({
    keywords: ["Meter", "Root", "value"],
    description: "Basic meter at 60% with default styling",
    fn: East.function([], UIComponentType, ($) => {
        return <Meter value={60.0} />;
    }),
    inputs: [],
});

// ============================================================================
// Meter — tones, densities, custom max (variant panel)
// ============================================================================

export const meterVariants = example({
    keywords: ["Meter", "Root", "tone", "success", "warning", "thickness", "density", "condensed", "compact", "comfortable", "sizes", "max", "custom"],
    description: "Meter variant panel — success (meter with success tone and label), warning (meter with warning tone and large thickness), densities (the three densities stacked — track height + value text scale condensed → compact → comfortable, matching ChipRail), custom max (meter with custom max and explicit colour slots)",
    fn: East.function([], UIComponentType, ($) => {
        const condensed = $.const(<Meter value={72.0} tone="success" density="condensed" />);
        const compact = $.const(<Meter value={72.0} tone="success" density="compact" />);
        const comfortable = $.const(<Meter value={72.0} tone="success" density="comfortable" />);
        return (
            <VStack gap="4" align="stretch">
                <Separator label="SUCCESS" align="start" />
                <Meter value={85.0} tone="success" label={<Text>Uptime</Text>} />
                <Separator label="WARNING" align="start" />
                <Meter value={42.0} tone="warning" thickness="lg" />
                <Separator label="DENSITIES" align="start" />
                <Stack direction="column" gap="6">
                    {condensed}
                    {compact}
                    {comfortable}
                </Stack>
                <Separator label="CUSTOM MAX" align="start" />
                <Meter value={350.0} max={500.0} fillColor="purple.500" trackColor="purple.100" />
            </VStack>
        );
    }),
    inputs: [],
});
