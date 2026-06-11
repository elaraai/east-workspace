/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Status, Switch, VStack, HStack, Reactive } from "@elaraai/east-ui";

export const switchBasic = example({
    keywords: ["Switch", "Root", "label", "toggle", "disabled"],
    description: "Toggle control for on/off states",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" align="flex-start">
                <Switch checked={false} label="Notifications" />
                <Switch checked={true} label="Dark mode" />
                <Switch checked={false} label="Feature flag" />
                <Switch checked={false} label="Disabled" disabled={true} />
            </VStack>
        );
    }),
    inputs: [],
});

export const switchSizes = example({
    keywords: ["Switch", "Root", "size", "sm", "md", "lg"],
    description: "Size variations: sm, md, lg",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="4">
                <Switch checked={true} label="SM" size="sm" />
                <Switch checked={true} label="MD" size="md" />
                <Switch checked={true} label="LG" size="lg" />
            </HStack>
        );
    }),
    inputs: [],
});

export const switchInteractive = example({
    keywords: ["Switch", "Root", "Reactive", "State", "onChange", "interactive"],
    description: "Toggle switch with live state feedback",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const switchBind = $.let(State.bind([BooleanType], "form_switch", false));
            const enabled = $.let(switchBind.read());
            const onChange = $.const(East.function([BooleanType], NullType, ($, newValue) => {
                $(switchBind.write(newValue));
            }));
            return (
                <VStack gap="3" align="flex-start">
                    <Switch checked={enabled} label="Enable feature" onChange={onChange} />
                    {enabled.ifElse(
                        _$ => <Status label="Feature on" value="success" />,
                        _$ => <Status label="Feature off" value="neutral" />,
                    )}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
