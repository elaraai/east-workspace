/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, BooleanType, NullType, variant, example } from "@elaraai/east";
import { Badge, Checkbox, Reactive, Stack, State, UIComponentType } from "../../src/index.js";

export const checkboxBasic = example({
    keywords: ["Checkbox", "Root", "label", "indeterminate", "disabled"],
    description: "Boolean selection control",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Checkbox.Root(false, { label: "Accept terms" }),
            Checkbox.Root(true, { label: "Checked option", colorPalette: "blue" }),
            Checkbox.Root(false, { label: "Indeterminate", indeterminate: true }),
            Checkbox.Root(false, { label: "Disabled", disabled: true }),
        ], { gap: "3", align: "flex-start" });
    }),
    inputs: [],
});

export const checkboxSizes = example({
    keywords: ["Checkbox", "Root", "size", "sm", "md", "lg"],
    description: "Size variations: sm, md, lg",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Checkbox.Root(true, { label: "Small", size: "sm", colorPalette: "blue" }),
            Checkbox.Root(true, { label: "Medium", size: "md", colorPalette: "blue" }),
            Checkbox.Root(true, { label: "Large", size: "lg", colorPalette: "blue" }),
        ], { gap: "4" });
    }),
    inputs: [],
});

export const checkboxInteractive = example({
    keywords: ["Checkbox", "Root", "Reactive", "State", "onChange", "interactive"],
    description: "Toggle to see state changes via onChange",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const checkBind = $.let(State.bind([BooleanType], "form_checkbox", false));
            const checked = $.let(checkBind.read());
            const onChange = $.const(East.function([BooleanType], NullType, ($, newValue) => {
                $(checkBind.write(newValue));
            }));

            return Stack.VStack([
                Checkbox.Root(checked, {
                    label: "Click me!",
                    colorPalette: "blue",
                    onChange,
                }),
                Badge.Root(
                    checked.ifElse(_$ => "Checked!", _$ => "Unchecked"),
                    { colorPalette: checked.ifElse(_$ => variant("green", null), _$ => variant("gray", null)) }
                ),
            ], { gap: "3", align: "flex-start" });
        }));
    }),
    inputs: [],
});
