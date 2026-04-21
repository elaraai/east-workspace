/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, NullType, StringType, example } from "@elaraai/east";
import { Field, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const fieldBasic = example({
    keywords: ["Field", "StringInput", "label", "helperText", "errorText", "required", "invalid"],
    description: "Wraps controls with labels and messages",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Field.StringInput(
                "Email",
                "",
                { helperText: "We'll never share your email.", placeholder: "you@example.com" }
            ),
            Field.StringInput(
                "Password",
                "",
                { required: true, errorText: "Password is required", invalid: true, placeholder: "Enter password" }
            ),
        ], { gap: "4", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

export const fieldInteractive = example({
    keywords: ["Field", "StringInput", "Reactive", "State", "onChange", "interactive"],
    description: "Field wrapping a StringInput whose onChange writes back to state",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([StringType], "field_email", ""));
            const value = $.let(bind.read());
            const onChange = $.const(East.function([StringType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return Stack.VStack([
                Field.StringInput("Email", value, {
                    helperText: "Type to update the bound state",
                    placeholder: "you@example.com",
                    onChange,
                }),
                Text.Root(East.str`Bound value: ${value}`),
            ], { gap: "3", align: "stretch", width: "100%" });
        }));
    }),
    inputs: [],
});
