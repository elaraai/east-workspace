/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Button, Menu, UIComponentType } from "@elaraai/east-ui";

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
            Button.Root("Options", { style: { variant: "outline" } }),
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

export const menuPlacement = example({
    keywords: ["Menu", "Root", "Item", "placement", "style"],
    description: "Menu with explicit placement on the style sub-struct",
    fn: East.function([], UIComponentType, (_$) => {
        return Menu.Root(
            Button.Root("Account"),
            [
                Menu.Item("profile", "View Profile"),
                Menu.Item("settings", "Settings"),
                Menu.Separator(),
                Menu.Item("logout", "Log Out"),
            ],
            { placement: "bottom-end" },
        );
    }),
    inputs: [],
});
