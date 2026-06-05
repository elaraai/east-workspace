/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, IntegerType, NullType, example, some, none } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Card, Dialog, HStack, Reactive, Status, Text, VStack } from "@elaraai/east-ui";

export const dialogBasic = example({
    keywords: ["Dialog", "Root", "title", "description", "modal"],
    description: "Modal overlay dialog",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Dialog trigger={<Button>Open Dialog</Button>} title="Confirm Action" description="Are you sure you want to proceed?">
                <Text>This is a dialog. It appears as a modal overlay and captures focus.</Text>
                <HStack gap="2" justify="flex-end">
                    <Button variant="outline">Cancel</Button>
                    <Button variant="solid">Confirm</Button>
                </HStack>
            </Dialog>
        );
    }),
    inputs: [],
});

export const dialogLarge = example({
    keywords: ["Dialog", "Root", "size", "lg", "Card"],
    description: "Dialog with more content",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Dialog trigger={<Button variant="outline">Open Settings</Button>} title="Settings" size="lg">
                <VStack gap="4">
                    <Text>Configure your preferences below. Changes will be saved automatically.</Text>
                    <Card>
                        <Text>Notification settings, privacy options, and more would go here.</Text>
                    </Card>
                </VStack>
            </Dialog>
        );
    }),
    inputs: [],
});

export const dialogInteractive = example({
    keywords: ["Dialog", "Root", "Reactive", "State", "onOpenChange", "interactive"],
    description: "Dialog with onOpenChange callback",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const openCountBind = $.let(State.bind([IntegerType], "dialog_open_count", 0n));
            const closeCountBind = $.let(State.bind([IntegerType], "dialog_close_count", 0n));
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, isOpen) => {
                const openCount = $.let(openCountBind.read());
                const closeCount = $.let(closeCountBind.read());
                $.if(isOpen, $ => {
                    $(openCountBind.write(openCount.add(1n)));
                }).else($ => {
                    $(closeCountBind.write(closeCount.add(1n)));
                });
            }));
            const openCount = $.let(openCountBind.read());
            const closeCount = $.let(closeCountBind.read());
            return (
                <VStack gap="3" align="flex-start">
                    <Dialog trigger={<Button>Open Dialog</Button>} title="Interactive Dialog" onOpenChange={onOpenChange}>
                        <Text>This dialog tracks when it’s opened and closed.</Text>
                        <HStack gap="2" justify="flex-end">
                            <Button variant="solid">Got it!</Button>
                        </HStack>
                    </Dialog>
                    <HStack gap="3">
                        <Status label={<Text>{East.str`OPENED · ${East.print(openCount)}`}</Text>} value="success" />
                        <Status label={<Text>{East.str`CLOSED · ${East.print(closeCount)}`}</Text>} value="danger" />
                    </HStack>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const dialogProgrammatic = example({
    keywords: ["Dialog", "open", "programmatic", "onClick"],
    description: "Dialog.open() without trigger",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Button
                variant="solid"
                onClick={East.function([], NullType, $ => {
                    $(Dialog.open(East.value({
                        body: [
                            <Text>This dialog was opened programmatically using Dialog.open().</Text>,
                            <HStack gap="2" justify="flex-end">
                                <Button variant="solid">Cool!</Button>
                            </HStack>,
                        ],
                        eyebrow: some("Confirm · programmatic"),
                        title: some("Programmatic Dialog"),
                        description: some("No trigger element needed"),
                        style: none,
                    }, Dialog.Types.OpenInput)));
                })}
            >Open Dialog Programmatically</Button>
        );
    }),
    inputs: [],
});
