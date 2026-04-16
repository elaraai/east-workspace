/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Avatar, Badge, Button, HoverCard, Stack, Text, UIComponentType } from "../../src/index.js";

export const hoverCardProfile = example({
    keywords: ["HoverCard", "Root", "Avatar", "Badge", "profile"],
    description: "Rich preview on hover",
    fn: East.function([], UIComponentType, (_$) => {
        return HoverCard.Root(
            Text.Root("@johndoe", { color: "blue.500", fontWeight: "medium" }),
            [
                Stack.HStack([
                    Avatar.Root({ name: "John Doe", size: "lg" }),
                    Stack.VStack([
                        Text.Root("John Doe", { fontWeight: "semibold" }),
                        Text.Root("Software Engineer", { fontSize: "sm", color: "gray.500" }),
                        Stack.HStack([
                            Badge.Root("Pro", { colorPalette: "purple", variant: "solid" }),
                            Badge.Root("Verified", { colorPalette: "green", variant: "subtle" }),
                        ], { gap: "1" }),
                    ], { gap: "1", align: "flex-start" }),
                ], { gap: "3" }),
            ],
            { placement: "bottom", openDelay: 200n }
        );
    }),
    inputs: [],
});

export const hoverCardLink = example({
    keywords: ["HoverCard", "Root", "link", "preview", "hasArrow"],
    description: "Preview content on hover",
    fn: East.function([], UIComponentType, (_$) => {
        return HoverCard.Root(
            Button.Root("View Documentation", { variant: "ghost", colorPalette: "blue" }),
            [
                Stack.VStack([
                    Text.Root("East UI Documentation", { fontWeight: "semibold" }),
                    Text.Root("Complete guide to building UIs with East UI components. Learn about layout, forms, charts, and more.", { fontSize: "sm", color: "gray.600" }),
                ], { gap: "2", padding: "2" }),
            ],
            { hasArrow: true }
        );
    }),
    inputs: [],
});
