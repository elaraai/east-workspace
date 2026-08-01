/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Avatar, Badge, ChipRail, MetricChip, Tag, Text, VStack, Stack } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const chipRailBasic = example({
    keywords: ["ChipRail", "Root", "tags", "line-separator", "compact"],
    description: "Six Tag chips in a ChipRail with line separators and compact density",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <ChipRail density="compact" separator="line">
                <Tag>Week 12</Tag>
                <Tag>Cycle</Tag>
                <Tag>17–23 Mar</Tag>
                <Tag>Red</Tag>
                <Tag>ICU</Tag>
                <Tag>Europe</Tag>
            </ChipRail>
        );
    }),
    inputs: [],
});

// ============================================================================
// Overflow — the +N collapse contract
// ============================================================================

export const chipRailOverflow = example({
    keywords: ["ChipRail", "Root", "overflow", "scroll", "responsive"],
    description: "Twenty chips with overflow=\"scroll\" — the rail scrolls horizontally on narrow containers",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <ChipRail density="condensed" separator="none" overflow="scroll">
                {Array.from({ length: 20 }, (_, i) => <Tag variant="subtle" colorPalette="teal">{`Chip ${i + 1}`}</Tag>)}
            </ChipRail>
        );
    }),
    inputs: [],
});

// ============================================================================
// ChipRail — mixed chips, separators, labels, densities (variant panel)
// ============================================================================

export const chipRailVariants = example({
    keywords: ["ChipRail", "mixed", "Badge", "MetricChip", "Avatar", "Tag", "density", "Root", "tags", "dot-separator", "labels", "labeled", "caption", "dimension", "sizes", "condensed", "compact", "comfortable"],
    description: "ChipRail variant panel — rail mixed (Avatar, Tags, a Badge and a MetricChip all follow the rail's density), rail dots (Tag chips separated by middle-dots), rail labeled (labeled mode at all three densities — each chip carries a mono uppercase caption), rail densities (the three densities stacked — condensed, compact, comfortable)",
    fn: East.function([], UIComponentType, ($) => {
        const labels = $.const(["Week", "Region", "Status", "Cycle"]);
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RAIL MIXED</Text>
                    <ChipRail density="compact" separator="dot">
                        <Avatar name="Mia Kerr" colorPalette="blue" />
                        <Tag>Batch A</Tag>
                        <Tag variant="brand">Running</Tag>
                        <Badge variant="ok">ON PLAN</Badge>
                        <MetricChip tone="positive"><Text>+4.2%</Text></MetricChip>
                    </ChipRail>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RAIL DOTS</Text>
                    <ChipRail density="compact" separator="dot">
                        <Tag>Observe</Tag>
                        <Tag>Explain</Tag>
                        <Tag>Decide</Tag>
                        <Tag>Commit</Tag>
                    </ChipRail>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RAIL LABELED</Text>
                    <Stack direction="column" gap="6">
                        <ChipRail density="condensed" labels={labels}>
                            <Tag>Week 12</Tag>
                            <Tag>Europe</Tag>
                            <Tag>On track</Tag>
                            <Tag>Red</Tag>
                        </ChipRail>
                        <ChipRail density="compact" labels={labels}>
                            <Tag>Week 12</Tag>
                            <Tag>Europe</Tag>
                            <Tag>On track</Tag>
                            <Tag>Red</Tag>
                        </ChipRail>
                        <ChipRail density="comfortable" labels={labels}>
                            <Tag>Week 12</Tag>
                            <Tag>Europe</Tag>
                            <Tag>On track</Tag>
                            <Tag>Red</Tag>
                        </ChipRail>
                    </Stack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RAIL DENSITIES</Text>
                    <Stack direction="column" gap="4">
                        <ChipRail density="condensed" separator="dot">
                            <Tag>Observe</Tag>
                            <Tag>Explain</Tag>
                            <Tag>Decide</Tag>
                            <Tag>Commit</Tag>
                        </ChipRail>
                        <ChipRail density="compact" separator="dot">
                            <Tag>Observe</Tag>
                            <Tag>Explain</Tag>
                            <Tag>Decide</Tag>
                            <Tag>Commit</Tag>
                        </ChipRail>
                        <ChipRail density="comfortable" separator="dot">
                            <Tag>Observe</Tag>
                            <Tag>Explain</Tag>
                            <Tag>Decide</Tag>
                            <Tag>Commit</Tag>
                        </ChipRail>
                    </Stack>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
