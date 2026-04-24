/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Spinner, Stack, UIComponentType } from "@elaraai/east-ui";

export const spinnerSizes = example({
    keywords: ["Spinner", "size", "xs", "sm", "md", "lg"],
    description: "Spinner at each size preset side by side",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Spinner.Root({ style: { size: "xs" } }),
            Spinner.Root({ style: { size: "sm" } }),
            Spinner.Root({ style: { size: "md" } }),
            Spinner.Root({ style: { size: "lg" } }),
        ], { gap: "4", align: "center" });
    }),
    inputs: [],
});

export const spinnerBranded = example({
    keywords: ["Spinner", "color", "trackColor", "branded"],
    description: "Branded spinner using color + trackColor escape hatches",
    fn: East.function([], UIComponentType, (_$) => {
        return Spinner.Root({
            style: {
                size: "lg",
                color: "#3d5cff",
                trackColor: "#e5e7eb",
                thickness: "3px",
                speed: "0.6s",
            },
        });
    }),
    inputs: [],
});
