/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Collapsible, Text, VStack, Reactive } from "@elaraai/east-ui/jsx";

export const collapsibleWhy = example({
    keywords: ["Collapsible", "Root", "why", "show more", "inline drawer"],
    description: "Inline 'Why?' drawer revealing rationale text",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Collapsible trigger={<Text color="blue.500">Why did we recommend this?</Text>} defaultOpen={false}>
                <Box padding="3" background="bg.subtle" borderRadius="md">
                    <Text color="fg.muted">Stage 1 was delayed ~6h due to setpoint drift since 02:00. Redirecting feedstock to Stage 2 reduces unmet demand at the cost of 1.2% yield.</Text>
                </Box>
            </Collapsible>
        );
    }),
    inputs: [],
});

export const collapsibleDefaultOpen = example({
    keywords: ["Collapsible", "Root", "defaultOpen", "expanded"],
    description: "Collapsible that starts expanded",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Collapsible trigger="Details" defaultOpen={true}>
                <Text>This content is visible by default because defaultOpen is true.</Text>
            </Collapsible>
        );
    }),
    inputs: [],
});

export const collapsibleReactive = example({
    keywords: ["Collapsible", "Reactive", "State", "onOpenChange", "interactive"],
    description: "Reactive collapsible that persists its open state",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([BooleanType], "collapsible_open", false));
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, open) => {
                $(bind.write(open));
            }));
            return (
                <VStack gap="2">
                    <Collapsible trigger={<Text>Toggle me</Text>} onOpenChange={onOpenChange}>
                        <Box padding="3" background="bg.subtle"><Text>Toggled content</Text></Box>
                    </Collapsible>
                    <Text color="fg.muted">{bind.read().ifElse(_$ => "Open", _$ => "Closed")}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const collapsibleBranded = example({
    keywords: ["Collapsible", "style", "background", "borderColor", "branded"],
    description: "Branded collapsible with full colour escape hatches",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Collapsible
                trigger="Branded trigger"
                defaultOpen={true}
                background="#f9fafb"
                borderColor="#3d5cff"
                triggerColor="#1a2234"
                contentColor="#374151"
            >
                <Box padding="3"><Text>Branded content</Text></Box>
            </Collapsible>
        );
    }),
    inputs: [],
});
