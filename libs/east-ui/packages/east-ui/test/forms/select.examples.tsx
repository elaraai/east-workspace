/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, IntegerType, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, Reactive, Select, Switch, Text } from "@elaraai/east-ui";

export const selectBasic = example({
    keywords: ["Select", "Root", "Item", "dropdown", "placeholder"],
    description: "Dropdown selection control",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Select
                value=""
                items={[
                    Select.Item("us", "United States"),
                    Select.Item("uk", "United Kingdom"),
                    Select.Item("ca", "Canada"),
                    Select.Item("au", "Australia"),
                ]}
                placeholder="Select a country"
            />
        );
    }),
    inputs: [],
});

export const selectVariants = example({
    keywords: ["Select", "Root", "Item", "Reactive", "State", "onChange", "onChangeMultiple", "multiple", "multi", "onOpenChange", "interactive", "Switch", "Configurator", "configurator"],
    description: "Select configurator — a Multiple switch flips one live State-bound select between single onChange and multi onChangeMultiple; the aside reads both selections and the open/close count",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const multiBind = $.let(State.bind([BooleanType], "select_multiple", false));
            const singleBind = $.let(State.bind([StringType], "form_select", ""));
            const arrayBind = $.let(State.bind([ArrayType(StringType)], "form_select_multi", []));
            const togglesBind = $.let(State.bind([IntegerType], "form_select_toggles", 0n));

            const multiOn = $.let(multiBind.read());
            const selected = $.let(singleBind.read());
            const multiSelected = $.let(arrayBind.read());
            const toggles = $.let(togglesBind.read());

            const onMulti = $.const(East.function([BooleanType], NullType, ($, next) => { $(multiBind.write(next)); }));
            const onChange = $.const(East.function([StringType], NullType, ($, next) => { $(singleBind.write(next)); }));
            const onChangeMultiple = $.const(East.function([ArrayType(StringType)], NullType, ($, next) => { $(arrayBind.write(next)); }));
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, _open) => {
                const cur = $.let(togglesBind.read());
                $(togglesBind.write(cur.add(1n)));
            }));

            // multiple feeds as an expression and BOTH callbacks stay
            // attached — the matching one fires; the aside shows each.
            const preview = $.const(
                <Select
                    value=""
                    items={[
                        Select.Item("react", "React"),
                        Select.Item("vue", "Vue"),
                        Select.Item("angular", "Angular"),
                        Select.Item("svelte", "Svelte"),
                    ]}
                    placeholder="Pick frameworks"
                    multiple={multiOn}
                    onChange={onChange}
                    onChangeMultiple={onChangeMultiple}
                    onOpenChange={onOpenChange}
                />,
            );

            return (
                <Configurator
                    controls={[
                        Configurator.Slot("Selection",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={multiOn} label="Multiple" onChange={onMulti} />
                            </HStack>),
                    ]}
                    preview={preview}
                    aside={{
                        label: "Selection · Reactive",
                        body: (
                            <HStack gap="4" align="center">
                                <Text.MonoLabel>{East.str`SELECTED · ${East.greater(selected.length(), 0n).ifElse(_$ => selected, _$ => "(NONE)")}`}</Text.MonoLabel>
                                <Text.MonoLabel>{East.str`MULTI · ${East.print(multiSelected.size())}`}</Text.MonoLabel>
                                <Text.MonoLabel>{East.str`TOGGLED · ${East.print(toggles)}`}</Text.MonoLabel>
                            </HStack>
                        ),
                    }}
                    spec={[
                        Configurator.Spec("Mode", multiOn.ifElse(_$ => "onChangeMultiple", _$ => "onChange")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
