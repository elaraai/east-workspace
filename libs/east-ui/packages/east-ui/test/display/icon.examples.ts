/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Icon, Stack, UIComponentType } from "../../src/index.js";

export const iconBasic = example({
    keywords: ["Icon", "Root", "fas", "FontAwesome"],
    description: "Font Awesome icons",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Icon.Root("fas", "house"),
            Icon.Root("fas", "user"),
            Icon.Root("fas", "gear"),
            Icon.Root("fas", "bell"),
            Icon.Root("fas", "heart"),
            Icon.Root("fas", "star"),
        ], { gap: "4" });
    }),
    inputs: [],
});

export const iconStyles = example({
    keywords: ["Icon", "Root", "fas", "far", "fab", "FontAwesome"],
    description: "Solid, regular, and brands",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Icon.Root("far", "bookmark"),
            Icon.Root("fas", "bookmark"),
            Icon.Root("fab", "github"),
            Icon.Root("fab", "twitter"),
            Icon.Root("fab", "react"),
        ], { gap: "4" });
    }),
    inputs: [],
});
