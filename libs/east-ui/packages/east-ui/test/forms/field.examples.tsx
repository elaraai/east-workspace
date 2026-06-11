/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Field, Text, VStack, Reactive } from "@elaraai/east-ui";

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

export const fieldInteractive = example({
    keywords: ["Field", "StringInput", "Reactive", "State", "onChange", "interactive"],
    description: "Field wrapping a StringInput whose onChange writes back to state",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([StringType], "field_email", ""));
            const value = $.let(bind.read());
            const onChange = $.const(East.function([StringType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return (
                <VStack gap="3" align="stretch" width="100%">
                    <Field.StringInput label="Email" value={value} schemaKey="user.email" helperText="Type to update the bound state" placeholder="you@example.com" onChange={onChange} />
                    <Text>{East.str`Bound value: ${value}`}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
