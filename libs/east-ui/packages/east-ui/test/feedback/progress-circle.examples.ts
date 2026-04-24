/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { ProgressCircle, Stack, UIComponentType } from "@elaraai/east-ui";

export const progressCircleBasic = example({
    keywords: ["ProgressCircle", "Root", "basic"],
    description: "Static 60% progress circle",
    fn: East.function([], UIComponentType, (_$) => {
        return ProgressCircle.Root(60.0, {
            showValueText: true,
            style: { size: "md", colorPalette: "blue" },
        });
    }),
    inputs: [],
});

export const progressCircleIndeterminate = example({
    keywords: ["ProgressCircle", "indeterminate"],
    description: "Spinning ring with no known progress value",
    fn: East.function([], UIComponentType, (_$) => {
        return ProgressCircle.Root(0.0, {
            indeterminate: true,
            style: { size: "lg", colorPalette: "blue" },
        });
    }),
    inputs: [],
});

export const progressCircleETA = example({
    keywords: ["ProgressCircle", "ETA", "estimatedDuration", "startedAt"],
    description: "Ring with remaining-seconds text driven by estimatedDuration + startedAt",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            ProgressCircle.Root(42.0, {
                estimatedDuration: 90n,
                startedAt: new Date("2026-01-01T09:00:00Z"),
                style: { size: "lg", colorPalette: "blue", thickness: "4px" },
            }),
        ], { gap: "4", align: "center" });
    }),
    inputs: [],
});
