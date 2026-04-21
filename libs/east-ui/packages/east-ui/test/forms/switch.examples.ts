/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, NullType, variant, example } from "@elaraai/east";
import { Badge, Reactive, Stack, State, Switch, UIComponentType } from "@elaraai/east-ui";

export const switchBasic = example({
    keywords: ["Switch", "Root", "label", "toggle", "disabled"],
    description: "Toggle control for on/off states",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Switch.Root(false, { label: "Notifications" }),
            Switch.Root(true, { label: "Dark mode", colorPalette: "blue" }),
            Switch.Root(false, { label: "Feature flag", colorPalette: "green" }),
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
            Switch.Root(true, { label: "SM", size: "sm", colorPalette: "green" }),
            Switch.Root(true, { label: "MD", size: "md", colorPalette: "green" }),
            Switch.Root(true, { label: "LG", size: "lg", colorPalette: "green" }),
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
                    colorPalette: "green",
                    onChange,
                }),
                Badge.Root(
                    enabled.ifElse(_$ => "Feature ON", _$ => "Feature OFF"),
                    {
                        colorPalette: enabled.ifElse(_$ => variant("green", null), _$ => variant("red", null)),
                        variant: "solid",
                    }
                ),
            ], { gap: "3", align: "flex-start" });
        }));
    }),
    inputs: [],
});
