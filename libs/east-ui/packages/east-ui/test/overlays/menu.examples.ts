/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Button, Menu, UIComponentType } from "../../src/index.js";

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
