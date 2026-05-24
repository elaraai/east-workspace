/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, example } from "@elaraai/east";
import { BarStrip, Text, UIComponentType } from "../../src/index.js";

export const barStripBasic = example({
    keywords: ["BarStrip", "Root", "items"],
    description: "Basic BarStrip with three rows and tones",
    fn: East.function([], UIComponentType, ($) => {
        return BarStrip.Root([
            { label: Text.Root("Alpha"), value: 42.0, tone: "success" },
            { label: Text.Root("Beta"), value: 28.0, tone: "warning" },
            { label: Text.Root("Gamma"), value: 15.0, tone: "danger" },
        ]);
    }),
    inputs: [],
});

export const barStripSorted = example({
    keywords: ["BarStrip", "Root", "sort", "desc"],
    description: "BarStrip sorted descending by value",
    fn: East.function([], UIComponentType, ($) => {
        return BarStrip.Root([
            { label: Text.Root("Backend"), value: 120.0, tone: "info" },
            { label: Text.Root("Frontend"), value: 85.0, tone: "info" },
            { label: Text.Root("DevOps"), value: 42.0, tone: "info" },
        ], { sort: "desc", thickness: "md" });
    }),
    inputs: [],
});

export const barStripMaxItems = example({
    keywords: ["BarStrip", "Root", "maxItems", "clipping"],
    description: "BarStrip with row limit",
    fn: East.function([], UIComponentType, ($) => {
        return BarStrip.Root([
            { label: Text.Root("A"), value: 100.0 },
            { label: Text.Root("B"), value: 80.0 },
            { label: Text.Root("C"), value: 60.0 },
            { label: Text.Root("D"), value: 40.0 },
            { label: Text.Root("E"), value: 20.0 },
        ], { sort: "desc", maxItems: 3n, showValues: true });
    }),
    inputs: [],
});
