/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Badge, Box, Button, Card, Text, HStack, VStack } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

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

// ============================================================================
// Card — headers, footers, sections, flush, rich content (variant panel)
// ============================================================================

export const cardVariants = example({
    keywords: ["Card", "Root", "header", "eyebrow", "Header", "title", "description", "footer", "Button", "actions", "meta", "Section", "multi-section", "flush", "bodyPadding", "full-bleed", "padding", "Badge", "rich content"],
    description: "Card variant panel — header (eyebrow header strip), header title (eyebrow + brand title + description), footer (action buttons in the footer), with compound header (eyebrow + title + trailing meta, action in the footer), with sections (two hairline-separated sections), flush (zero-body-padding full-bleed card beside a custom bodyPadding card), multiple (multiple child components nested in a card body)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">HEADER</Text>
                    <Card header={{ eyebrow: "Run summary" }}>
                        <Text>Card content goes here. The header is the mono eyebrow strip.</Text>
                    </Card>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">HEADER TITLE</Text>
                    <Card header={{ eyebrow: "Featured", title: "Featured Article", description: "A brief summary of what this card contains" }}>
                        <Text>The main content area of the card.</Text>
                    </Card>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FOOTER</Text>
                    <Card
                        header={{ title: "Actions Card" }}
                        footer={{ actions: [
                            <Button variant="outline" size="sm">Cancel</Button>,
                            <Button variant="solid" colorPalette="blue" size="sm">Save</Button>,
                        ] }}
                    >
                        <Text>This card has action buttons placed in the footer area.</Text>
                    </Card>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">WITH COMPOUND HEADER</Text>
                    <Card
                        header={{ eyebrow: "Forecast · SE region", title: "Per plan week", meta: "14s ago" }}
                        footer={{ content: [<Text>Last synced 14:32</Text>], actions: [<Button variant="subtle">Export</Button>] }}
                    >
                        <Text>Scenario vs baseline — per-plan week comparison.</Text>
                    </Card>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">WITH SECTIONS</Text>
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
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FLUSH</Text>
                    <HStack gap="4">
                        <Card header={{ eyebrow: "Full bleed" }} width="240px" flush>
                            <Badge>fills the body edge-to-edge</Badge>
                        </Card>
                        <Card header={{ eyebrow: "Tight" }} width="240px" bodyPadding="6px 8px">
                            <Text>Custom 6×8 body padding.</Text>
                        </Card>
                    </HStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">MULTIPLE</Text>
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
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Card — the shared states contract (states panel)
// ============================================================================

export const cardStates = example({
    keywords: ["Card", "state", "loading", "Skeleton", "empty", "EmptyState", "error", "permission-denied", "access denied"],
    description: "Card state panel — the shared states-contract quartet: loading (skeleton body), empty (EmptyState fallback body), error (compute-error fallback body), permission denied (access-denied fallback body)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">LOADING</Text>
                    <Card header={{ title: "Run summary" }} state="loading">
                        <Text>Original content — replaced by skeleton while loading.</Text>
                    </Card>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">EMPTY</Text>
                    <Card header={{ eyebrow: "Scenarios" }} state="empty">
                        <Text>Original content — replaced by EmptyState when empty.</Text>
                    </Card>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">ERROR</Text>
                    <Card header={{ eyebrow: "Run summary" }} state="error">
                        <Text>Original content — replaced by error alert.</Text>
                    </Card>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">PERMISSION DENIED</Text>
                    <Card header={{ eyebrow: "Admin panel" }} state="permission-denied">
                        <Text>Sensitive content.</Text>
                    </Card>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Card — dimensions, flex, and the #320 fill-body contract (sizing panel)
// ============================================================================

export const cardSizing = example({
    keywords: ["Card", "Root", "height", "overflow", "dimensions", "flex", "Stack", "HStack", "fill", "body", "constrain", "scroll", "sizing", "fillBody"],
    description: "Card sizing panel — dimensions (fixed height and scroll overflow), flexible (cards that grow with flex), fill body (#320: a height-bounded Card constrains its body so a fill scrollY child scrolls inside the card instead of overflowing it)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">DIMENSIONS</Text>
                    <Card header={{ eyebrow: "Sized card" }} height="200px" overflow="auto">
                        <Text>This card has a fixed height of 200px and will scroll if content overflows.</Text>
                        <Text>The dimension properties allow precise control over card sizing.</Text>
                    </Card>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FLEXIBLE</Text>
                    <HStack gap="4" width="100%">
                        <Card header={{ eyebrow: "Flex card 1" }} flex="1">
                            <Text>This card uses flex: 1 to fill available space.</Text>
                        </Card>
                        <Card header={{ eyebrow: "Flex card 2" }} flex="1">
                            <Text>Both cards share the space equally.</Text>
                        </Card>
                    </HStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FILL BODY</Text>
                    <Card height="240px" width="280px">
                        <Box fill scrollY>
                            <VStack align="stretch" gap="2">
                                {Array.from({ length: 20 }, (_, i) => <Text>{`Row ${i + 1}`}</Text>)}
                            </VStack>
                        </Box>
                    </Card>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
