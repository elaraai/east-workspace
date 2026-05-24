/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, NullType, variant, example, some, none } from "@elaraai/east";
import { Button, Drawer, Reactive, Stack, State, Status, Text, UIComponentType } from "@elaraai/east-ui";

export const drawerRight = example({
    keywords: ["Drawer", "Root", "placement", "end", "right"],
    description: "Slide-in panel from right",
    fn: East.function([], UIComponentType, (_$) => {
        return Drawer.Root(
            Button.Root("Open Drawer"),
            [
                Stack.VStack([
                    Text.Root("This is a drawer panel that slides in from the side."),
                    Text.Root("Great for navigation, settings, or detailed content.", { color: "fg.muted" }),
                ], { gap: "4" }),
            ],
            { title: "Drawer Title", description: "Slide-in panel", placement: "end", size: "md" }
        );
    }),
    inputs: [],
});

export const drawerLeft = example({
    keywords: ["Drawer", "Root", "placement", "start", "left", "navigation"],
    description: "Slide-in panel from left",
    fn: East.function([], UIComponentType, (_$) => {
        return Drawer.Root(
            Button.Root("Open Navigation", { style: { variant: "outline" } }),
            [
                Stack.VStack([
                    Button.Root("Dashboard", { style: { variant: "ghost", size: "sm" } }),
                    Button.Root("Projects", { style: { variant: "ghost", size: "sm" } }),
                    Button.Root("Team", { style: { variant: "ghost", size: "sm" } }),
                    Button.Root("Settings", { style: { variant: "ghost", size: "sm" } }),
                ], { gap: "1", align: "stretch" }),
            ],
            { title: "Navigation", placement: "start" }
        );
    }),
    inputs: [],
});

export const drawerInteractive = example({
    keywords: ["Drawer", "Root", "Reactive", "State", "onOpenChange", "interactive"],
    description: "Drawer with onOpenChange callback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const openCountBind = $.let(State.bind([IntegerType], "drawer_open_count", 0n));

            const onOpenChange = $.const(East.function(
                [BooleanType],
                NullType,
                ($, isOpen) => {
                    const openCount = $.let(openCountBind.read());
                    $.if(isOpen, $ => {
                        $(openCountBind.write(openCount.add(1n)));
                    });
                }
            ));

            const openCount = $.let(openCountBind.read());

            return Stack.VStack([
                Drawer.Root(
                    Button.Root("Open Drawer"),
                    [
                        Stack.VStack([
                            Text.Root("This drawer counts how many times it's been opened."),
                            Status.Root(Text.Root(East.str`OPENED · ${East.print(openCount)} TIMES`), { value: "info" }),
                        ], { gap: "4" }),
                    ],
                    { title: "Interactive Drawer", placement: "end", onOpenChange }
                ),
                Status.Root(Text.Root(East.str`DRAWER OPENED · ${East.print(openCount)} TIMES`), { value: "info" }),
            ], { gap: "3", align: "flex-start" });
        }));
    }),
    inputs: [],
});

export const drawerProgrammatic = example({
    keywords: ["Drawer", "open", "programmatic", "onClick"],
    description: "Drawer.open() without trigger — defaults to brand-d primary button",
    fn: East.function([], UIComponentType, (_$) => {
        return Button.Root("Open Drawer Programmatically", {
            style: { variant: "solid" },
            onClick: East.function([], NullType, $ => {
                $(Drawer.open(East.value({
                    body: [
                        Stack.VStack([
                            Text.Root("This drawer was opened programmatically using Drawer.open()."),
                            Text.Root("Great for navigation, notifications, or dynamic content.", { color: "fg.muted" }),
                        ], { gap: "4" }),
                    ],
                    title: some("Programmatic Drawer"),
                    description: some("Opened via Drawer.open()"),
                    style: none,
                }, Drawer.Types.OpenInput)));
            }),
        });
    }),
    inputs: [],
});
