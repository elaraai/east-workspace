/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { BooleanType, East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, Field, HStack, Reactive, Switch, VStack } from "@elaraai/east-ui";

export const fieldBasic = example({
    keywords: ["Field", "StringInput", "label", "helperText", "errorText", "required", "invalid"],
    description: "Wraps controls with labels and messages",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch" width="100%">
                <Field.StringInput label="Email" value="" schemaKey="user.email" helperText="We'll never share your email." placeholder="you@example.com" />
                <Field.StringInput label="Password" value="" schemaKey="user.password" required={true} errorText="Password is required" invalid={true} placeholder="Enter password" />
            </VStack>
        );
    }),
    inputs: [],
});

export const fieldVariants = example({
    keywords: ["Field", "StringInput", "required", "invalid", "errorText", "helperText", "Reactive", "State", "onChange", "interactive", "Switch", "Configurator", "configurator"],
    description: "Field configurator — required and invalid switches on one live State-bound field; the spec reads the bound value back",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const requiredBind = $.let(State.bind([BooleanType], "field_required", false));
            const invalidBind = $.let(State.bind([BooleanType], "field_invalid", false));
            const valueBind = $.let(State.bind([StringType], "field_email", ""));

            const requiredOn = $.let(requiredBind.read());
            const invalidOn = $.let(invalidBind.read());
            const value = $.let(valueBind.read());

            const onRequired = $.const(East.function([BooleanType], NullType, ($, next) => { $(requiredBind.write(next)); }));
            const onInvalid = $.const(East.function([BooleanType], NullType, ($, next) => { $(invalidBind.write(next)); }));
            const onChange = $.const(East.function([StringType], NullType, ($, next) => { $(valueBind.write(next)); }));

            // helperText / errorText presence follows the invalid switch, so
            // it picks between two fields; required + the binding stay live.
            const preview = $.const(invalidOn.ifElse(
                _$ => <Field.StringInput label="Email" value={value} schemaKey="user.email" required={requiredOn} invalid={true} errorText="Enter a valid email" placeholder="you@example.com" onChange={onChange} />,
                _$ => <Field.StringInput label="Email" value={value} schemaKey="user.email" required={requiredOn} helperText="We'll never share your email." placeholder="you@example.com" onChange={onChange} />,
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Slot("Validation",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={requiredOn} label="Required" onChange={onRequired} />
                                <Switch checked={invalidOn} label="Invalid" onChange={onInvalid} />
                            </HStack>),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Bound", East.greater(value.length(), 0n).ifElse(_$ => value, _$ => "(empty)")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
