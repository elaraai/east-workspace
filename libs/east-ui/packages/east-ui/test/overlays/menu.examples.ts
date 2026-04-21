/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, NullType, StringType, example } from "@elaraai/east";
import { Badge, Button, Menu, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const menuBasic = example({
    keywords: ["Menu", "Root", "Item", "Separator", "dropdown"],
    description: "Simple dropdown menu",
    fn: East.function([], UIComponentType, (_$) => {
        return Menu.Root(
            Button.Root("Open Menu"),
            [
                Menu.Item("view", "View"),
                Menu.Item("edit", "Edit"),
                Menu.Separator(),
                Menu.Item("delete", "Delete"),
            ]
        );
    }),
    inputs: [],
});

export const menuDisabled = example({
    keywords: ["Menu", "Root", "Item", "disabled"],
    description: "Some items are disabled",
    fn: East.function([], UIComponentType, (_$) => {
        return Menu.Root(
            Button.Root("Options", { variant: "outline" }),
            [
                Menu.Item("new", "New File"),
                Menu.Item("save", "Save", true),
                Menu.Separator(),
                Menu.Item("close", "Close"),
            ]
        );
    }),
    inputs: [],
});

export const menuOnSelect = example({
    keywords: ["Menu", "Reactive", "State", "onSelect", "interactive"],
    description: "Menu whose onSelect records the last clicked item value",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([StringType], "menu_last_selected", ""));
            const last = $.let(bind.read());
            const onSelect = $.const(East.function([StringType], NullType, ($, val) => {
                $(bind.write(val));
            }));
            return Stack.VStack([
                Menu.Root(
                    Button.Root("Open Menu"),
                    [
                        Menu.Item("view", "View"),
                        Menu.Item("edit", "Edit"),
                        Menu.Separator(),
                        Menu.Item("delete", "Delete"),
                    ],
                    { onSelect }
                ),
                Text.Root(East.str`Last selected: ${East.greater(last.length(), 0n).ifElse(
                    _$ => last,
                    _$ => "(none)",
                )}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const menuOnOpenChange = example({
    keywords: ["Menu", "Reactive", "State", "onOpenChange", "interactive"],
    description: "Menu whose onOpenChange counts open/close transitions",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([IntegerType], "menu_toggles", 0n));
            const value = $.let(bind.read());
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, _open) => {
                const cur = $.let(bind.read());
                $(bind.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Menu.Root(
                    Button.Root("Open me…"),
                    [
                        Menu.Item("a", "Apple"),
                        Menu.Item("b", "Banana"),
                    ],
                    { onOpenChange }
                ),
                Badge.Root(East.str`Toggled ${East.print(value)} times`, { colorPalette: "blue" }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
