/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Meter, Stack, Text } from "@elaraai/east-ui";

export const meterBasic = example({
    keywords: ["Meter", "Root", "value"],
    description: "Basic meter at 60% with default styling",
    fn: East.function([], UIComponentType, ($) => {
        return <Meter value={60.0} />;
    }),
    inputs: [],
});

export const meterSuccess = example({
    keywords: ["Meter", "Root", "tone", "success"],
    description: "Meter with success tone and label",
    fn: East.function([], UIComponentType, ($) => {
        return <Meter value={85.0} tone="success" label={<Text>Uptime</Text>} />;
    }),
    inputs: [],
});

export const meterWarning = example({
    keywords: ["Meter", "Root", "tone", "warning", "thickness"],
    description: "Meter with warning tone and large thickness",
    fn: East.function([], UIComponentType, ($) => {
        return <Meter value={42.0} tone="warning" thickness="lg" />;
    }),
    inputs: [],
});

export const meterDensities = example({
    keywords: ["Meter", "density", "condensed", "compact", "comfortable", "sizes"],
    description: "The three densities stacked — track height + value text scale condensed → compact → comfortable (matching ChipRail)",
    fn: East.function([], UIComponentType, ($) => {
        const condensed = $.const(<Meter value={72.0} tone="success" density="condensed" />);
        const compact = $.const(<Meter value={72.0} tone="success" density="compact" />);
        const comfortable = $.const(<Meter value={72.0} tone="success" density="comfortable" />);
        return (
            <Stack direction="column" gap="6">
                {condensed}
                {compact}
                {comfortable}
            </Stack>
        );
    }),
    inputs: [],
});

export const meterCustomMax = example({
    keywords: ["Meter", "Root", "max", "custom"],
    description: "Meter with custom max and explicit colour slots",
    fn: East.function([], UIComponentType, ($) => {
        return <Meter value={350.0} max={500.0} fillColor="purple.500" trackColor="purple.100" />;
    }),
    inputs: [],
});
