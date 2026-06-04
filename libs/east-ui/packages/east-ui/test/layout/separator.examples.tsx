/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Separator, Text, VStack, HStack, Reactive } from "@elaraai/east-ui/jsx";

export const separatorHorizontal = example({
    keywords: ["Separator", "Root", "orientation", "horizontal"],
    description: "Default horizontal divider",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" width="100%">
                <Text>Content above</Text>
                <Separator orientation="horizontal" />
                <Text>Content below</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const separatorVertical = example({
    keywords: ["Separator", "Root", "orientation", "vertical"],
    description: "Vertical divider between content",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4" align="center">
                <Text>Left</Text>
                <Box height="40px">
                    <Separator orientation="vertical" />
                </Box>
                <Text>Right</Text>
            </HStack>
        );
    }),
    inputs: [],
});

export const separatorSubtle = example({
    keywords: ["Separator", "Root", "variant", "subtle"],
    description: "Default subtle hairline (rule)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" width="100%">
                <Text>Above</Text>
                <Separator variant="subtle" />
                <Text>Below</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const separatorStrong = example({
    keywords: ["Separator", "Root", "variant", "strong"],
    description: "Strong hairline (rule-strong)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" width="100%">
                <Text>Above</Text>
                <Separator variant="strong" />
                <Text>Below</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const separatorDashed = example({
    keywords: ["Separator", "Root", "variant", "dashed"],
    description: "Dashed hairline (rule-strong)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" width="100%">
                <Text>Above</Text>
                <Separator variant="dashed" />
                <Text>Below</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const separatorBrand = example({
    keywords: ["Separator", "Root", "variant", "brand"],
    description: "Brand hairline",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" width="100%">
                <Text>Above</Text>
                <Separator variant="brand" />
                <Text>Below</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const separatorLabeled = example({
    keywords: ["Separator", "Root", "label"],
    description: "Separator with centered label",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" width="100%">
                <Text>Sign in with email</Text>
                <Separator label="OR" />
                <Text>Continue with social</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const separatorFormDivider = example({
    keywords: ["Separator", "Root", "label", "form"],
    description: "Labeled divider for form sections",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" width="100%">
                <Text>Personal Information</Text>
                <Separator label="Contact Details" />
                <Text>Email and Phone fields...</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const separatorInteractive = example({
    keywords: ["Separator", "Reactive", "State", "interactive", "label"],
    description: "Separator whose label updates from a reactive counter",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const counter = $.let(State.bind([IntegerType], "separator_counter", 0n));
            const value = $.let(counter.read());
            const inc = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Text>Above</Text>
                    {/* dynamic-string labels need an explicit Text wrap so the
                        string→UIComp coercion is unambiguous; plain string labels auto-coerce */}
                    <Separator label={<Text>{East.str`STEP ${East.print(value)}`}</Text>} />
                    <Text>Below</Text>
                    <Button onClick={inc}>Next step</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const separatorWithEyebrow = example({
    keywords: ["Separator", "Root", "label", "align", "eyebrow", "chain-divider"],
    description: "Horizontal separator with an uppercase muted caption label centred between hairlines",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" align="stretch">
                <Text>Phase 1 — Triage</Text>
                <Separator label="Cross-phase decisions" align="center" variant="subtle" />
                <Text>Phase 2 — Deliver</Text>
            </VStack>
        );
    }),
    inputs: [],
});

export const separatorAlignedStart = example({
    keywords: ["Separator", "Root", "label", "align", "start"],
    description: "Separator with the label biased toward the leading edge",
    fn: East.function([], UIComponentType, (_$) => {
        return <Separator label="Notes" align="start" />;
    }),
    inputs: [],
});
