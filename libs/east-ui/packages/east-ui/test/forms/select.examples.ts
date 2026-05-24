/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, example } from "@elaraai/east";
import { Reactive, Select, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

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
                Text.Presets.MonoLabel(East.str`SELECTED · ${East.greater(selected.length(), 0n).ifElse(
                    _$ => selected,
                    _$ => "(NONE)"
                )}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const selectInteractiveMulti = example({
    keywords: ["Select", "Root", "Reactive", "State", "onChangeMultiple", "multi"],
    description: "Multi-select drives an Array<String> state via onChangeMultiple",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([ArrayType(StringType)], "form_select_multi", []));
            const selected = $.let(bind.read());
            const onChangeMultiple = $.const(East.function([ArrayType(StringType)], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return Stack.VStack([
                Select.Root("", [
                    Select.Item("react", "React"),
                    Select.Item("vue", "Vue"),
                    Select.Item("angular", "Angular"),
                    Select.Item("svelte", "Svelte"),
                ], { placeholder: "Pick frameworks", multiple: true, onChangeMultiple }),
                Text.Presets.MonoLabel(East.str`SELECTED · ${East.greater(selected.length(), 0n).ifElse(
                    _$ => selected.stringJoin(", "),
                    _$ => "(NONE)",
                )}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const selectOnOpenChange = example({
    keywords: ["Select", "Root", "Reactive", "State", "onOpenChange", "interactive"],
    description: "Select whose onOpenChange counts dropdown open/close transitions",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([IntegerType], "form_select_toggles", 0n));
            const value = $.let(bind.read());
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, _open) => {
                const cur = $.let(bind.read());
                $(bind.write(cur.add(1n)));
            }));
            return Stack.VStack([
                Select.Root("", [
                    Select.Item("a", "Apple"),
                    Select.Item("b", "Banana"),
                ], { placeholder: "Open me…", onOpenChange }),
                Text.Presets.MonoLabel(East.str`TOGGLED · ${value}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
