/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * Studio components (#991) — a component is an East UI function written like a
 * `ui()` body, declared once with what the palette shows; a placement renders
 * it by its key.
 */

import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Button, HStack, Reactive, State, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Studio } from "@elaraai/e3-ui";

export const studioComponent = example({
    keywords: [
        "Studio", "component", "Studio.component", "Studio.dispatch", "palette", "placement", "self-contained",
        "ui() body", "state", "shared state", "meta", "span", "category", "icon",
    ],
    description: "A self-contained component — an East UI function written like a ui() body, declared once with what the palette shows — and two placements of it, which share its own state",
    fn: East.function([], UIComponentType, ($) => {
        const counter = $.let(Studio.component("counter", {
            name: "Counter", category: "Display", icon: "gauge-high", span: 4n, description: "Clicks so far",
        }, East.function([], UIComponentType, _$ => (
            <Reactive>{$2 => {
                const clicks = $2.let(State.bind([IntegerType], "studio-component.clicks", 0n));
                const add = $2.const(East.function([], NullType, $3 => { $3(clicks.write(clicks.read().add(1n))); }));
                return (
                    <HStack gap="3" align="center">
                        <Text>{East.str`${East.print(clicks.read())} clicks`}</Text>
                        <Button size="xs" onClick={add}>Add</Button>
                    </HStack>
                );
            }}</Reactive>
        ))));
        const components = $.let([counter]);
        return (
            <VStack gap="3" align="stretch">
                {Studio.dispatch(components, "counter")}
                {Studio.dispatch(components, "counter")}
            </VStack>
        );
    }),
    inputs: [],
});

export const studioDispatch = example({
    keywords: ["Studio", "Studio.dispatch", "placement", "placeholder", "unknown component", "duplicate key", "error"],
    description: "How a placement renders: the component its surface lists under the key; a key the surface does not list is a placeholder naming it; a key two listed components share is an error naming it",
    fn: East.function([], UIComponentType, ($) => {
        const hello = $.let(Studio.component("hello", {
            name: "Hello", category: "Display", icon: "hand",
        }, East.function([], UIComponentType, _$ => <Text>Hello from a component</Text>)));
        const components = $.let([hello]);
        const twice = $.let([hello, hello]);
        return (
            <VStack gap="4" align="stretch">
                {Studio.dispatch(components, "hello")}
                {Studio.dispatch(components, "retired")}
                {Studio.dispatch(twice, "hello")}
            </VStack>
        );
    }),
    inputs: [],
});
