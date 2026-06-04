/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { ChipRail, Tag } from "@elaraai/east-ui/jsx";

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
