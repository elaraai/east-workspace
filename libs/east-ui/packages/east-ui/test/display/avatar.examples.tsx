/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Avatar, Button, HStack, VStack, Stack, Reactive } from "@elaraai/east-ui";

export const avatarBasic = example({
    keywords: ["Avatar", "Root", "name", "basic"],
    description: "User profile images",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="3">
                <Avatar name="John Doe" />
                <Avatar name="Jane Smith" colorPalette="blue" />
                <Avatar name="Bob Wilson" colorPalette="green" />
            </HStack>
        );
    }),
    inputs: [],
});

export const avatarSizes = example({
    keywords: ["Avatar", "Root", "size", "xs", "sm", "md", "lg"],
    description: "Available sizes: xs, sm, md, lg",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="3" align="center">
                <Avatar name="XS" size="xs" colorPalette="purple" />
                <Avatar name="SM" size="sm" colorPalette="purple" />
                <Avatar name="MD" size="md" colorPalette="purple" />
                <Avatar name="LG" size="lg" colorPalette="purple" />
            </HStack>
        );
    }),
    inputs: [],
});

export const avatarColors = example({
    keywords: ["Avatar", "Root", "colorPalette", "red", "orange", "yellow", "green", "blue", "purple"],
    description: "Various color palettes",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2">
                <Avatar name="Red User" colorPalette="red" />
                <Avatar name="Orange User" colorPalette="orange" />
                <Avatar name="Yellow User" colorPalette="yellow" />
                <Avatar name="Green User" colorPalette="green" />
                <Avatar name="Blue User" colorPalette="blue" />
                <Avatar name="Purple User" colorPalette="purple" />
            </HStack>
        );
    }),
    inputs: [],
});

export const avatarDensities = example({
    keywords: ["Avatar", "density", "condensed", "compact", "comfortable", "sizes"],
    description: "The three densities stacked — condensed → compact → comfortable (matching ChipRail / Trace)",
    fn: East.function([], UIComponentType, ($) => {
        const condensed = $.const(<Avatar name="Jane Smith" colorPalette="blue" density="condensed" />);
        const compact = $.const(<Avatar name="Jane Smith" colorPalette="blue" density="compact" />);
        const comfortable = $.const(<Avatar name="Jane Smith" colorPalette="blue" density="comfortable" />);
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

export const avatarInteractive = example({
    keywords: ["Avatar", "Reactive", "State", "interactive", "counter"],
    description: "Avatar whose name changes from a counter",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const counter = $.let(State.bind([IntegerType], "avatar_counter", 0n));
            const value = $.let(counter.read());
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="center">
                    <Avatar name={East.str`User ${East.print(value)}`} size="lg" />
                    <Button onClick={inc}>Cycle user</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
