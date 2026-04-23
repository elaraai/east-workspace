/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { ChipRail, Tag, UIComponentType } from "@elaraai/east-ui";

export const chipRailBasic = example({
    keywords: ["ChipRail", "Root", "tags", "line-separator", "compact"],
    description: "Six Tag chips in a ChipRail with line separators and compact density",
    fn: East.function([], UIComponentType, (_$) => {
        return ChipRail.Root([
            Tag.Root("Week 12"),
            Tag.Root("Vintage"),
            Tag.Root("17–23 Mar"),
            Tag.Root("Red"),
            Tag.Root("ICU"),
            Tag.Root("Europe"),
        ], { density: "compact", separator: "line" });
    }),
    inputs: [],
});

export const chipRailDots = example({
    keywords: ["ChipRail", "Root", "tags", "dot-separator"],
    description: "Tag chips separated by middle-dots (·)",
    fn: East.function([], UIComponentType, (_$) => {
        return ChipRail.Root([
            Tag.Root("Observe"),
            Tag.Root("Explain"),
            Tag.Root("Decide"),
            Tag.Root("Commit"),
        ], { density: "compact", separator: "dot" });
    }),
    inputs: [],
});

export const chipRailOverflow = example({
    keywords: ["ChipRail", "Root", "overflow", "scroll", "responsive"],
    description: "Twenty chips with overflow=\"scroll\" — the rail scrolls horizontally on narrow containers",
    fn: East.function([], UIComponentType, (_$) => {
        const chips = Array.from({ length: 20 }, (_, i) =>
            Tag.Root(`Chip ${i + 1}`, { variant: "subtle", colorPalette: "teal" }),
        );
        return ChipRail.Root(chips, {
            density: "condensed",
            separator: "none",
            overflow: "scroll",
        });
    }),
    inputs: [],
});
