/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, HStack, IconButton, Menu, Reactive, SegmentGroup, Switch, Text } from "@elaraai/east-ui";

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
    keywords: ["Menu", "Root", "Item", "disabled", "placement", "kebab", "account", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "configurator"],
    description: "Menu configurator — a trigger preset axis (kebab / account) plus a disabled-items switch",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presets = $.const(["kebab", "account"], ArrayType(StringType));

            const presetBind = $.let(State.bind([StringType], "menu_preset", "kebab"));
            const disabledBind = $.let(State.bind([BooleanType], "menu_disabled", false));

            const pKey = $.let(presetBind.read());
            const disabledOn = $.let(disabledBind.read());

            const onPreset = $.const(East.function([StringType], NullType, ($, next) => { $(presetBind.write(next)); }));
            const onDisabled = $.const(East.function([BooleanType], NullType, ($, next) => { $(disabledBind.write(next)); }));

            // Item lists and placement are build-time, so the axes pick
            // between prebuilt menus.
            const preview = $.const(pKey.equal("account").ifElse(
                _$ => (
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
                ),
                _$ => disabledOn.ifElse(
                    _$ => (
                        <Menu
                            trigger={<IconButton prefix="fas" name="ellipsis" label="Options" variant="ghost" size="sm" />}
                            items={[
                                Menu.Item("new", "New File"),
                                Menu.Item("save", "Save", { disabled: true }),
                                Menu.Separator(),
                                Menu.Item("close", "Close"),
                            ]}
                        />
                    ),
                    _$ => (
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
                    ),
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Trigger", pKey,
                            <SegmentGroup value={pKey} onChange={onPreset} size="sm"
                                items={presets.map((_$, o) => SegmentGroup.Item(o, <Text>{o.upperCase()}</Text>))} />),
                        Configurator.Slot("Items",
                            <HStack gap="5" align="center">
                                <Switch checked={disabledOn} label="Disabled items (kebab)" onChange={onDisabled} />
                            </HStack>),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Placement", pKey.equal("account").ifElse(_$ => "bottom-end", _$ => "auto")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
