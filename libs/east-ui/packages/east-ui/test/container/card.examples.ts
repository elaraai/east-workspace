/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Badge, Button, Card, Stack, Text, UIComponentType } from "@elaraai/east-ui";

export const cardBasic = example({
    keywords: ["Card", "Root", "basic"],
    description: "Simple card container",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("This is a basic card with some content."),
        ]);
    }),
    inputs: [],
});

export const cardHeader = example({
    keywords: ["Card", "Root", "header", "eyebrow"],
    description: "Card with a bare-string eyebrow header",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("Card content goes here. The header is the mono eyebrow strip."),
        ], {
            header: "Run summary",
        });
    }),
    inputs: [],
});

export const cardHeaderTitle = example({
    keywords: ["Card", "Header", "eyebrow", "title", "description"],
    description: "Header with eyebrow + brand title + description",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("The main content area of the card."),
        ], {
            header: Card.Header({
                eyebrow: "Featured",
                title: "Featured Article",
                description: "A brief summary of what this card contains",
            }),
        });
    }),
    inputs: [],
});

export const cardFooter = example({
    keywords: ["Card", "Root", "footer", "Button", "actions"],
    description: "Card with action buttons in the footer",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("This card has action buttons placed in the footer area."),
        ], {
            header: Card.Header({ title: "Actions Card" }),
            footer: Stack.HStack([
                Button.Root("Cancel", { style: { variant: "outline", size: "sm" } }),
                Button.Root("Save", { style: { variant: "solid", colorPalette: "blue", size: "sm" } }),
            ], { gap: "2" }),
        });
    }),
    inputs: [],
});

export const cardDimensions = example({
    keywords: ["Card", "Root", "height", "overflow", "dimensions"],
    description: "Fixed height and scroll overflow",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("This card has a fixed height of 200px and will scroll if content overflows."),
            Text.Root("The dimension properties allow precise control over card sizing."),
        ], {
            header: "Sized card",
            height: "200px",
            overflow: "auto",
        });
    }),
    inputs: [],
});

export const cardFlexible = example({
    keywords: ["Card", "Root", "flex", "Stack", "HStack"],
    description: "Card that grows with flex",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Card.Root([
                Text.Root("This card uses flex: 1 to fill available space."),
            ], {
                header: "Flex card 1",
                flex: "1",
            }),
            Card.Root([
                Text.Root("Both cards share the space equally."),
            ], {
                header: "Flex card 2",
                flex: "1",
            }),
        ], { gap: "4", width: "100%" });
    }),
    inputs: [],
});

export const cardMultiple = example({
    keywords: ["Card", "Root", "Badge", "rich content"],
    description: "Card with multiple child components",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Stack.HStack([
                Badge.Root("New", { colorPalette: "green", variant: "solid" }),
                Badge.Root("Featured", { colorPalette: "purple", variant: "solid" }),
            ], { gap: "2" }),
            Text.Root("This card demonstrates how multiple components can be nested inside a card body."),
        ], {
            header: Card.Header({ eyebrow: "Action required", title: "Please review and respond" }),
            footer: Stack.HStack([
                Button.Root("Accept", { style: { variant: "solid", colorPalette: "green", size: "sm" } }),
                Button.Root("Decline", { style: { variant: "outline", colorPalette: "red", size: "sm" } }),
            ], { gap: "2" }),
        });
    }),
    inputs: [],
});

export const cardWithCompoundHeader = example({
    keywords: ["Card", "Header", "eyebrow", "title", "meta"],
    description: "Header with eyebrow + title + trailing meta, action in the footer",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("Scenario vs baseline — per-plan week comparison."),
        ], {
            header: Card.Header({
                eyebrow: "Forecast · SE region",
                title: "Per plan week",
                meta: "14s ago",
            }),
            footer: Card.Footer([Text.Root("Last synced 14:32")], {
                actions: Card.Actions([Button.Root("Export", { style: { variant: "subtle" } })]),
            }),
        });
    }),
    inputs: [],
});

export const cardLoading = example({
    keywords: ["Card", "state", "loading", "Skeleton"],
    description: "Card in loading state — skeleton body",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("Original content — replaced by skeleton while loading."),
        ], {
            header: Card.Header({ title: "Run summary" }),
            state: "loading",
        });
    }),
    inputs: [],
});

export const cardEmpty = example({
    keywords: ["Card", "state", "empty", "EmptyState"],
    description: "Card in empty state — EmptyState fallback body",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("Original content — replaced by EmptyState when empty."),
        ], {
            header: "Scenarios",
            state: "empty",
        });
    }),
    inputs: [],
});

export const cardError = example({
    keywords: ["Card", "state", "error"],
    description: "Card in error state — compute-error fallback body",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("Original content — replaced by error alert."),
        ], {
            header: "Run summary",
            state: "error",
        });
    }),
    inputs: [],
});

export const cardPermissionDenied = example({
    keywords: ["Card", "state", "permission-denied", "access denied"],
    description: "Card in permission-denied state — access-denied fallback body",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("Sensitive content."),
        ], {
            header: "Admin panel",
            state: "permission-denied",
        });
    }),
    inputs: [],
});

export const cardWithSections = example({
    keywords: ["Card", "Section", "multi-section"],
    description: "Card with two hairline-separated sections",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("Top-level summary line."),
            Card.Section([Text.Root("Scope A details")], { title: "Scope" }),
            Card.Section([
                Stack.HStack([
                    Button.Root("Apply"),
                    Button.Root("Revert", { style: { variant: "subtle" } }),
                ], { gap: "2" }),
            ], { title: "Actions" }),
        ], {
            header: Card.Header({ title: "Commit approval" }),
        });
    }),
    inputs: [],
});
