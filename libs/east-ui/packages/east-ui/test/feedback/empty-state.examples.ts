/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { EmptyState, Button, Stack, UIComponentType } from "@elaraai/east-ui";

export const emptyStateNoResults = example({
    keywords: ["EmptyState", "Root", "no results", "filters"],
    description: "No-results state with a magnifying-glass icon and clear-filters action",
    fn: East.function([], UIComponentType, (_$) => {
        return EmptyState.Root("No results", {
            icon: { prefix: "fas", name: "magnifying-glass" },
            description: "Try clearing filters or broadening your search.",
            actions: Button.Root("Clear filters", { style: { variant: "outline" } }),
        });
    }),
    inputs: [],
});

export const emptyStateNoScenarios = example({
    keywords: ["EmptyState", "scenario", "create", "primary action"],
    description: "Primary empty state with a 'new scenario' call to action",
    fn: East.function([], UIComponentType, (_$) => {
        return EmptyState.Root("No scenarios yet", {
            icon: { prefix: "fas", name: "folder-plus" },
            description: "Create your first scenario to start exploring what-if outcomes.",
            actions: Stack.HStack([
                Button.Root("New scenario", { style: { variant: "solid", colorPalette: "blue" } }),
                Button.Root("Import", { style: { variant: "subtle" } }),
            ], { gap: "2" }),
        });
    }),
    inputs: [],
});

export const emptyStateError = example({
    keywords: ["EmptyState", "error", "iconColor", "escape hatch"],
    description: "Error-tinted empty state using the iconColor style escape hatch",
    fn: East.function([], UIComponentType, (_$) => {
        return EmptyState.Root("Something went wrong", {
            icon: { prefix: "fas", name: "triangle-exclamation" },
            description: "We couldn't load this section. Try refreshing.",
            actions: Button.Root("Retry"),
            style: {
                iconColor: "#dc2626",
                color: "#7f1d1d",
            },
        });
    }),
    inputs: [],
});
