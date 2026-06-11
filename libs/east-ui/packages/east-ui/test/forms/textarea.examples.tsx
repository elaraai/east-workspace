/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Text, Textarea, VStack, HStack, Reactive } from "@elaraai/east-ui";

export const textareaBasic = example({
    keywords: ["Textarea", "Root", "placeholder", "rows", "resize"],
    description: "Multi-line text input",
    fn: East.function([], UIComponentType, (_$) => {
        return <Textarea value="" placeholder="Enter your message..." rows={4} resize="vertical" />;
    }),
    inputs: [],
});

export const textareaInteractive = example({
    keywords: ["Textarea", "Root", "Reactive", "State", "onChange", "interactive"],
    description: "Type to see character count update",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const textBind = $.let(State.bind([StringType], "form_textarea", ""));
            const text = $.let(textBind.read());
            const onChange = $.const(East.function([StringType], NullType, ($, newValue) => {
                $(textBind.write(newValue));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Textarea value={text} placeholder="Write something..." rows={3} onChange={onChange} />
                    {<Text.MonoLabel>{East.str`${text.length()} CHARS`}</Text.MonoLabel>}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const textareaOnFocusBlur = example({
    keywords: ["Textarea", "Root", "Reactive", "State", "onFocus", "onBlur", "interactive"],
    description: "Textarea exercising onFocus and onBlur callbacks",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const focusBind = $.let(State.bind([IntegerType], "textarea_focus_count", 0n));
            const blurBind = $.let(State.bind([IntegerType], "textarea_blur_count", 0n));
            const focusCount = $.let(focusBind.read());
            const blurCount = $.let(blurBind.read());
            const onFocus = $.const(East.function([], NullType, $ => {
                const cur = $.let(focusBind.read());
                $(focusBind.write(cur.add(1n)));
            }));
            const onBlur = $.const(East.function([], NullType, $ => {
                const cur = $.let(blurBind.read());
                $(blurBind.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Textarea value="" placeholder="Click in/out to fire focus/blur" rows={3} onFocus={onFocus} onBlur={onBlur} />
                    <HStack gap="4">
                        {<Text.MonoLabel>{East.str`FOCUS · ${focusCount}`}</Text.MonoLabel>}
                        {<Text.MonoLabel>{East.str`BLUR · ${blurCount}`}</Text.MonoLabel>}
                    </HStack>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const textareaOnValidate = example({
    keywords: ["Textarea", "Root", "Reactive", "State", "onValidate", "interactive"],
    description: "Textarea whose onValidate records the latest validated value",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const validBind = $.let(State.bind([StringType], "textarea_validated", ""));
            const last = $.let(validBind.read());
            const onValidate = $.const(East.function([StringType], NullType, ($, val) => {
                $(validBind.write(val));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Textarea value="" placeholder="Type — every keystroke fires onValidate" rows={3} onValidate={onValidate} />
                    <Text>{East.str`Last validated: ${last}`}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
