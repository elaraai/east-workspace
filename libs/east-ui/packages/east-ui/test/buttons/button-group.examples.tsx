/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Button, ButtonGroup, IconButton } from "@elaraai/east-ui/jsx";

// NOTE: Chakra v3's <Group> does NOT propagate `variant` / `size` /
// `colorPalette` to descendant buttons — set those on EACH child Button
// explicitly. The group-level options carry only Group-level visuals
// (`attached` / `gap` / `borderColor`).

export const buttonGroupPrevNext = example({
    keywords: ["ButtonGroup", "Root", "attached", "Prev", "Next"],
    description: "Attached Prev/Next pair — two buttons sharing a border",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <ButtonGroup attached>
                <Button variant="outline" size="md">Prev</Button>
                <Button variant="outline" size="md">Next</Button>
            </ButtonGroup>
        );
    }),
    inputs: [],
});

export const buttonGroupTimescale = example({
    keywords: ["ButtonGroup", "Root", "attached", "timescale", "segmented"],
    description: "Segmented timescale control — 5 attached outline buttons",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <ButtonGroup attached>
                <Button variant="outline" size="sm">1d</Button>
                <Button variant="outline" size="sm">1w</Button>
                <Button variant="outline" size="sm">1m</Button>
                <Button variant="outline" size="sm">3m</Button>
                <Button variant="outline" size="sm">1y</Button>
            </ButtonGroup>
        );
    }),
    inputs: [],
});

export const buttonGroupSplit = example({
    keywords: ["ButtonGroup", "Root", "split", "mixed", "IconButton"],
    description: "Split button — primary Button + IconButton overflow trigger",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <ButtonGroup attached>
                <Button variant="solid" colorPalette="blue" size="md">Deploy</Button>
                <IconButton prefix="fas" name="chevron-down" label="More deploy options" variant="solid" colorPalette="blue" size="md" />
            </ButtonGroup>
        );
    }),
    inputs: [],
});
