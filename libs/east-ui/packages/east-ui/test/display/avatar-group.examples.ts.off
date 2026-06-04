/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, example } from "@elaraai/east";
import { AvatarGroup, UIComponentType } from "../../src/index.js";

export const avatarGroupBasic = example({
    keywords: ["AvatarGroup", "Root", "avatars"],
    description: "Basic avatar group with three avatars",
    fn: East.function([], UIComponentType, ($) => {
        return AvatarGroup.Root([
            { name: "Alice" },
            { name: "Bob" },
            { name: "Carol" },
        ]);
    }),
    inputs: [],
});

export const avatarGroupOverflow = example({
    keywords: ["AvatarGroup", "Root", "max", "overflow"],
    description: "Avatar group with max overflow showing +N",
    fn: East.function([], UIComponentType, ($) => {
        return AvatarGroup.Root([
            { name: "Alice" },
            { name: "Bob" },
            { name: "Carol" },
            { name: "Dan" },
            { name: "Eve" },
        ], { max: 3n, size: "sm" });
    }),
    inputs: [],
});

export const avatarGroupLarge = example({
    keywords: ["AvatarGroup", "Root", "size", "lg"],
    description: "Large avatar group with custom border",
    fn: East.function([], UIComponentType, ($) => {
        return AvatarGroup.Root([
            { name: "Mira" },
            { name: "Noah" },
        ], { size: "lg", borderColor: "blue.200" });
    }),
    inputs: [],
});
