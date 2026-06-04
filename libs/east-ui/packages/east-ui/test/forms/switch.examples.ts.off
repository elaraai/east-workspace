/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { Reactive, Stack, State, Status, Switch, UIComponentType } from "@elaraai/east-ui";

export const switchBasic = example({
    keywords: ["Switch", "Root", "label", "toggle", "disabled"],
    description: "Toggle control for on/off states",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Switch.Root(false, { label: "Notifications" }),
            Switch.Root(true, { label: "Dark mode" }),
            Switch.Root(false, { label: "Feature flag" }),
            Switch.Root(false, { label: "Disabled", disabled: true }),
        ], { gap: "3", align: "flex-start" });
    }),
    inputs: [],
});

export const switchSizes = example({
    keywords: ["Switch", "Root", "size", "sm", "md", "lg"],
    description: "Size variations: sm, md, lg",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Switch.Root(true, { label: "SM", size: "sm" }),
            Switch.Root(true, { label: "MD", size: "md" }),
            Switch.Root(true, { label: "LG", size: "lg" }),
        ], { gap: "4" });
    }),
    inputs: [],
});

export const switchInteractive = example({
    keywords: ["Switch", "Root", "Reactive", "State", "onChange", "interactive"],
    description: "Toggle switch with live state feedback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const switchBind = $.let(State.bind([BooleanType], "form_switch", false));
            const enabled = $.let(switchBind.read());
            const onChange = $.const(East.function([BooleanType], NullType, ($, newValue) => {
                $(switchBind.write(newValue));
            }));

            return Stack.VStack([
                Switch.Root(enabled, {
                    label: "Enable feature",
                    onChange,
                }),
                enabled.ifElse(
                    _$ => Status.Root("Feature on", { value: "success" }),
                    _$ => Status.Root("Feature off", { value: "neutral" }),
                ),
            ], { gap: "3", align: "flex-start" });
        }));
    }),
    inputs: [],
});
