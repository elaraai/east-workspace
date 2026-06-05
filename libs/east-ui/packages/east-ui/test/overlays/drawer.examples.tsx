/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, IntegerType, NullType, example, some, none } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Drawer, Reactive, Status, Text, VStack } from "@elaraai/east-ui";

export const drawerRight = example({
    keywords: ["Drawer", "Root", "placement", "end", "right"],
    description: "Slide-in panel from right",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Drawer trigger={<Button>Open Drawer</Button>} title="Drawer Title" description="Slide-in panel" placement="end" size="md">
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
                    <Button variant="ghost" size="sm">Dashboard</Button>
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
                            <Text>This drawer counts how many times it's been opened.</Text>
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
