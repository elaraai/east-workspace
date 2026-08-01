/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Link, Reactive, VStack, HStack, Text } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const linkBasic = example({
    keywords: ["Link", "Root", "basic", "hyperlink"],
    description: "Simple hyperlink",
    fn: East.function([], UIComponentType, (_$) => {
        return <Link href="/home">Click here</Link>;
    }),
    inputs: [],
});

// ============================================================================
// Link — variants, palettes, context (variant panel)
// ============================================================================

export const linkVariants = example({
    keywords: ["Link", "Root", "external", "new tab", "variant", "underline", "plain", "colorPalette", "blue", "teal", "purple", "red", "inline", "context", "text", "combined", "Reactive", "State", "interactive", "counter"],
    description: "Link variant panel — external (opens in new tab), underline (underline decoration), plain (no decoration), colors (links with different colors), in context (link within text flow), combined (external link with all options), interactive (reactive link whose label updates from a counter)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">EXTERNAL</Text>
                    <Link href="https://github.com" external>Visit GitHub</Link>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">UNDERLINE</Text>
                    <Link href="/about" variant="underline">Underlined Link</Link>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">PLAIN</Text>
                    <Link href="/contact" variant="plain">Plain Link</Link>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">COLORS</Text>
                    <HStack gap="4">
                        <Link href="/page" colorPalette="blue">Blue</Link>
                        <Link href="/page" colorPalette="teal">Teal</Link>
                        <Link href="/page" colorPalette="purple">Purple</Link>
                        <Link href="/page" colorPalette="red">Red</Link>
                    </HStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">IN CONTEXT</Text>
                    <HStack gap="1">
                        <Text>{"Read the "}</Text>
                        <Link href="/docs" colorPalette="blue">documentation</Link>
                        <Text>{" for more info."}</Text>
                    </HStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">COMBINED</Text>
                    <Link href="https://docs.example.com" external variant="underline" colorPalette="blue">View Documentation</Link>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">INTERACTIVE</Text>
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
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
