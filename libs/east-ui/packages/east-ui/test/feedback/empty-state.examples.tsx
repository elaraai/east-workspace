/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { EmptyState, Button, HStack } from "@elaraai/east-ui";

export const emptyStateNoResults = example({
    keywords: ["EmptyState", "Root", "no results", "icon", "filters"],
    description: "No-results state with a Font Awesome icon and a clear-filters action",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <EmptyState
                title="No results"
                icon={{ prefix: "fas", name: "magnifying-glass" }}
                description="Try clearing filters or broadening your search."
                actions={<Button variant="outline">Clear filters</Button>}
            />
        );
    }),
    inputs: [],
});

export const emptyStateNoScenarios = example({
    keywords: ["EmptyState", "scenario", "create", "primary action", "icon"],
    description: "Primary empty state with a 'new scenario' call to action — a Font Awesome icon + brand-d CTA",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <EmptyState
                title="No scenarios yet"
                icon={{ prefix: "fas", name: "folder-plus" }}
                description="Create your first scenario to start exploring what-if outcomes."
                actions={
                    <HStack gap="2">
                        <Button variant="solid">New scenario</Button>
                        <Button variant="outline">Import</Button>
                    </HStack>
                }
            />
        );
    }),
    inputs: [],
});

export const emptyStateError = example({
    keywords: ["EmptyState", "error", "icon"],
    description: "Error empty state — its icon stays rule-strong; the status colour comes from the surround, not the icon",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <EmptyState
                title="Something went wrong"
                icon={{ prefix: "fas", name: "triangle-exclamation" }}
                description="We couldn't load this section. Try refreshing."
                actions={<Button>Retry</Button>}
            />
        );
    }),
    inputs: [],
});
