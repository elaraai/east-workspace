/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { EmptyState, Button, Stack, UIComponentType } from "@elaraai/east-ui";

export const emptyStateNoResults = example({
    keywords: ["EmptyState", "Root", "no results", "glyph", "filters"],
    description: "No-results state with mono glyph and clear-filters action",
    fn: East.function([], UIComponentType, (_$) => {
        return EmptyState.Root("No results", {
            glyph: "·   ·   ·",
            description: "Try clearing filters or broadening your search.",
            actions: Button.Root("Clear filters", { style: { variant: "outline" } }),
        });
    }),
    inputs: [],
});

export const emptyStateNoScenarios = example({
    keywords: ["EmptyState", "scenario", "create", "primary action", "glyph"],
    description: "Primary empty state with a 'new scenario' call to action — mono glyph + brand-d CTA",
    fn: East.function([], UIComponentType, (_$) => {
        return EmptyState.Root("No scenarios yet", {
            glyph: "+ + +",
            description: "Create your first scenario to start exploring what-if outcomes.",
            actions: Stack.HStack([
                Button.Root("New scenario", { style: { variant: "solid" } }),
                Button.Root("Import", { style: { variant: "outline" } }),
            ], { gap: "2" }),
        });
    }),
    inputs: [],
});

export const emptyStateError = example({
    keywords: ["EmptyState", "error", "glyph"],
    description: "Error empty state — mono glyph stays rule-strong; status colour comes from surround, not glyph",
    fn: East.function([], UIComponentType, (_$) => {
        return EmptyState.Root("Something went wrong", {
            glyph: "!",
            description: "We couldn't load this section. Try refreshing.",
            actions: Button.Root("Retry"),
        });
    }),
    inputs: [],
});
