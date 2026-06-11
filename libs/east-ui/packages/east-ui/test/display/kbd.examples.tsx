/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Kbd, Stack } from "@elaraai/east-ui";

export const kbdSingle = example({
    keywords: ["Kbd", "Root", "single", "key"],
    description: "Single key pill",
    fn: East.function([], UIComponentType, ($) => {
        return <Kbd keys={["K"]} />;
    }),
    inputs: [],
});

export const kbdChord = example({
    keywords: ["Kbd", "Root", "chord", "multi-key"],
    description: "Multi-key chord with + separators",
    fn: East.function([], UIComponentType, ($) => {
        return <Kbd keys={["⌘", "K"]} />;
    }),
    inputs: [],
});

export const kbdStyled = example({
    keywords: ["Kbd", "Root", "variant", "solid"],
    description: "Solid Kbd with blue palette",
    fn: East.function([], UIComponentType, ($) => {
        return <Kbd keys={["Ctrl", "Shift", "P"]} variant="solid" colorPalette="blue" size="md" />;
    }),
    inputs: [],
});

export const kbdDensities = example({
    keywords: ["Kbd", "density", "condensed", "compact", "comfortable", "sizes"],
    description: "The three densities stacked — key-cap height + font scale condensed → compact → comfortable (matching ChipRail)",
    fn: East.function([], UIComponentType, ($) => {
        const condensed = $.const(<Kbd keys={["⌘", "K"]} density="condensed" />);
        const compact = $.const(<Kbd keys={["⌘", "K"]} density="compact" />);
        const comfortable = $.const(<Kbd keys={["⌘", "K"]} density="comfortable" />);
        return (
            <Stack direction="column" gap="6">
                {condensed}
                {compact}
                {comfortable}
            </Stack>
        );
    }),
    inputs: [],
});
