/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Combobox, Text, VStack, Reactive } from "@elaraai/east-ui/jsx";

export const comboboxBasic = example({
    keywords: ["Combobox", "Root", "Item", "searchable", "dropdown"],
    description: "Searchable dropdown with type-to-filter",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Combobox
                value=""
                items={[
                    Combobox.Item("us", "United States"),
                    Combobox.Item("uk", "United Kingdom"),
                    Combobox.Item("ca", "Canada"),
                    Combobox.Item("au", "Australia"),
                    Combobox.Item("de", "Germany"),
                    Combobox.Item("fr", "France"),
                    Combobox.Item("jp", "Japan"),
                ]}
                placeholder="Search countries..."
            />
        );
    }),
    inputs: [],
});

export const comboboxWithValue = example({
    keywords: ["Combobox", "Root", "initial value", "preselected"],
    description: "Pre-selected initial value",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Combobox
                value="ca"
                items={[
                    Combobox.Item("us", "United States"),
                    Combobox.Item("uk", "United Kingdom"),
                    Combobox.Item("ca", "Canada"),
                    Combobox.Item("au", "Australia"),
                ]}
                placeholder="Search countries..."
            />
        );
    }),
    inputs: [],
});

export const comboboxSizes = example({
    keywords: ["Combobox", "Root", "size", "xs", "sm", "md", "lg"],
    description: "Available sizes: xs, sm, md, lg",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="2" align="stretch" width="100%">
                <Combobox value="" items={[Combobox.Item("a", "Option A"), Combobox.Item("b", "Option B")]} placeholder="Extra Small" size="xs" />
                <Combobox value="" items={[Combobox.Item("a", "Option A"), Combobox.Item("b", "Option B")]} placeholder="Small" size="sm" />
                <Combobox value="" items={[Combobox.Item("a", "Option A"), Combobox.Item("b", "Option B")]} placeholder="Medium (default)" size="md" />
                <Combobox value="" items={[Combobox.Item("a", "Option A"), Combobox.Item("b", "Option B")]} placeholder="Large" size="lg" />
            </VStack>
        );
    }),
    inputs: [],
});

export const comboboxDisabled = example({
    keywords: ["Combobox", "Root", "disabled", "Item"],
    description: "Disabled combobox and disabled items",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch" width="100%">
                <Combobox value="" items={[Combobox.Item("a", "Option A"), Combobox.Item("b", "Option B")]} placeholder="Disabled combobox" disabled={true} />
                <Combobox
                    value=""
                    items={[
                        Combobox.Item("free", "Free Plan"),
                        Combobox.Item("pro", "Pro Plan"),
                        Combobox.Item("enterprise", "Enterprise Plan", { disabled: true }),
                    ]}
                    placeholder="Item disabled"
                />
            </VStack>
        );
    }),
    inputs: [],
});

export const comboboxCustomValue = example({
    keywords: ["Combobox", "Root", "allowCustomValue", "freeform"],
    description: "Accept values not in the list",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Combobox
                value=""
                items={[
                    Combobox.Item("react", "React"),
                    Combobox.Item("vue", "Vue"),
                    Combobox.Item("angular", "Angular"),
                    Combobox.Item("svelte", "Svelte"),
                ]}
                placeholder="Type or pick a framework..."
                allowCustomValue={true}
            />
        );
    }),
    inputs: [],
});

export const comboboxMultiple = example({
    keywords: ["Combobox", "Root", "multiple", "multi-select"],
    description: "Select multiple values from the list",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Combobox
                value=""
                items={[
                    Combobox.Item("red", "Red"),
                    Combobox.Item("green", "Green"),
                    Combobox.Item("blue", "Blue"),
                    Combobox.Item("yellow", "Yellow"),
                    Combobox.Item("purple", "Purple"),
                ]}
                placeholder="Search colors..."
                multiple={true}
            />
        );
    }),
    inputs: [],
});

export const comboboxInteractive = example({
    keywords: ["Combobox", "Root", "Reactive", "State", "onChange", "interactive"],
    description: "Single select - type to search, pick one",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const selectBind = $.let(State.bind([StringType], "form_combobox", ""));
            const selected = $.let(selectBind.read());
            const onChange = $.const(East.function([StringType], NullType, ($, newValue) => {
                $(selectBind.write(newValue));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Combobox
                        value={selected}
                        items={[
                            Combobox.Item("apple", "Apple"),
                            Combobox.Item("banana", "Banana"),
                            Combobox.Item("cherry", "Cherry"),
                            Combobox.Item("date", "Date"),
                            Combobox.Item("elderberry", "Elderberry"),
                            Combobox.Item("fig", "Fig"),
                            Combobox.Item("grape", "Grape"),
                        ]}
                        placeholder="Search fruits..."
                        onChange={onChange}
                    />
                    {Text.Presets.MonoLabel(East.str`SELECTED · ${East.greater(selected.length(), 0n).ifElse(_$ => selected, _$ => "(NONE)")}`)}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const comboboxInteractiveMulti = example({
    keywords: ["Combobox", "Root", "Reactive", "State", "onChangeMultiple", "multi"],
    description: "Multi select - type to search, pick many",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const selectBind = $.let(State.bind([ArrayType(StringType)], "form_combobox_multi", []));
            const selected = $.let(selectBind.read());
            const onChangeMultiple = $.const(East.function([ArrayType(StringType)], NullType, ($, newValue) => {
                $(selectBind.write(newValue));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Combobox
                        value=""
                        items={[
                            Combobox.Item("react", "React"),
                            Combobox.Item("vue", "Vue"),
                            Combobox.Item("angular", "Angular"),
                            Combobox.Item("svelte", "Svelte"),
                            Combobox.Item("solid", "Solid"),
                            Combobox.Item("ember", "Ember"),
                        ]}
                        placeholder="Search frameworks..."
                        multiple={true}
                        onChangeMultiple={onChangeMultiple}
                    />
                    {Text.Presets.MonoLabel(East.str`SELECTED · ${East.greater(selected.length(), 0n).ifElse(_$ => selected.stringJoin(", "), _$ => "(NONE)")}`)}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const comboboxOnInputValueChange = example({
    keywords: ["Combobox", "Root", "Reactive", "State", "onInputValueChange", "interactive"],
    description: "Combobox whose onInputValueChange records every keystroke",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const inputBind = $.let(State.bind([StringType], "form_combobox_inputvalue", ""));
            const last = $.let(inputBind.read());
            const onInputValueChange = $.const(East.function([StringType], NullType, ($, next) => {
                $(inputBind.write(next));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Combobox
                        value=""
                        items={[
                            Combobox.Item("a", "Apple"),
                            Combobox.Item("b", "Banana"),
                            Combobox.Item("c", "Cherry"),
                        ]}
                        placeholder="Type anything…"
                        onInputValueChange={onInputValueChange}
                    />
                    {Text.Presets.MonoLabel(East.str`LAST TYPED · ${last}`)}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const comboboxOnOpenChange = example({
    keywords: ["Combobox", "Root", "Reactive", "State", "onOpenChange", "interactive"],
    description: "Combobox whose onOpenChange counts dropdown open/close transitions",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([IntegerType], "form_combobox_toggles", 0n));
            const value = $.let(bind.read());
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, _open) => {
                const cur = $.let(bind.read());
                $(bind.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Combobox
                        value=""
                        items={[Combobox.Item("a", "Apple"), Combobox.Item("b", "Banana")]}
                        placeholder="Open me…"
                        onOpenChange={onOpenChange}
                    />
                    {Text.Presets.MonoLabel(East.str`TOGGLED · ${value}`)}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
