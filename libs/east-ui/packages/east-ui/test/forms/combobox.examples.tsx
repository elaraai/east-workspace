/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Combobox, Separator, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const COMBOBOX_WITH_VALUE_DATA = [
    Combobox.Item("us", "United States"),
    Combobox.Item("uk", "United Kingdom"),
    Combobox.Item("ca", "Canada"),
    Combobox.Item("au", "Australia"),
];
const COMBOBOX_SIZES_DATA = [Combobox.Item("a", "Option A"), Combobox.Item("b", "Option B")];
const COMBOBOX_DISABLED_DATA = [Combobox.Item("a", "Option A"), Combobox.Item("b", "Option B")];
const COMBOBOX_DISABLED_PLANS_DATA = [
    Combobox.Item("free", "Free Plan"),
    Combobox.Item("pro", "Pro Plan"),
    Combobox.Item("enterprise", "Enterprise Plan", { disabled: true }),
];
const COMBOBOX_CUSTOM_VALUE_DATA = [
    Combobox.Item("react", "React"),
    Combobox.Item("vue", "Vue"),
    Combobox.Item("angular", "Angular"),
    Combobox.Item("svelte", "Svelte"),
];
const COMBOBOX_MULTIPLE_DATA = [
    Combobox.Item("red", "Red"),
    Combobox.Item("green", "Green"),
    Combobox.Item("blue", "Blue"),
    Combobox.Item("yellow", "Yellow"),
    Combobox.Item("purple", "Purple"),
];

// ============================================================================
// Basic — the search-index front door
// ============================================================================

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

// ============================================================================
// Combobox — initial value, sizes, disabled, custom value (variant panel)
// ============================================================================

export const comboboxVariants = example({
    keywords: ["Combobox", "Root", "initial value", "preselected", "size", "xs", "sm", "md", "lg", "disabled", "Item", "allowCustomValue", "freeform"],
    description: "Combobox variant panel — with value (pre-selected initial value), sizes (available sizes: xs, sm, md, lg), disabled (disabled combobox and disabled items), custom value (accept values not in the list)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="WITH VALUE" align="start" />
                <Combobox
                    value="ca"
                    items={COMBOBOX_WITH_VALUE_DATA}
                    placeholder="Search countries..."
                />
                <Separator label="SIZES" align="start" />
                <VStack gap="2" align="stretch" width="100%">
                    <Combobox value="" items={COMBOBOX_SIZES_DATA} placeholder="Extra Small" size="xs" />
                    <Combobox value="" items={COMBOBOX_SIZES_DATA} placeholder="Small" size="sm" />
                    <Combobox value="" items={COMBOBOX_SIZES_DATA} placeholder="Medium (default)" size="md" />
                    <Combobox value="" items={COMBOBOX_SIZES_DATA} placeholder="Large" size="lg" />
                </VStack>
                <Separator label="DISABLED" align="start" />
                <VStack gap="4" align="stretch" width="100%">
                    <Combobox value="" items={COMBOBOX_DISABLED_DATA} placeholder="Disabled combobox" disabled={true} />
                    <Combobox
                        value=""
                        items={COMBOBOX_DISABLED_PLANS_DATA}
                        placeholder="Item disabled"
                    />
                </VStack>
                <Separator label="CUSTOM VALUE" align="start" />
                <Combobox
                    value=""
                    items={COMBOBOX_CUSTOM_VALUE_DATA}
                    placeholder="Type or pick a framework..."
                    allowCustomValue={true}
                />
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Combobox — single + multi select live side by side (interactive panel)
// ============================================================================

export const comboboxInteractive = example({
    keywords: ["Combobox", "Root", "multiple", "multi-select", "Reactive", "State", "onChange", "interactive", "onChangeMultiple", "multi"],
    description: "Combobox interactive panel — multiple (select multiple values from the list), interactive (single select - type to search, pick one), interactive multi (multi select - type to search, pick many)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="MULTIPLE" align="start" />
                <Combobox
                    value=""
                    items={COMBOBOX_MULTIPLE_DATA}
                    placeholder="Search colors..."
                    multiple={true}
                />
                <Separator label="INTERACTIVE" align="start" />
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
                                    Combobox.Item("guava", "Guava"),
                                ]}
                                placeholder="Search fruits..."
                                onChange={onChange}
                            />
                            {<Text.MonoLabel>{East.str`SELECTED · ${East.greater(selected.length(), 0n).ifElse(_$ => selected, _$ => "(NONE)")}`}</Text.MonoLabel>}
                        </VStack>
                    );
                }}</Reactive>
                <Separator label="INTERACTIVE MULTI" align="start" />
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
                            {<Text.MonoLabel>{East.str`SELECTED · ${East.greater(selected.length(), 0n).ifElse(_$ => selected.stringJoin(", "), _$ => "(NONE)")}`}</Text.MonoLabel>}
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Combobox — keystroke + open/close logs (events panel)
// ============================================================================

export const comboboxEvents = example({
    keywords: ["Combobox", "Root", "Reactive", "State", "onInputValueChange", "interactive", "onOpenChange"],
    description: "Combobox events panel — on input value change (combobox whose onInputValueChange records every keystroke), on open change (combobox whose onOpenChange counts dropdown open/close transitions)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="ON INPUT VALUE CHANGE" align="start" />
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
                            {<Text.MonoLabel>{East.str`LAST TYPED · ${last}`}</Text.MonoLabel>}
                        </VStack>
                    );
                }}</Reactive>
                <Separator label="ON OPEN CHANGE" align="start" />
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
                            {<Text.MonoLabel>{East.str`TOGGLED · ${value}`}</Text.MonoLabel>}
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
