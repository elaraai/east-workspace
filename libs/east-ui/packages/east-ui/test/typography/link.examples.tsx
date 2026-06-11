/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Link, Reactive, VStack, HStack, Text } from "@elaraai/east-ui";

export const linkBasic = example({
    keywords: ["Link", "Root", "basic", "hyperlink"],
    description: "Simple hyperlink",
    fn: East.function([], UIComponentType, (_$) => {
        return <Link href="/home">Click here</Link>;
    }),
    inputs: [],
});

export const linkExternal = example({
    keywords: ["Link", "Root", "external", "new tab"],
    description: "Opens in new tab",
    fn: East.function([], UIComponentType, (_$) => {
        return <Link href="https://github.com" external>Visit GitHub</Link>;
    }),
    inputs: [],
});

export const linkUnderline = example({
    keywords: ["Link", "Root", "variant", "underline"],
    description: "Link with underline decoration",
    fn: East.function([], UIComponentType, (_$) => {
        return <Link href="/about" variant="underline">Underlined Link</Link>;
    }),
    inputs: [],
});

export const linkPlain = example({
    keywords: ["Link", "Root", "variant", "plain"],
    description: "Link without decoration",
    fn: East.function([], UIComponentType, (_$) => {
        return <Link href="/contact" variant="plain">Plain Link</Link>;
    }),
    inputs: [],
});

export const linkColors = example({
    keywords: ["Link", "Root", "colorPalette", "blue", "teal", "purple", "red"],
    description: "Links with different colors",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4">
                <Link href="/page" colorPalette="blue">Blue</Link>
                <Link href="/page" colorPalette="teal">Teal</Link>
                <Link href="/page" colorPalette="purple">Purple</Link>
                <Link href="/page" colorPalette="red">Red</Link>
            </HStack>
        );
    }),
    inputs: [],
});

export const linkInContext = example({
    keywords: ["Link", "Root", "inline", "context", "text"],
    description: "Link within text flow",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="1">
                <Text>{"Read the "}</Text>
                <Link href="/docs" colorPalette="blue">documentation</Link>
                <Text>{" for more info."}</Text>
            </HStack>
        );
    }),
    inputs: [],
});

export const linkCombined = example({
    keywords: ["Link", "Root", "combined", "external", "variant", "colorPalette"],
    description: "External link with all options",
    fn: East.function([], UIComponentType, (_$) => {
        return <Link href="https://docs.example.com" external variant="underline" colorPalette="blue">View Documentation</Link>;
    }),
    inputs: [],
});

export const linkInteractive = example({
    keywords: ["Link", "Reactive", "State", "interactive", "counter"],
    description: "Reactive link whose label updates from a counter",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const counter = $.let(State.bind([IntegerType], "link_counter", 0n));
            const value = $.let(counter.read());
            const increment = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Text>Click the button to relabel the link:</Text>
                    <Link href="https://example.com" external>{East.str`Visited ${East.print(value)} times — click here`}</Link>
                    <Button onClick={increment}>Bump label</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
