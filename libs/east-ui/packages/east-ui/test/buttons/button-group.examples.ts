/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Button, ButtonGroup, IconButton, UIComponentType } from "@elaraai/east-ui";

// NOTE: Chakra v3's <Group> does NOT propagate `variant` / `size` /
// `colorPalette` to descendant buttons — set those on EACH child Button
// explicitly. The group-level `style` struct carries only Group-level
// visuals (`attached` / `gap` / `borderColor`).

export const buttonGroupPrevNext = example({
    keywords: ["ButtonGroup", "Root", "attached", "Prev", "Next"],
    description: "Attached Prev/Next pair — two buttons sharing a border",
    fn: East.function([], UIComponentType, (_$) => {
        return ButtonGroup.Root(
            [
                Button.Root("Prev", { style: { variant: "outline", size: "md" } }),
                Button.Root("Next", { style: { variant: "outline", size: "md" } }),
            ],
            { style: { attached: true } },
        );
    }),
    inputs: [],
});

export const buttonGroupTimescale = example({
    keywords: ["ButtonGroup", "Root", "attached", "timescale", "segmented"],
    description: "Segmented timescale control — 5 attached outline buttons",
    fn: East.function([], UIComponentType, (_$) => {
        return ButtonGroup.Root(
            [
                Button.Root("1d", { style: { variant: "outline", size: "sm" } }),
                Button.Root("1w", { style: { variant: "outline", size: "sm" } }),
                Button.Root("1m", { style: { variant: "outline", size: "sm" } }),
                Button.Root("3m", { style: { variant: "outline", size: "sm" } }),
                Button.Root("1y", { style: { variant: "outline", size: "sm" } }),
            ],
            { style: { attached: true } },
        );
    }),
    inputs: [],
});

export const buttonGroupSplit = example({
    keywords: ["ButtonGroup", "Root", "split", "mixed", "IconButton"],
    description: "Split button — primary Button + IconButton overflow trigger",
    fn: East.function([], UIComponentType, (_$) => {
        return ButtonGroup.Root(
            [
                Button.Root("Deploy", { style: { variant: "solid", colorPalette: "blue", size: "md" } }),
                IconButton.Root("fas", "chevron-down", "More deploy options", {
                    style: { variant: "solid", colorPalette: "blue", size: "md" },
                }),
            ],
            { style: { attached: true } },
        );
    }),
    inputs: [],
});
