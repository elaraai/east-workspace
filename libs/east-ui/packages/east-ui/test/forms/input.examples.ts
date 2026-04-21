/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, DateTimeType, FloatType, IntegerType, NullType, StringType, example } from "@elaraai/east";
import { Badge, Input, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const inputString = example({
    keywords: ["Input", "String", "placeholder", "variant", "outline"],
    description: "Text input with placeholder",
    fn: East.function([], UIComponentType, (_$) => {
        return Input.String("", { placeholder: "Enter your name", variant: "outline" });
    }),
    inputs: [],
});

export const inputInteger = example({
    keywords: ["Input", "Integer", "min", "max", "step"],
    description: "Numeric input with min/max",
    fn: East.function([], UIComponentType, (_$) => {
        return Input.Integer(0n, { min: 0n, max: 100n, step: 1n });
    }),
    inputs: [],
});

export const inputFloat = example({
    keywords: ["Input", "Float", "min", "max", "step", "precision"],
    description: "Decimal input with precision",
    fn: East.function([], UIComponentType, (_$) => {
        return Input.Float(0.0, { min: 0, max: 100, step: 0.1, precision: 2n });
    }),
    inputs: [],
});

export const inputDateTime = example({
    keywords: ["Input", "DateTime", "precision", "date", "time"],
    description: "Date and time picker",
    fn: East.function([], UIComponentType, (_$) => {
        return Input.DateTime(new Date(), { precision: "datetime" });
    }),
    inputs: [],
});

export const inputSizes = example({
    keywords: ["Input", "String", "size", "xs", "sm", "md", "lg"],
    description: "Available sizes: xs, sm, md, lg",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Input.String("", { placeholder: "Extra Small", size: "xs" }),
            Input.String("", { placeholder: "Small", size: "sm" }),
            Input.String("", { placeholder: "Medium", size: "md" }),
            Input.String("", { placeholder: "Large", size: "lg" }),
        ], { gap: "2", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

export const inputVariants = example({
    keywords: ["Input", "String", "variant", "outline", "subtle", "flushed"],
    description: "Available variants: outline, subtle, flushed",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Input.String("", { placeholder: "Outline", variant: "outline" }),
            Input.String("", { placeholder: "Subtle", variant: "subtle" }),
            Input.String("", { placeholder: "Flushed", variant: "flushed" }),
        ], { gap: "2", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

export const inputStringInteractive = example({
    keywords: ["Input", "String", "Reactive", "State", "onChange", "onFocus", "onBlur"],
    description: "Type to see live updates via onChange callback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const textBind = $.let(State.bind([StringType], "form_string_input", "hello"));
            const focusBind = $.let(State.bind([IntegerType], "form_focus_count", 0n));
            const blurBind = $.let(State.bind([IntegerType], "form_blur_count", 0n));
            const text = $.let(textBind.read());
            const focusCount = $.let(focusBind.read());
            const blurCount = $.let(blurBind.read());

            const onChange = $.const(East.function([StringType], NullType, ($, newValue) => {
                $(textBind.write(newValue));
            }));
            const onFocus = $.const(East.function([], NullType, $ => {
                const current = $.let(focusBind.read());
                $(focusBind.write(current.add(1n)));
            }));
            const onBlur = $.const(East.function([], NullType, $ => {
                const current = $.let(blurBind.read());
                $(blurBind.write(current.add(1n)));
            }));

            return Stack.VStack([
                Input.String(text, {
                    placeholder: "Type something...",
                    onChange,
                    onFocus,
                    onBlur,
                }),
                Text.Root(East.str`You typed: ${text}`),
                Text.Root(East.str`Length: ${text.length()}`),
                Stack.HStack([
                    Badge.Root(East.str`Focus: ${focusCount}`, { colorPalette: "blue" }),
                    Badge.Root(East.str`Blur: ${blurCount}`, { colorPalette: "orange" }),
                ], { gap: "2" }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const inputIntegerInteractive = example({
    keywords: ["Input", "Integer", "Reactive", "State", "onChange", "interactive"],
    description: "Numeric input with live value display",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const valueBind = $.let(State.bind([IntegerType], "form_integer_input", 0n));
            const value = $.let(valueBind.read());
            const onChange = $.const(East.function([IntegerType], NullType, ($, newValue) => {
                $(valueBind.write(newValue));
            }));

            return Stack.VStack([
                Input.Integer(value, {
                    min: 0n,
                    max: 1000n,
                    step: 1n,
                    onChange,
                }),
                Text.Root(East.str`Value: ${value}`),
                Badge.Root(
                    East.equal(value.remainder(2n), 0n).ifElse(_$ => "Even", _$ => "Odd"),
                    { colorPalette: "teal", variant: "solid" }
                ),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const inputFloatInteractive = example({
    keywords: ["Input", "Float", "Reactive", "State", "onChange", "precision"],
    description: "Decimal input with precision display",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const valueBind = $.let(State.bind([FloatType], "form_float_input", 0.0));
            const value = $.let(valueBind.read());
            const onChange = $.const(East.function([FloatType], NullType, ($, newValue) => {
                $(valueBind.write(newValue));
            }));

            return Stack.VStack([
                Input.Float(value, {
                    min: 0,
                    max: 100,
                    step: 0.1,
                    precision: 2n,
                    onChange,
                }),
                Text.Root(East.str`Value: ${East.print(value)}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const inputDateTimeInteractive = example({
    keywords: ["Input", "DateTime", "Reactive", "State", "onChange", "interactive"],
    description: "Date picker with live value display",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const valueBind = $.let(State.bind([DateTimeType], "form_datetime_input", new Date()));
            const value = $.let(valueBind.read());
            const onChange = $.const(East.function([DateTimeType], NullType, ($, newValue) => {
                $(valueBind.write(newValue));
            }));

            return Stack.VStack([
                Input.DateTime(value, {
                    onChange,
                }),
                Text.Root(East.str`Year: ${value.getYear()}`),
                Text.Root(East.str`Month: ${value.getMonth()}`),
                Text.Root(East.str`Day: ${value.getDayOfMonth()}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
