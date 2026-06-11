/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { SegmentedMeter, Stack, Text } from "@elaraai/east-ui";

export const segmentedMeterBasic = example({
    keywords: ["SegmentedMeter", "Root", "segments"],
    description: "Three-segment meter with tones",
    fn: East.function([], UIComponentType, ($) => {
        return (
            <SegmentedMeter segments={[
                { value: 40, tone: "success", label: "Fresh" },
                { value: 35, tone: "warning", label: "Stale" },
                { value: 25, tone: "danger", label: "Broken" },
            ]} />
        );
    }),
    inputs: [],
});

export const segmentedMeterOutsideLabels = example({
    keywords: ["SegmentedMeter", "Root", "labels", "outside"],
    description: "Segmented meter with labels rendered below",
    fn: East.function([], UIComponentType, ($) => {
        return (
            <SegmentedMeter
                segments={[
                    { value: 70, tone: "info", label: "Assigned" },
                    { value: 30, tone: "neutral", label: "Unassigned" },
                ]}
                thickness="md"
                labels="outside"
                caption={<Text>Crew mix</Text>}
            />
        );
    }),
    inputs: [],
});

export const segmentedMeterDensities = example({
    keywords: ["SegmentedMeter", "density", "condensed", "compact", "comfortable", "sizes"],
    description: "The three densities stacked — track height scales condensed → compact → comfortable (matching ChipRail)",
    fn: East.function([], UIComponentType, ($) => {
        const condensed = $.const(
            <SegmentedMeter
                density="condensed"
                segments={[
                    { value: 40, tone: "success", label: "Fresh" },
                    { value: 35, tone: "warning", label: "Stale" },
                    { value: 25, tone: "danger", label: "Broken" },
                ]}
            />,
        );
        const compact = $.const(
            <SegmentedMeter
                density="compact"
                segments={[
                    { value: 40, tone: "success", label: "Fresh" },
                    { value: 35, tone: "warning", label: "Stale" },
                    { value: 25, tone: "danger", label: "Broken" },
                ]}
            />,
        );
        const comfortable = $.const(
            <SegmentedMeter
                density="comfortable"
                segments={[
                    { value: 40, tone: "success", label: "Fresh" },
                    { value: 35, tone: "warning", label: "Stale" },
                    { value: 25, tone: "danger", label: "Broken" },
                ]}
            />,
        );
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

export const segmentedMeterResidual = example({
    keywords: ["SegmentedMeter", "Root", "max", "residual"],
    description: "Segmented meter with residual (sum < max) showing empty track",
    fn: East.function([], UIComponentType, ($) => {
        return (
            <SegmentedMeter
                segments={[
                    { value: 30, color: "#3d5cff", label: "Complete" },
                    { value: 10, color: "#f59e0b", label: "In progress" },
                ]}
                max={100}
                trackColor="gray.100"
            />
        );
    }),
    inputs: [],
});
