/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Checkbox, Configurator, HStack, Reactive, SegmentGroup, Switch, Text, VStack } from "@elaraai/east-ui";

export const checkboxBasic = example({
    keywords: ["Checkbox", "Root", "label", "indeterminate", "disabled"],
    description: "Boolean selection control",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" align="flex-start">
                <Checkbox checked={false} label="Accept terms" />
                <Checkbox checked={true} label="Checked option" />
                <Checkbox checked={false} label="Indeterminate" indeterminate={true} />
                <Checkbox checked={false} label="Disabled" disabled={true} />
            </VStack>
        );
    }),
    inputs: [],
});

export const checkboxVariants = example({
    keywords: ["Checkbox", "Root", "size", "sm", "md", "lg", "indeterminate", "disabled", "Reactive", "State", "onChange", "interactive", "SegmentGroup", "Switch", "Configurator", "configurator"],
    description: "Checkbox configurator — a size axis plus indeterminate and disabled switches on one live State-bound checkbox",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const sizes = $.const(["sm", "md", "lg"], ArrayType(StringType));

            const sizeBind = $.let(State.bind([StringType], "checkbox_size", "md"));
            const indetBind = $.let(State.bind([BooleanType], "checkbox_indeterminate", false));
            const disabledBind = $.let(State.bind([BooleanType], "checkbox_disabled", false));
            const checkBind = $.let(State.bind([BooleanType], "form_checkbox", false));

            const sKey = $.let(sizeBind.read());
            const indetOn = $.let(indetBind.read());
            const disabledOn = $.let(disabledBind.read());
            const checked = $.let(checkBind.read());

            const onSize = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
            const onIndet = $.const(East.function([BooleanType], NullType, ($, next) => { $(indetBind.write(next)); }));
            const onDisabled = $.const(East.function([BooleanType], NullType, ($, next) => { $(disabledBind.write(next)); }));
            const onChange = $.const(East.function([BooleanType], NullType, ($, next) => { $(checkBind.write(next)); }));

            // size is a string-literal enum; build one checkbox per size arm
            // and keep the binding + switches live everywhere.
            const preview = $.const(sKey.equal("sm").ifElse(
                _$ => <Checkbox checked={checked} label="Notify me" size="sm" indeterminate={indetOn} disabled={disabledOn} onChange={onChange} />,
                _$ => sKey.equal("lg").ifElse(
                    _$ => <Checkbox checked={checked} label="Notify me" size="lg" indeterminate={indetOn} disabled={disabledOn} onChange={onChange} />,
                    _$ => <Checkbox checked={checked} label="Notify me" size="md" indeterminate={indetOn} disabled={disabledOn} onChange={onChange} />,
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Size", sKey,
                            <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                items={sizes.map((_$, v) => SegmentGroup.Item(v, <Text>{v.upperCase()}</Text>))} />),
                        Configurator.Slot("State",
                            <HStack gap="5" align="center">
                                <Switch checked={indetOn} label="Indeterminate" onChange={onIndet} />
                                <Switch checked={disabledOn} label="Disabled" onChange={onDisabled} />
                            </HStack>),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Checked", checked.ifElse(_$ => "true", _$ => "false")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
