/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Button, Card, Text, HStack, VStack } from "@elaraai/east-ui";

export const cardBasic = example({
    keywords: ["Card", "Root", "basic"],
    description: "Simple card container",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card>
                <Text>This is a basic card with some content.</Text>
            </Card>
        );
    }),
    inputs: [],
});

export const cardHeader = example({
    keywords: ["Card", "Root", "header", "eyebrow"],
    description: "Card with an eyebrow header",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card header={{ eyebrow: "Run summary" }}>
                <Text>Card content goes here. The header is the mono eyebrow strip.</Text>
            </Card>
        );
    }),
    inputs: [],
});

export const cardHeaderTitle = example({
    keywords: ["Card", "Header", "eyebrow", "title", "description"],
    description: "Header with eyebrow + brand title + description",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card header={{ eyebrow: "Featured", title: "Featured Article", description: "A brief summary of what this card contains" }}>
                <Text>The main content area of the card.</Text>
            </Card>
        );
    }),
    inputs: [],
});

export const cardFooter = example({
    keywords: ["Card", "Root", "footer", "Button", "actions"],
    description: "Card with action buttons in the footer",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card
                header={{ title: "Actions Card" }}
                footer={{ actions: [
                    <Button variant="outline" size="sm">Cancel</Button>,
                    <Button variant="solid" colorPalette="blue" size="sm">Save</Button>,
                ] }}
            >
                <Text>This card has action buttons placed in the footer area.</Text>
            </Card>
        );
    }),
    inputs: [],
});

export const cardDimensions = example({
    keywords: ["Card", "Root", "height", "overflow", "dimensions"],
    description: "Fixed height and scroll overflow",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card header={{ eyebrow: "Sized card" }} height="200px" overflow="auto">
                <Text>This card has a fixed height of 200px and will scroll if content overflows.</Text>
                <Text>The dimension properties allow precise control over card sizing.</Text>
            </Card>
        );
    }),
    inputs: [],
});

export const cardFlush = example({
    keywords: ["Card", "flush", "bodyPadding", "full-bleed", "padding"],
    description: "A flush card (zero body padding) for full-bleed content, beside a card with a custom bodyPadding",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4">
                <Card header={{ eyebrow: "Full bleed" }} width="240px" flush>
                    <Badge>fills the body edge-to-edge</Badge>
                </Card>
                <Card header={{ eyebrow: "Tight" }} width="240px" bodyPadding="6px 8px">
                    <Text>Custom 6×8 body padding.</Text>
                </Card>
            </HStack>
        );
    }),
    inputs: [],
});

export const cardFlexible = example({
    keywords: ["Card", "Root", "flex", "Stack", "HStack"],
    description: "Card that grows with flex",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4" width="100%">
                <Card header={{ eyebrow: "Flex card 1" }} flex="1">
                    <Text>This card uses flex: 1 to fill available space.</Text>
                </Card>
                <Card header={{ eyebrow: "Flex card 2" }} flex="1">
                    <Text>Both cards share the space equally.</Text>
                </Card>
            </HStack>
        );
    }),
    inputs: [],
});

export const cardMultiple = example({
    keywords: ["Card", "Root", "Badge", "rich content"],
    description: "Card with multiple child components",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card
                header={{ eyebrow: "Action required", title: "Please review and respond" }}
                footer={{ actions: [
                    <Button variant="solid" colorPalette="green" size="sm">Accept</Button>,
                    <Button variant="outline" colorPalette="red" size="sm">Decline</Button>,
                ] }}
            >
                <HStack gap="2">
                    <Badge colorPalette="green" variant="solid">New</Badge>
                    <Badge colorPalette="purple" variant="solid">Featured</Badge>
                </HStack>
                <Text>This card demonstrates how multiple components can be nested inside a card body.</Text>
            </Card>
        );
    }),
    inputs: [],
});

export const cardWithCompoundHeader = example({
    keywords: ["Card", "Header", "eyebrow", "title", "meta"],
    description: "Header with eyebrow + title + trailing meta, action in the footer",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card
                header={{ eyebrow: "Forecast · SE region", title: "Per plan week", meta: "14s ago" }}
                footer={{ content: [<Text>Last synced 14:32</Text>], actions: [<Button variant="subtle">Export</Button>] }}
            >
                <Text>Scenario vs baseline — per-plan week comparison.</Text>
            </Card>
        );
    }),
    inputs: [],
});

export const cardLoading = example({
    keywords: ["Card", "state", "loading", "Skeleton"],
    description: "Card in loading state — skeleton body",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card header={{ title: "Run summary" }} state="loading">
                <Text>Original content — replaced by skeleton while loading.</Text>
            </Card>
        );
    }),
    inputs: [],
});

export const cardEmpty = example({
    keywords: ["Card", "state", "empty", "EmptyState"],
    description: "Card in empty state — EmptyState fallback body",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card header={{ eyebrow: "Scenarios" }} state="empty">
                <Text>Original content — replaced by EmptyState when empty.</Text>
            </Card>
        );
    }),
    inputs: [],
});

export const cardError = example({
    keywords: ["Card", "state", "error"],
    description: "Card in error state — compute-error fallback body",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card header={{ eyebrow: "Run summary" }} state="error">
                <Text>Original content — replaced by error alert.</Text>
            </Card>
        );
    }),
    inputs: [],
});

export const cardPermissionDenied = example({
    keywords: ["Card", "state", "permission-denied", "access denied"],
    description: "Card in permission-denied state — access-denied fallback body",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card header={{ eyebrow: "Admin panel" }} state="permission-denied">
                <Text>Sensitive content.</Text>
            </Card>
        );
    }),
    inputs: [],
});

export const cardWithSections = example({
    keywords: ["Card", "Section", "multi-section"],
    description: "Card with two hairline-separated sections",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card header={{ title: "Commit approval" }}>
                <Text>Top-level summary line.</Text>
                {Card.Section([<Text>Scope A details</Text>], { title: "Scope" })}
                {Card.Section([
                    <HStack gap="2">
                        <Button>Apply</Button>
                        <Button variant="subtle">Revert</Button>
                    </HStack>,
                ], { title: "Actions" })}
            </Card>
        );
    }),
    inputs: [],
});

export const cardFillBody = example({
    keywords: ["Card", "height", "fill", "body", "constrain", "scroll", "sizing", "fillBody"],
    description: "A height-bounded Card constrains its body (#320) — with a definite `height` the body becomes `flex:1; min-height:0`, so a `fill scrollY` child resolves against the card and scrolls inside it instead of overflowing the card",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Card height="240px" width="280px">
                <Box fill scrollY>
                    <VStack align="stretch" gap="2">
                        {Array.from({ length: 20 }, (_, i) => <Text>{`Row ${i + 1}`}</Text>)}
                    </VStack>
                </Box>
            </Card>
        );
    }),
    inputs: [],
});
