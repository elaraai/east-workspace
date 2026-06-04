/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { EmptyState, Button, HStack } from "@elaraai/east-ui/jsx";

export const emptyStateNoResults = example({
    keywords: ["EmptyState", "Root", "no results", "glyph", "filters"],
    description: "No-results state with mono glyph and clear-filters action",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <EmptyState
                title="No results"
                glyph="·   ·   ·"
                description="Try clearing filters or broadening your search."
                actions={<Button variant="outline">Clear filters</Button>}
            />
        );
    }),
    inputs: [],
});

export const emptyStateNoScenarios = example({
    keywords: ["EmptyState", "scenario", "create", "primary action", "glyph"],
    description: "Primary empty state with a 'new scenario' call to action — mono glyph + brand-d CTA",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <EmptyState
                title="No scenarios yet"
                glyph="+ + +"
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
    keywords: ["EmptyState", "error", "glyph"],
    description: "Error empty state — mono glyph stays rule-strong; status colour comes from surround, not glyph",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <EmptyState
                title="Something went wrong"
                glyph="!"
                description="We couldn't load this section. Try refreshing."
                actions={<Button>Retry</Button>}
            />
        );
    }),
    inputs: [],
});
