/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Combobox, Configurator, HStack, SegmentGroup, Separator, Style, Switch, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

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
// Combobox — live configurator over every control axis
// ============================================================================

export const comboboxVariants = example({
    keywords: ["Combobox", "Root", "initial value", "preselected", "size", "xs", "sm", "md", "lg", "disabled", "Item", "allowCustomValue", "freeform", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Combobox configurator — value and size axes plus disabled and custom-value switches driving one live single-select bound to State; the aside reads the selection back",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const sizes = $.const([
                    variant("xs", null), variant("sm", null), variant("md", null), variant("lg", null),
                ], ArrayType(Style.Types.Size));

                // One data table feeds BOTH the dropdown items and the value
                // presets — the segment pre-selects the same codes the combobox
                // itself can pick, and Antarctica stays item-disabled to keep
                // the per-item flag on show.
                const countries = $.const([
                    { value: "us", label: "United States",  disabled: false },
                    { value: "uk", label: "United Kingdom", disabled: false },
                    { value: "ca", label: "Canada",         disabled: false },
                    { value: "au", label: "Australia",      disabled: false },
                    { value: "aq", label: "Antarctica",     disabled: true },
                ], ArrayType(StructType({ value: StringType, label: StringType, disabled: BooleanType })));

                const sizeBind     = $.let(State.bind([StringType], "combobox_size", "md"));
                const valueBind    = $.let(State.bind([StringType], "combobox_value", "ca"));
                const disabledBind = $.let(State.bind([BooleanType], "combobox_disabled", false));
                const customBind   = $.let(State.bind([BooleanType], "combobox_custom", false));

                const sKey     = $.let(sizeBind.read());
                const selected = $.let(valueBind.read());
                const disabled = $.let(disabledBind.read());
                const custom   = $.let(customBind.read());

                const onSize     = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onValue    = $.const(East.function([StringType], NullType, ($, next) => { $(valueBind.write(next)); }));
                const onDisabled = $.const(East.function([BooleanType], NullType, ($, next) => { $(disabledBind.write(next)); }));
                const onCustom   = $.const(East.function([BooleanType], NullType, ($, next) => { $(customBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const selDisplay = $.let(East.greater(selected.length(), 0n).ifElse(_$ => selected, _$ => "(none)"));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Value", selDisplay,
                                <SegmentGroup value={selected} onChange={onValue} size="sm"
                                    items={countries.filter((_$, c) => c.disabled.not()).map((_$, c) => SegmentGroup.Item(c.value, <Text>{c.value.upperCase()}</Text>))} />,
                                "pre-select from outside — or type in the preview"),
                            Configurator.Control("Size", sKey,
                                <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switches report as the
                            // Disabled / Custom spec rows below rather than as
                            // one value each.
                            Configurator.Slot("Flags",
                                <HStack gap="5" align="center">
                                    <Switch checked={disabled} label="Disabled" onChange={onDisabled} />
                                    <Text textStyle="caption" color="fg.subtle">whole control</Text>
                                    <Switch checked={custom} label="Custom value" onChange={onCustom} />
                                    <Text textStyle="caption" color="fg.subtle">freeform entries allowed</Text>
                                </HStack>),
                        ]}
                        preview={
                            <Combobox
                                value={selected}
                                items={countries.map((_$, c) => Combobox.Item(c.value, c.label, { disabled: c.disabled }))}
                                placeholder="Search countries..."
                                size={size}
                                disabled={disabled}
                                allowCustomValue={custom}
                                onChange={onValue}
                            />
                        }
                        aside={{
                            label: "Selection · Reactive",
                            body: <Text.MonoLabel>{East.str`SELECTED · ${selDisplay.upperCase()}`}</Text.MonoLabel>,
                        }}
                        spec={[
                            Configurator.Spec("Disabled", disabled.ifElse(_$ => "control", _$ => "antarctica item only")),
                            Configurator.Spec("Custom values", custom.ifElse(_$ => "accepted", _$ => "list only")),
                            Configurator.Spec("Items", East.str`${East.print(countries.size())} · antarctica disabled`),
                        ]}
                    />
                );
            }}</Reactive>
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
