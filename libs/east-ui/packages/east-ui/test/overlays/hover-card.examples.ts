/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, NullType, example } from "@elaraai/east";
import { Avatar, Badge, Button, HoverCard, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

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

export const hoverCardInteractive = example({
    keywords: ["HoverCard", "Reactive", "State", "interactive", "onOpenChange"],
    description: "HoverCard whose onOpenChange counts hover-open transitions",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([IntegerType], "hovercard_toggles", 0n));
            const value = $.let(bind.read());
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, _open) => {
                const cur = $.let(bind.read());
                $(bind.write(cur.add(1n)));
            }));
            return Stack.VStack([
                HoverCard.Root(
                    Button.Root("Hover me"),
                    [Text.Root("HoverCard content shown on hover")],
                    { onOpenChange },
                ),
                Text.Root(East.str`Toggled ${East.print(value)} times`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
