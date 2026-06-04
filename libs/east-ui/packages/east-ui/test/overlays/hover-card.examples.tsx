/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Avatar, Badge, Button, HoverCard, HStack, Reactive, Text, VStack } from "@elaraai/east-ui/jsx";

export const hoverCardProfile = example({
    keywords: ["HoverCard", "Root", "Avatar", "Badge", "profile"],
    description: "Rich preview on hover",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HoverCard trigger={<Text color="link" fontWeight="medium">@johndoe</Text>} placement="bottom" openDelay={200n}>
                <HStack gap="3">
                    <Avatar name="John Doe" size="lg" />
                    <VStack gap="1" align="flex-start">
                        <Text fontWeight="semibold">John Doe</Text>
                        <Text textStyle="body-sm" color="gray.500">Software Engineer</Text>
                        <HStack gap="1">
                            <Badge colorPalette="purple" variant="solid">Pro</Badge>
                            <Badge colorPalette="green" variant="subtle">Verified</Badge>
                        </HStack>
                    </VStack>
                </HStack>
            </HoverCard>
        );
    }),
    inputs: [],
});

export const hoverCardLink = example({
    keywords: ["HoverCard", "Root", "link", "preview", "hasArrow"],
    description: "Preview content on hover",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HoverCard trigger={<Button variant="ghost" colorPalette="blue">View Documentation</Button>} hasArrow={true}>
                <VStack gap="2" padding="2">
                    <Text fontWeight="semibold">East UI Documentation</Text>
                    <Text textStyle="body-sm" color="gray.600">Complete guide to building UIs with East UI components. Learn about layout, forms, charts, and more.</Text>
                </VStack>
            </HoverCard>
        );
    }),
    inputs: [],
});

export const hoverCardInteractive = example({
    keywords: ["HoverCard", "Reactive", "State", "interactive", "onOpenChange"],
    description: "HoverCard whose onOpenChange counts hover-open transitions",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([IntegerType], "hovercard_toggles", 0n));
            const value = $.let(bind.read());
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, _open) => {
                const cur = $.let(bind.read());
                $(bind.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="flex-start">
                    <HoverCard trigger={<Button>Hover me</Button>} onOpenChange={onOpenChange}>
                        <Text>HoverCard content shown on hover</Text>
                    </HoverCard>
                    {Text.Presets.MonoLabel(East.str`TOGGLED · ${East.print(value)}`)}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
