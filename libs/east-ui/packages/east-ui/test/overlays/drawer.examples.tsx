/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, IntegerType, NullType, example, some, none } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Button, Drawer, Reactive, Status, Text, VStack } from "@elaraai/east-ui";

export const drawerRight = example({
    keywords: ["Drawer", "Root", "placement", "end", "right", "eyebrow"],
    description: "Slide-in panel from right with the surface-header eyebrow",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Drawer trigger={<Button>Open Drawer</Button>} eyebrow="Rail · detail" title="Drawer Title" description="Slide-in panel" placement="end" size="md">
                <VStack gap="4">
                    <Text>This is a drawer panel that slides in from the side.</Text>
                    <Text color="fg.muted">Great for navigation, settings, or detailed content.</Text>
                </VStack>
            </Drawer>
        );
    }),
    inputs: [],
});

export const drawerLeft = example({
    keywords: ["Drawer", "Root", "placement", "start", "left", "navigation"],
    description: "Slide-in panel from left",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Drawer trigger={<Button variant="outline">Open Navigation</Button>} title="Navigation" placement="start">
                <VStack gap="1" align="stretch">
                    <Button variant="ghost" size="sm">Overview</Button>
                    <Button variant="ghost" size="sm">Projects</Button>
                    <Button variant="ghost" size="sm">Team</Button>
                    <Button variant="ghost" size="sm">Settings</Button>
                </VStack>
            </Drawer>
        );
    }),
    inputs: [],
});

export const drawerInteractive = example({
    keywords: ["Drawer", "Root", "Reactive", "State", "onOpenChange", "interactive"],
    description: "Drawer with onOpenChange callback",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const openCountBind = $.let(State.bind([IntegerType], "drawer_open_count", 0n));
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, isOpen) => {
                const openCount = $.let(openCountBind.read());
                $.if(isOpen, $ => {
                    $(openCountBind.write(openCount.add(1n)));
                });
            }));
            const openCount = $.let(openCountBind.read());
            return (
                <VStack gap="3" align="flex-start">
                    <Drawer trigger={<Button>Open Drawer</Button>} title="Interactive Drawer" placement="end" onOpenChange={onOpenChange}>
                        <VStack gap="4">
                            <Text>This drawer counts how many times it’s been opened.</Text>
                            <Status label={<Text>{East.str`OPENED · ${East.print(openCount)} TIMES`}</Text>} value="info" />
                        </VStack>
                    </Drawer>
                    <Status label={<Text>{East.str`DRAWER OPENED · ${East.print(openCount)} TIMES`}</Text>} value="info" />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const drawerProgrammatic = example({
    keywords: ["Drawer", "open", "programmatic", "onClick"],
    description: "Drawer.open() without trigger — defaults to brand-d primary button",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Button
                variant="solid"
                onClick={East.function([], NullType, $ => {
                    $(Drawer.open(East.value({
                        body: [
                            <VStack gap="4">
                                <Text>This drawer was opened programmatically using Drawer.open().</Text>
                                <Text color="fg.muted">Great for navigation, notifications, or dynamic content.</Text>
                            </VStack>,
                        ],
                        eyebrow: some("Rail · programmatic"),
                        title: some("Programmatic Drawer"),
                        description: some("Opened via Drawer.open()"),
                        style: none,
                    }, Drawer.Types.OpenInput)));
                })}
            >Open Drawer Programmatically</Button>
        );
    }),
    inputs: [],
});

export const drawerFlush = example({
    keywords: ["Drawer", "flush", "bodyPadding", "fillBody", "full-bleed", "padding", "fill-height", "scroll"],
    description: "Body padding control: a full-bleed fill-height body (flush + fillBody) so a single child fills the panel and owns its own scroll, plus a custom bodyPadding inset",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="2" align="flex-start">
                <Drawer trigger={<Button>Open Full-bleed Drawer</Button>} eyebrow="Rail · data" title="Full-bleed body" placement="end" size="md" flush fillBody>
                    <Box height="100%" overflowY="auto">
                        <VStack gap="2" align="stretch">
                            <Text>This body is flush (zero padding) and fills the panel height.</Text>
                            <Text color="fg.muted">A single height:100% child owns its scrollbar instead of the whole panel scrolling.</Text>
                        </VStack>
                    </Box>
                </Drawer>
                <Drawer trigger={<Button variant="outline">Open Custom-inset Drawer</Button>} title="Custom inset" placement="end" size="md" bodyPadding="8px 12px">
                    <Text>This body uses a custom bodyPadding of 8px 12px instead of the default 16px 20px.</Text>
                </Drawer>
            </VStack>
        );
    }),
    inputs: [],
});
