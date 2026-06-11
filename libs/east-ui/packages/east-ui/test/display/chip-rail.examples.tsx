/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Avatar, Badge, ChipRail, MetricChip, Tag, Text, Stack } from "@elaraai/east-ui";

export const chipRailBasic = example({
    keywords: ["ChipRail", "Root", "tags", "line-separator", "compact"],
    description: "Six Tag chips in a ChipRail with line separators and compact density",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <ChipRail density="compact" separator="line">
                <Tag>Week 12</Tag>
                <Tag>Vintage</Tag>
                <Tag>17–23 Mar</Tag>
                <Tag>Red</Tag>
                <Tag>ICU</Tag>
                <Tag>Europe</Tag>
            </ChipRail>
        );
    }),
    inputs: [],
});

export const chipRailMixed = example({
    keywords: ["ChipRail", "mixed", "Badge", "MetricChip", "Avatar", "Tag", "density"],
    description: "A rail of mixed chip-shaped children — Avatar, Tags, a Badge and a MetricChip all follow the rail's density",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <ChipRail density="compact" separator="dot">
                <Avatar name="Mia Kerr" colorPalette="blue" />
                <Tag>Crush A</Tag>
                <Tag variant="brand">Running</Tag>
                <Badge variant="ok">ON PLAN</Badge>
                <MetricChip tone="positive"><Text>+4.2%</Text></MetricChip>
            </ChipRail>
        );
    }),
    inputs: [],
});

export const chipRailDots = example({
    keywords: ["ChipRail", "Root", "tags", "dot-separator"],
    description: "Tag chips separated by middle-dots (·)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <ChipRail density="compact" separator="dot">
                <Tag>Observe</Tag>
                <Tag>Explain</Tag>
                <Tag>Decide</Tag>
                <Tag>Commit</Tag>
            </ChipRail>
        );
    }),
    inputs: [],
});

export const chipRailLabeled = example({
    keywords: ["ChipRail", "labels", "labeled", "caption", "dimension", "density", "sizes"],
    description: "Labeled mode at all three densities — each chip carries a mono uppercase caption, and the captions + chips scale with density",
    fn: East.function([], UIComponentType, ($) => {
        const labels = $.const(["Week", "Region", "Status", "Vintage"]);
        return (
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
        );
    }),
    inputs: [],
});

export const chipRailDensities = example({
    keywords: ["ChipRail", "density", "condensed", "compact", "comfortable", "sizes"],
    description: "The three densities stacked — condensed, compact, comfortable — showing how chip + gap sizing scales",
    fn: East.function([], UIComponentType, (_$) => {
        return (
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
        );
    }),
    inputs: [],
});

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
