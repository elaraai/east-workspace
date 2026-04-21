/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Badge, Button, Card, Heading, Stack, Text, UIComponentType } from "@elaraai/east-ui";

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
    keywords: ["Card", "Root", "header", "Heading"],
    description: "Card with header component",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("Card content goes here. This card has a heading in the header."),
        ], {
            header: Heading.Root("Card Title"),
        });
    }),
    inputs: [],
});

export const cardHeaderDesc = example({
    keywords: ["Card", "Root", "header", "description", "Stack"],
    description: "Full header with title and description",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("The main content area of the card."),
        ], {
            header: Stack.VStack([
                Heading.Root("Featured Article", { size: "md" }),
                Text.Root("A brief summary of what this card contains", { color: "fg.muted" }),
            ], { gap: "1", align: "flex-start" }),
        });
    }),
    inputs: [],
});

export const cardFooter = example({
    keywords: ["Card", "Root", "footer", "Button", "actions"],
    description: "Card with action buttons in footer",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("This card has action buttons placed in the footer area."),
        ], {
            header: Heading.Root("Actions Card"),
            footer: Stack.HStack([
                Button.Root("Cancel", { variant: "outline", size: "sm" }),
                Button.Root("Save", { variant: "solid", colorPalette: "blue", size: "sm" }),
            ], { gap: "2" }),
        });
    }),
    inputs: [],
});

export const cardElevated = example({
    keywords: ["Card", "Root", "variant", "elevated", "shadow"],
    description: "Card with shadow elevation",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("This card has a shadow effect for visual depth."),
        ], {
            header: Heading.Root("Elevated Style"),
            footer: Button.Root("Learn More", { variant: "solid", colorPalette: "blue", size: "sm" }),
            variant: "elevated",
        });
    }),
    inputs: [],
});

export const cardOutline = example({
    keywords: ["Card", "Root", "variant", "outline", "border"],
    description: "Card with border outline",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("A card with a visible border outline."),
        ], {
            header: Heading.Root("Outline Style"),
            variant: "outline",
        });
    }),
    inputs: [],
});

export const cardSubtle = example({
    keywords: ["Card", "Root", "variant", "subtle"],
    description: "Card with subtle background",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("A card with a subtle background color."),
        ], {
            header: Heading.Root("Subtle Style"),
            variant: "subtle",
        });
    }),
    inputs: [],
});

export const cardDimensions = example({
    keywords: ["Card", "Root", "height", "overflow", "dimensions"],
    description: "Fixed height and min/max constraints",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Text.Root("This card has a fixed height of 200px and will scroll if content overflows."),
            Text.Root("The dimension properties allow precise control over card sizing."),
        ], {
            header: Heading.Root("Sized Card"),
            height: "200px",
            overflow: "auto",
            variant: "outline",
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
                header: Heading.Root("Flex Card 1"),
                flex: "1",
                variant: "outline",
            }),
            Card.Root([
                Text.Root("Both cards share the space equally."),
            ], {
                header: Heading.Root("Flex Card 2"),
                flex: "1",
                variant: "outline",
            }),
        ], { gap: "4", width: "100%" });
    }),
    inputs: [],
});

export const cardMultiple = example({
    keywords: ["Card", "Root", "Badge", "Heading", "rich content"],
    description: "Card with multiple child components",
    fn: East.function([], UIComponentType, (_$) => {
        return Card.Root([
            Stack.HStack([
                Badge.Root("New", { colorPalette: "green", variant: "solid" }),
                Badge.Root("Featured", { colorPalette: "purple", variant: "solid" }),
            ], { gap: "2" }),
            Text.Root("This card demonstrates how multiple components can be nested inside a card body."),
        ], {
            header: Stack.VStack([
                Heading.Root("Action Required", { size: "md" }),
                Text.Root("Please review and respond", { color: "fg.muted" }),
            ], { gap: "1", align: "flex-start" }),
            footer: Stack.HStack([
                Button.Root("Accept", { variant: "solid", colorPalette: "green", size: "sm" }),
                Button.Root("Decline", { variant: "outline", colorPalette: "red", size: "sm" }),
            ], { gap: "2" }),
            variant: "elevated",
        });
    }),
    inputs: [],
});

export const cardSizes = example({
    keywords: ["Card", "Root", "size", "sm", "md", "lg"],
    description: "Available sizes: sm, md, lg",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Card.Root([Text.Root("Small card")], { header: Heading.Root("Small", { size: "sm" }), size: "sm", variant: "outline" }),
            Card.Root([Text.Root("Medium card")], { header: Heading.Root("Medium", { size: "md" }), size: "md", variant: "outline" }),
            Card.Root([Text.Root("Large card")], { header: Heading.Root("Large", { size: "lg" }), size: "lg", variant: "outline" }),
        ], { gap: "4", align: "stretch", width: "100%" });
    }),
    inputs: [],
});
