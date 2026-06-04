/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Kbd } from "@elaraai/east-ui/jsx";

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
