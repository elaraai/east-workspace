/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, example } from "@elaraai/east";
import { Kbd, UIComponentType } from "../../src/index.js";

export const kbdSingle = example({
    keywords: ["Kbd", "Root", "single", "key"],
    description: "Single key pill",
    fn: East.function([], UIComponentType, ($) => {
        return Kbd.Root(["K"]);
    }),
    inputs: [],
});

export const kbdChord = example({
    keywords: ["Kbd", "Root", "chord", "multi-key"],
    description: "Multi-key chord with + separators",
    fn: East.function([], UIComponentType, ($) => {
        return Kbd.Root(["⌘", "K"]);
    }),
    inputs: [],
});

export const kbdStyled = example({
    keywords: ["Kbd", "Root", "variant", "solid"],
    description: "Solid Kbd with blue palette",
    fn: East.function([], UIComponentType, ($) => {
        return Kbd.Root(["Ctrl", "Shift", "P"], {
            variant: "solid",
            colorPalette: "blue",
            size: "md",
        });
    }),
    inputs: [],
});
