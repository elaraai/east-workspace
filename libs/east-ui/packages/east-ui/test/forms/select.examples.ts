/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, NullType, StringType, example } from "@elaraai/east";
import { Reactive, Select, Stack, State, Text, UIComponentType } from "../../src/index.js";

export const selectBasic = example({
    keywords: ["Select", "Root", "Item", "dropdown", "placeholder"],
    description: "Dropdown selection control",
    fn: East.function([], UIComponentType, (_$) => {
        return Select.Root("", [
            Select.Item("us", "United States"),
            Select.Item("uk", "United Kingdom"),
            Select.Item("ca", "Canada"),
            Select.Item("au", "Australia"),
        ], { placeholder: "Select a country" });
    }),
    inputs: [],
});

export const selectInteractive = example({
    keywords: ["Select", "Root", "Reactive", "State", "onChange", "interactive"],
    description: "Select an option to see onChange callback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const selectBind = $.let(State.bind([StringType], "form_select", ""));
            const selected = $.let(selectBind.read());
            const onChange = $.const(East.function([StringType], NullType, ($, newValue) => {
                $(selectBind.write(newValue));
            }));

            return Stack.VStack([
                Select.Root(selected, [
                    Select.Item("apple", "Apple"),
                    Select.Item("banana", "Banana"),
                    Select.Item("cherry", "Cherry"),
                    Select.Item("date", "Date"),
                ], { placeholder: "Pick a fruit", onChange }),
                Text.Root(East.str`Selected: ${East.greater(selected.length(), 0n).ifElse(
                    _$ => selected,
                    _$ => "(none)"
                )}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
