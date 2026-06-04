/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, example } from "@elaraai/east";
import { Meter, Text, UIComponentType } from "../../src/index.js";

export const meterBasic = example({
    keywords: ["Meter", "Root", "value"],
    description: "Basic meter at 60% with default styling",
    fn: East.function([], UIComponentType, ($) => {
        return Meter.Root(60.0);
    }),
    inputs: [],
});

export const meterSuccess = example({
    keywords: ["Meter", "Root", "tone", "success"],
    description: "Meter with success tone and label",
    fn: East.function([], UIComponentType, ($) => {
        return Meter.Root(85.0, { tone: "success", label: Text.Root("Uptime") });
    }),
    inputs: [],
});

export const meterWarning = example({
    keywords: ["Meter", "Root", "tone", "warning", "thickness"],
    description: "Meter with warning tone and large thickness",
    fn: East.function([], UIComponentType, ($) => {
        return Meter.Root(42.0, { tone: "warning", thickness: "lg" });
    }),
    inputs: [],
});

export const meterCustomMax = example({
    keywords: ["Meter", "Root", "max", "custom"],
    description: "Meter with custom max and explicit colour slots",
    fn: East.function([], UIComponentType, ($) => {
        return Meter.Root(350.0, {
            max: 500.0,
            fillColor: "purple.500",
            trackColor: "purple.100",
        });
    }),
    inputs: [],
});
