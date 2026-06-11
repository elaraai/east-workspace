/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Code, Reactive, VStack, HStack } from "@elaraai/east-ui";

export const codeBasic = example({
    keywords: ["Code", "Root", "basic", "inline"],
    description: "Plain inline code snippet",
    fn: East.function([], UIComponentType, (_$) => {
        return <Code>const x = 1</Code>;
    }),
    inputs: [],
});

export const codeSubtle = example({
    keywords: ["Code", "Root", "variant", "subtle"],
    description: "Code with subtle background",
    fn: East.function([], UIComponentType, (_$) => {
        return <Code variant="subtle">npm install</Code>;
    }),
    inputs: [],
});

export const codeSurface = example({
    keywords: ["Code", "Root", "variant", "surface"],
    description: "Code with surface styling",
    fn: East.function([], UIComponentType, (_$) => {
        return <Code variant="surface">npm run build</Code>;
    }),
    inputs: [],
});

export const codeOutline = example({
    keywords: ["Code", "Root", "variant", "outline"],
    description: "Code with outline border",
    fn: East.function([], UIComponentType, (_$) => {
        return <Code variant="outline">npm test</Code>;
    }),
    inputs: [],
});

export const codeSizes = example({
    keywords: ["Code", "Root", "size", "xs", "sm", "md", "lg"],
    description: "Different code sizes",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4">
                <Code size="xs">xs</Code>
                <Code size="sm">sm</Code>
                <Code size="md">md</Code>
                <Code size="lg">lg</Code>
            </HStack>
        );
    }),
    inputs: [],
});

export const codeColors = example({
    keywords: ["Code", "Root", "colorPalette", "gray", "blue", "green", "red"],
    description: "Code with different color schemes",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="3">
                <Code variant="subtle" colorPalette="gray">gray</Code>
                <Code variant="subtle" colorPalette="blue">blue</Code>
                <Code variant="subtle" colorPalette="green">green</Code>
                <Code variant="subtle" colorPalette="red">red</Code>
            </HStack>
        );
    }),
    inputs: [],
});

export const codeCombined = example({
    keywords: ["Code", "Root", "combined", "variant", "colorPalette", "size"],
    description: "Code with multiple style options",
    fn: East.function([], UIComponentType, (_$) => {
        return <Code variant="surface" colorPalette="purple" size="md">console.log('Hello')</Code>;
    }),
    inputs: [],
});

export const codeInteractive = example({
    keywords: ["Code", "Reactive", "State", "interactive", "counter"],
    description: "Reactive code snippet whose value updates from a counter",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const counter = $.let(State.bind([IntegerType], "code_counter", 0n));
            const value = $.let(counter.read());
            const increment = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Code>{East.str`const count = ${East.print(value)};`}</Code>
                    <Button onClick={increment}>Increment</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
