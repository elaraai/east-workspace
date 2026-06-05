/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Button, IconButton, Menu } from "@elaraai/east-ui";

export const menuBasic = example({
    keywords: ["Menu", "Root", "Item", "Separator", "dropdown", "kebab"],
    description: "Kebab-trigger menu — canonical row-end overflow",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Menu
                trigger={<IconButton prefix="fas" name="ellipsis" label="More" variant="ghost" size="sm" />}
                items={[
                    Menu.Item("view", "View"),
                    Menu.Item("edit", "Edit"),
                    Menu.Separator(),
                    Menu.Item("delete", "Delete"),
                ]}
            />
        );
    }),
    inputs: [],
});

export const menuDisabled = example({
    keywords: ["Menu", "Root", "Item", "disabled", "kebab"],
    description: "Kebab trigger with some disabled items",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Menu
                trigger={<IconButton prefix="fas" name="ellipsis" label="Options" variant="ghost" size="sm" />}
                items={[
                    Menu.Item("new", "New File"),
                    Menu.Item("save", "Save", true),
                    Menu.Separator(),
                    Menu.Item("close", "Close"),
                ]}
            />
        );
    }),
    inputs: [],
});

export const menuPlacement = example({
    keywords: ["Menu", "Root", "Item", "placement", "style"],
    description: "Menu with explicit placement on the style sub-struct",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Menu
                trigger={<Button>Account</Button>}
                placement="bottom-end"
                items={[
                    Menu.Item("profile", "View Profile"),
                    Menu.Item("settings", "Settings"),
                    Menu.Separator(),
                    Menu.Item("logout", "Log Out"),
                ]}
            />
        );
    }),
    inputs: [],
});
