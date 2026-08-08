/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, IconButton, Menu, Reactive} from "@elaraai/east-ui";

export const menuBasic = example({
    keywords: ["Menu", "Root", "Item", "GroupLabel", "Separator", "dropdown", "kebab", "icon", "command", "destructive"],
    description: "Kebab-trigger menu — canonical row-end overflow with group eyebrow, icons, accelerator, and destructive item",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Menu
                trigger={<IconButton prefix="fas" name="ellipsis" label="More" variant="ghost" size="sm" />}
                items={[
                    Menu.GroupLabel("Actions"),
                    Menu.Item("edit", "Edit · rename", { icon: "pen" }),
                    Menu.Item("duplicate", "Duplicate", { icon: "copy", command: "⌘D" }),
                    Menu.Item("export", "Export CSV", { icon: "download" }),
                    Menu.Separator(),
                    Menu.Item("archive", "Archive", { icon: "trash", destructive: true }),
                ]}
            />
        );
    }),
    inputs: [],
});

export const menuVariants = example({
    keywords: ["Menu", "Root", "Item", "disabled", "placement", "kebab", "account", "Reactive", "State", "Configurator", "configurator"],
    description: "Menu — grouped items with a separator and a disabled entry on one bottom-end panel; opens log to the aside",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {

            // ONE menu — the richest composition: icon-button trigger,
            // separator groups and a disabled item all together.
            const preview = $.const(
                <Menu
                    trigger={<Button>Account</Button>}
                    placement="bottom-end"
                    items={[
                        Menu.Item("profile", "View Profile"),
                        Menu.Item("settings", "Settings"),
                        Menu.Item("save", "Save", { disabled: true }),
                        Menu.Separator(),
                        Menu.Item("logout", "Log Out"),
                    ]}
                />,
            );

            return (
                <Configurator
                    controls={[
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Placement", "bottom-end"),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
