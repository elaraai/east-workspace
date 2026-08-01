/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Separator, Text, VStack, HStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const separatorBasic = example({
    keywords: ["Separator", "Root", "orientation", "horizontal", "basic"],
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

// ============================================================================
// Separator — orientation, hairline variants, labels (variant panel)
// ============================================================================

export const separatorVariants = example({
    keywords: ["Separator", "Root", "orientation", "vertical", "variant", "subtle", "strong", "dashed", "brand", "label", "form", "align", "eyebrow", "chain-divider", "start", "Reactive", "State", "interactive"],
    description: "Separator variant panel — vertical (vertical divider between content), subtle (default subtle hairline), strong (strong hairline), dashed (dashed hairline), brand (brand hairline), labeled (centered label), form divider (labeled divider for form sections), with eyebrow (uppercase muted caption label centred between hairlines), aligned start (label biased toward the leading edge), interactive (label updates from a reactive counter)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="VERTICAL" align="start" />
                <HStack gap="4" align="center">
                    <Text>Left</Text>
                    <Box height="40px">
                        <Separator orientation="vertical" />
                    </Box>
                    <Text>Right</Text>
                </HStack>
                <Separator label="SUBTLE" align="start" />
                <VStack gap="3" width="100%">
                    <Text>Above</Text>
                    <Separator variant="subtle" />
                    <Text>Below</Text>
                </VStack>
                <Separator label="STRONG" align="start" />
                <VStack gap="3" width="100%">
                    <Text>Above</Text>
                    <Separator variant="strong" />
                    <Text>Below</Text>
                </VStack>
                <Separator label="DASHED" align="start" />
                <VStack gap="3" width="100%">
                    <Text>Above</Text>
                    <Separator variant="dashed" />
                    <Text>Below</Text>
                </VStack>
                <Separator label="BRAND" align="start" />
                <VStack gap="3" width="100%">
                    <Text>Above</Text>
                    <Separator variant="brand" />
                    <Text>Below</Text>
                </VStack>
                <Separator label="LABELED" align="start" />
                <VStack gap="3" width="100%">
                    <Text>Sign in with email</Text>
                    <Separator label="OR" />
                    <Text>Continue with social</Text>
                </VStack>
                <Separator label="FORM DIVIDER" align="start" />
                <VStack gap="3" width="100%">
                    <Text>Personal Information</Text>
                    <Separator label="Contact Details" />
                    <Text>Email and Phone fields...</Text>
                </VStack>
                <Separator label="WITH EYEBROW" align="start" />
                <VStack gap="3" align="stretch">
                    <Text>Phase 1 — Triage</Text>
                    <Separator label="Cross-phase decisions" align="center" variant="subtle" />
                    <Text>Phase 2 — Deliver</Text>
                </VStack>
                <Separator label="ALIGNED START" align="start" />
                <Separator label="Notes" align="start" />
                <Separator label="INTERACTIVE" align="start" />
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
            </VStack>
        );
    }),
    inputs: [],
});
