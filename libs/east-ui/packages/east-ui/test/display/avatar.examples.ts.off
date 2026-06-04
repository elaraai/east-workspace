/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Avatar, Button, Reactive, Stack, State, UIComponentType } from "@elaraai/east-ui";

export const avatarBasic = example({
    keywords: ["Avatar", "Root", "name", "basic"],
    description: "User profile images",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Avatar.Root({ name: "John Doe" }),
            Avatar.Root({ name: "Jane Smith", colorPalette: "blue" }),
            Avatar.Root({ name: "Bob Wilson", colorPalette: "green" }),
        ], { gap: "3" });
    }),
    inputs: [],
});

export const avatarSizes = example({
    keywords: ["Avatar", "Root", "size", "xs", "sm", "md", "lg"],
    description: "Available sizes: xs, sm, md, lg",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Avatar.Root({ name: "XS", size: "xs", colorPalette: "purple" }),
            Avatar.Root({ name: "SM", size: "sm", colorPalette: "purple" }),
            Avatar.Root({ name: "MD", size: "md", colorPalette: "purple" }),
            Avatar.Root({ name: "LG", size: "lg", colorPalette: "purple" }),
        ], { gap: "3", align: "center" });
    }),
    inputs: [],
});

export const avatarColors = example({
    keywords: ["Avatar", "Root", "colorPalette", "red", "orange", "yellow", "green", "blue", "purple"],
    description: "Various color palettes",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Avatar.Root({ name: "Red User", colorPalette: "red" }),
            Avatar.Root({ name: "Orange User", colorPalette: "orange" }),
            Avatar.Root({ name: "Yellow User", colorPalette: "yellow" }),
            Avatar.Root({ name: "Green User", colorPalette: "green" }),
            Avatar.Root({ name: "Blue User", colorPalette: "blue" }),
            Avatar.Root({ name: "Purple User", colorPalette: "purple" }),
        ], { gap: "2" });
    }),
    inputs: [],
});

export const avatarInteractive = example({
    keywords: ["Avatar", "Reactive", "State", "interactive", "counter"],
    description: "Avatar whose name changes from a counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "avatar_counter", 0n));
            const value = $.let(counter.read());
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Avatar.Root({ name: East.str`User ${East.print(value)}`, size: "lg" }),
                Button.Root("Cycle user", { onClick: inc }),
            ], { gap: "3", align: "center" });
        }));
    }),
    inputs: [],
});
