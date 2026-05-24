/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, NullType, example, some, none } from "@elaraai/east";
import { Button, Card, Dialog, Reactive, Stack, State, Status, Text, UIComponentType } from "@elaraai/east-ui";

export const dialogBasic = example({
    keywords: ["Dialog", "Root", "title", "description", "modal"],
    description: "Modal overlay dialog",
    fn: East.function([], UIComponentType, (_$) => {
        return Dialog.Root(
            Button.Root("Open Dialog"),
            [
                Text.Root("This is a dialog. It appears as a modal overlay and captures focus."),
                Stack.HStack([
                    Button.Root("Cancel", { style: { variant: "outline" } }),
                    Button.Root("Confirm", { style: { variant: "solid" } }),
                ], { gap: "2", justify: "flex-end" }),
            ],
            { title: "Confirm Action", description: "Are you sure you want to proceed?" }
        );
    }),
    inputs: [],
});

export const dialogLarge = example({
    keywords: ["Dialog", "Root", "size", "lg", "Card"],
    description: "Dialog with more content",
    fn: East.function([], UIComponentType, (_$) => {
        return Dialog.Root(
            Button.Root("Open Settings", { style: { variant: "outline" } }),
            [
                Stack.VStack([
                    Text.Root("Configure your preferences below. Changes will be saved automatically."),
                    Card.Root([
                        Text.Root("Notification settings, privacy options, and more would go here."),
                    ]),
                ], { gap: "4" }),
            ],
            { title: "Settings", size: "lg" }
        );
    }),
    inputs: [],
});

export const dialogInteractive = example({
    keywords: ["Dialog", "Root", "Reactive", "State", "onOpenChange", "interactive"],
    description: "Dialog with onOpenChange callback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const openCountBind = $.let(State.bind([IntegerType], "dialog_open_count", 0n));
            const closeCountBind = $.let(State.bind([IntegerType], "dialog_close_count", 0n));

            const onOpenChange = $.const(East.function(
                [BooleanType],
                NullType,
                ($, isOpen) => {
                    const openCount = $.let(openCountBind.read());
                    const closeCount = $.let(closeCountBind.read());
                    $.if(isOpen, $ => {
                        $(openCountBind.write(openCount.add(1n)));
                    }).else($ => {
                        $(closeCountBind.write(closeCount.add(1n)));
                    });
                }
            ));

            const openCount = $.let(openCountBind.read());
            const closeCount = $.let(closeCountBind.read());

            return Stack.VStack([
                Dialog.Root(
                    Button.Root("Open Dialog"),
                    [
                        Text.Root("This dialog tracks when it's opened and closed."),
                        Stack.HStack([
                            Button.Root("Got it!", { style: { variant: "solid" } }),
                        ], { gap: "2", justify: "flex-end" }),
                    ],
                    { title: "Interactive Dialog", onOpenChange }
                ),
                Stack.HStack([
                    Status.Root(Text.Root(East.str`OPENED · ${East.print(openCount)}`), { value: "success" }),
                    Status.Root(Text.Root(East.str`CLOSED · ${East.print(closeCount)}`), { value: "danger" }),
                ], { gap: "3" }),
            ], { gap: "3", align: "flex-start" });
        }));
    }),
    inputs: [],
});

export const dialogProgrammatic = example({
    keywords: ["Dialog", "open", "programmatic", "onClick"],
    description: "Dialog.open() without trigger",
    fn: East.function([], UIComponentType, (_$) => {
        return Button.Root("Open Dialog Programmatically", {
            style: { variant: "solid" },
            onClick: East.function([], NullType, $ => {
                $(Dialog.open(East.value({
                    body: [
                        Text.Root("This dialog was opened programmatically using Dialog.open()."),
                        Stack.HStack([
                            Button.Root("Cool!", { style: { variant: "solid" } }),
                        ], { gap: "2", justify: "flex-end" }),
                    ],
                    eyebrow: some("Confirm · programmatic"),
                    title: some("Programmatic Dialog"),
                    description: some("No trigger element needed"),
                    style: none,
                }, Dialog.Types.OpenInput)));
            }),
        });
    }),
    inputs: [],
});
