/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, example } from "@elaraai/east";
import { SegmentedMeter, Text, UIComponentType } from "../../src/index.js";

export const segmentedMeterBasic = example({
    keywords: ["SegmentedMeter", "Root", "segments"],
    description: "Three-segment meter with tones",
    fn: East.function([], UIComponentType, ($) => {
        return SegmentedMeter.Root([
            { value: 40, tone: "success", label: "Fresh" },
            { value: 35, tone: "warning", label: "Stale" },
            { value: 25, tone: "danger", label: "Broken" },
        ]);
    }),
    inputs: [],
});

export const segmentedMeterOutsideLabels = example({
    keywords: ["SegmentedMeter", "Root", "labels", "outside"],
    description: "Segmented meter with labels rendered below",
    fn: East.function([], UIComponentType, ($) => {
        return SegmentedMeter.Root([
            { value: 70, tone: "info", label: "Assigned" },
            { value: 30, tone: "neutral", label: "Unassigned" },
        ], { thickness: "md", labels: "outside", caption: Text.Root("Crew mix") });
    }),
    inputs: [],
});

export const segmentedMeterResidual = example({
    keywords: ["SegmentedMeter", "Root", "max", "residual"],
    description: "Segmented meter with residual (sum < max) showing empty track",
    fn: East.function([], UIComponentType, ($) => {
        return SegmentedMeter.Root([
            { value: 30, color: "#3d5cff", label: "Complete" },
            { value: 10, color: "#f59e0b", label: "In progress" },
        ], { max: 100, trackColor: "gray.100" });
    }),
    inputs: [],
});
