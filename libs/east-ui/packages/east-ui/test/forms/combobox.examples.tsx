/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Combobox, Configurator, HStack, SegmentGroup, Separator, Style, Switch, Text, VStack, Reactive } from "@elaraai/east-ui";

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
    keywords: ["Combobox", "Root", "initial value", "preselected", "size", "xs", "sm", "md", "lg", "disabled", "Item", "allowCustomValue", "freeform", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "multiple", "multi-select", "Reactive", "State", "onChange", "interactive", "onChangeMultiple", "multi"],
    description: "Combobox configurator — value and size axes plus disabled, custom-value and multiple switches driving one live select bound to State; the aside reads the single and multi selections back",
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
                const multipleBind = $.let(State.bind([BooleanType], "combobox_multiple", false));
                // Multi selection keeps its own State key (the old interactive
                // panel's), so flipping the Multiple switch preserves each
                // mode's selection.
                const multiBind    = $.let(State.bind([ArrayType(StringType)], "form_combobox_multi", []));

                const sKey     = $.let(sizeBind.read());
                const selected = $.let(valueBind.read());
                const disabled = $.let(disabledBind.read());
                const custom   = $.let(customBind.read());
                const multiple = $.let(multipleBind.read());
                const multiSel = $.let(multiBind.read());

                const onSize           = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onValue          = $.const(East.function([StringType], NullType, ($, next) => { $(valueBind.write(next)); }));
                const onDisabled       = $.const(East.function([BooleanType], NullType, ($, next) => { $(disabledBind.write(next)); }));
                const onCustom         = $.const(East.function([BooleanType], NullType, ($, next) => { $(customBind.write(next)); }));
                const onMultiple       = $.const(East.function([BooleanType], NullType, ($, next) => { $(multipleBind.write(next)); }));
                const onChangeMultiple = $.const(East.function([ArrayType(StringType)], NullType, ($, next) => { $(multiBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const selDisplay = $.let(East.greater(selected.length(), 0n).ifElse(_$ => selected, _$ => "(none)"));
                const multiDisplay = $.let(East.greater(multiSel.size(), 0n).ifElse(_$ => multiSel.stringJoin(", "), _$ => "(none)"));

                // `multiple` routes the selection through onChangeMultiple and
                // its own array-valued State key; single keeps the value axis.
                const combo = $.const(multiple.ifElse(
                    _$ => (
                        <Combobox
                            value=""
                            items={countries.map((_$, c) => Combobox.Item(c.value, c.label, { disabled: c.disabled }))}
                            placeholder="Search countries..."
                            size={size}
                            disabled={disabled}
                            allowCustomValue={custom}
                            multiple={true}
                            onChangeMultiple={onChangeMultiple}
                        />
                    ),
                    _$ => (
                        <Combobox
                            value={selected}
                            items={countries.map((_$, c) => Combobox.Item(c.value, c.label, { disabled: c.disabled }))}
                            placeholder="Search countries..."
                            size={size}
                            disabled={disabled}
                            allowCustomValue={custom}
                            onChange={onValue}
                        />
                    ),
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Value", selDisplay,
                                <SegmentGroup value={selected} onChange={onValue} size="sm"
                                    items={countries.filter((_$, c) => c.disabled.not()).map((_$, c) => SegmentGroup.Item(c.value, <Text>{c.value.upperCase()}</Text>))} />),
                            Configurator.Control("Size", sKey,
                                <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switches report as the
                            // Disabled / Custom / Mode spec rows below rather
                            // than as one value each.
                            Configurator.Slot("Flags",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={disabled} label="Disabled" onChange={onDisabled} />
                                    <Switch checked={custom} label="Custom value" onChange={onCustom} />
                                    <Switch checked={multiple} label="Multiple" onChange={onMultiple} />
                                </HStack>),
                        ]}
                        preview={combo}
                        aside={{
                            label: "Selection · Reactive",
                            body: (
                                <VStack gap="1" align="flex-start">
                                    <Text.MonoLabel>{East.str`SELECTED · ${selDisplay.upperCase()}`}</Text.MonoLabel>
                                    <Text.MonoLabel>{East.str`MULTI · ${multiDisplay.upperCase()}`}</Text.MonoLabel>
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Mode", multiple.ifElse(_$ => "multi · onChangeMultiple", _$ => "single · onChange")),
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
