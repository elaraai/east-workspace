/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, DateTimeType, FloatType, IntegerType, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Input, Status, Text, VStack, HStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basics — the four input types (panel)
// ============================================================================

export const inputBasics = example({
    keywords: ["Input", "String", "placeholder", "variant", "outline", "Integer", "min", "max", "step", "Float", "precision", "DateTime", "date", "time"],
    description: "Input basics panel — string (text input with placeholder), integer (numeric input with min/max), float (decimal input with precision), date time (date and time picker)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">STRING</Text>
                    <Input.String value="" placeholder="Enter your name" variant="outline" />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">INTEGER</Text>
                    <Input.Integer value={0n} min={0n} max={100n} step={1n} />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FLOAT</Text>
                    <Input.Float value={0.0} min={0} max={100} step={0.1} precision={2n} />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">DATE TIME</Text>
                    <Input.DateTime value={new Date()} precision="datetime" />
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Styles — sizes, variants, focus state (panel)
// ============================================================================

export const inputStyles = example({
    keywords: ["Input", "String", "size", "xs", "sm", "md", "lg", "variant", "outline", "subtle", "flushed", "Integer", "autoFocus", "focus", "ring"],
    description: "Input styles panel — sizes (available sizes: xs, sm, md, lg), variants (available variants: outline, subtle, flushed), focused (auto-focused numeric input — shows the focus state, brand border + soft ring)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SIZES</Text>
                    <VStack gap="2" align="stretch" width="100%">
                        <Input.String value="" placeholder="Extra Small" size="xs" />
                        <Input.String value="" placeholder="Small" size="sm" />
                        <Input.String value="" placeholder="Medium" size="md" />
                        <Input.String value="" placeholder="Large" size="lg" />
                    </VStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">VARIANTS</Text>
                    <VStack gap="2" align="stretch" width="100%">
                        <Input.String value="" placeholder="Outline" variant="outline" />
                        <Input.String value="" placeholder="Subtle" variant="subtle" />
                        <Input.String value="" placeholder="Flushed" variant="flushed" />
                    </VStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FOCUSED</Text>
                    <Input.Integer value={6n} min={0n} max={100n} autoFocus />
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Reactive — the four input types live against State (panel)
// ============================================================================

export const inputReactive = example({
    keywords: ["Input", "String", "Reactive", "State", "onChange", "onFocus", "onBlur", "Integer", "interactive", "Float", "precision", "DateTime"],
    description: "Input reactive panel — string interactive (type to see live updates via onChange callback), integer interactive (numeric input with live value display), float interactive (decimal input with precision display), date time interactive (date picker with live value display)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">STRING INTERACTIVE</Text>
                    <Reactive>{$ => {
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
                        return (
                            <VStack gap="3" align="stretch">
                                <Input.String value={text} placeholder="Type something..." onChange={onChange} onFocus={onFocus} onBlur={onBlur} />
                                <Text>{East.str`You typed: ${text}`}</Text>
                                <Text>{East.str`Length: ${text.length()}`}</Text>
                                <HStack gap="4">
                                    {<Text.MonoLabel>{East.str`FOCUS · ${focusCount}`}</Text.MonoLabel>}
                                    {<Text.MonoLabel>{East.str`BLUR · ${blurCount}`}</Text.MonoLabel>}
                                </HStack>
                            </VStack>
                        );
                    }}</Reactive>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">INTEGER INTERACTIVE</Text>
                    <Reactive>{$ => {
                        const valueBind = $.let(State.bind([IntegerType], "form_integer_input", 0n));
                        const value = $.let(valueBind.read());
                        const onChange = $.const(East.function([IntegerType], NullType, ($, newValue) => {
                            $(valueBind.write(newValue));
                        }));
                        return (
                            <VStack gap="3" align="stretch">
                                <Input.Integer value={value} min={0n} max={1000n} step={1n} onChange={onChange} />
                                <Text>{East.str`Value: ${value}`}</Text>
                                {East.equal(value.remainder(2n), 0n).ifElse(
                                    _$ => <Status label="Even" value="info" />,
                                    _$ => <Status label="Odd" value="neutral" />,
                                )}
                            </VStack>
                        );
                    }}</Reactive>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FLOAT INTERACTIVE</Text>
                    <Reactive>{$ => {
                        const valueBind = $.let(State.bind([FloatType], "form_float_input", 0.0));
                        const value = $.let(valueBind.read());
                        const onChange = $.const(East.function([FloatType], NullType, ($, newValue) => {
                            $(valueBind.write(newValue));
                        }));
                        return (
                            <VStack gap="3" align="stretch">
                                <Input.Float value={value} min={0} max={100} step={0.1} precision={2n} onChange={onChange} />
                                <Text>{East.str`Value: ${East.print(value)}`}</Text>
                            </VStack>
                        );
                    }}</Reactive>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">DATE TIME INTERACTIVE</Text>
                    <Reactive>{$ => {
                        const valueBind = $.let(State.bind([DateTimeType], "form_datetime_input", new Date()));
                        const value = $.let(valueBind.read());
                        const onChange = $.const(East.function([DateTimeType], NullType, ($, newValue) => {
                            $(valueBind.write(newValue));
                        }));
                        return (
                            <VStack gap="3" align="stretch">
                                <Input.DateTime value={value} onChange={onChange} />
                                <Text>{East.str`Year: ${value.getYear()}`}</Text>
                                <Text>{East.str`Month: ${value.getMonth()}`}</Text>
                                <Text>{East.str`Day: ${value.getDayOfMonth()}`}</Text>
                            </VStack>
                        );
                    }}</Reactive>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
