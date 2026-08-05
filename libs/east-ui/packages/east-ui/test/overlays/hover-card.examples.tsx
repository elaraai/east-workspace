/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, IntegerType, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Avatar, Badge, Button, Configurator, HoverCard, HStack, Reactive, SegmentGroup, Text, VStack } from "@elaraai/east-ui";

export const hoverCardProfile = example({
    keywords: ["HoverCard", "Root", "Avatar", "Badge", "profile", "title"],
    description: "Rich preview on hover with the mono eyebrow title",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HoverCard trigger={<Text color="link" fontWeight="medium">@johndoe</Text>} title="Operator · @johndoe" placement="bottom" openDelay={200n}>
                <HStack gap="3">
                    <Avatar name="John Doe" size="lg" />
                    <VStack gap="1" align="flex-start">
                        <Text fontWeight="semibold">John Doe</Text>
                        <Text textStyle="body-sm" color="fg.muted">Software Engineer</Text>
                        <HStack gap="1">
                            <Badge variant="subtle">Pro</Badge>
                            <Badge colorPalette="success" variant="subtle">Verified</Badge>
                        </HStack>
                    </VStack>
                </HStack>
            </HoverCard>
        );
    }),
    inputs: [],
});

export const hoverCardVariants = example({
    keywords: ["HoverCard", "Root", "link", "preview", "title", "description", "Reactive", "State", "onOpenChange", "interactive", "SegmentGroup", "Configurator", "configurator"],
    description: "HoverCard configurator — a content preset axis (profile / link) on one live card; the aside counts hover-open transitions",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presets = $.const(["profile", "link"], ArrayType(StringType));

            const presetBind = $.let(State.bind([StringType], "hovercard_preset", "profile"));
            const togglesBind = $.let(State.bind([IntegerType], "hovercard_toggles", 0n));

            const pKey = $.let(presetBind.read());
            const toggles = $.let(togglesBind.read());

            const onPreset = $.const(East.function([StringType], NullType, ($, next) => { $(presetBind.write(next)); }));
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, _open) => {
                const cur = $.let(togglesBind.read());
                $(togglesBind.write(cur.add(1n)));
            }));

            const preview = $.const(pKey.equal("link").ifElse(
                _$ => (
                    <HoverCard
                        trigger={<Button variant="ghost">View Documentation</Button>}
                        title="East UI · docs"
                        description="Complete guide to building UIs with East UI components."
                        placement="bottom-start"
                        onOpenChange={onOpenChange}
                    >
                        <Text textStyle="body-sm">Learn about layout, forms, charts, and more.</Text>
                    </HoverCard>
                ),
                _$ => (
                    <HoverCard trigger={<Text color="link" fontWeight="medium">@johndoe</Text>} title="Operator · @johndoe" placement="bottom" openDelay={200n} onOpenChange={onOpenChange}>
                        <HStack gap="3">
                            <Avatar name="John Doe" size="lg" />
                            <VStack gap="1" align="flex-start">
                                <Text fontWeight="semibold">John Doe</Text>
                                <Text textStyle="body-sm" color="fg.muted">Software Engineer</Text>
                                <HStack gap="1">
                                    <Badge variant="subtle">Pro</Badge>
                                    <Badge colorPalette="success" variant="subtle">Verified</Badge>
                                </HStack>
                            </VStack>
                        </HStack>
                    </HoverCard>
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Content", pKey,
                            <SegmentGroup value={pKey} onChange={onPreset} size="sm"
                                items={presets.map((_$, o) => SegmentGroup.Item(o, <Text>{o.upperCase()}</Text>))} />),
                    ]}
                    preview={preview}
                    aside={{
                        label: "onOpenChange · Reactive",
                        body: <Text.MonoLabel>{East.str`TOGGLED · ${East.print(toggles)}`}</Text.MonoLabel>,
                    }}
                    spec={[
                        Configurator.Spec("Open delay", pKey.equal("profile").ifElse(_$ => "200ms", _$ => "default")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
