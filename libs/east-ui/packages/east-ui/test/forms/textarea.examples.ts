/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, StringType, example } from "@elaraai/east";
import { Badge, Reactive, Stack, State, Text, Textarea, UIComponentType } from "@elaraai/east-ui";

export const textareaBasic = example({
    keywords: ["Textarea", "Root", "placeholder", "rows", "resize"],
    description: "Multi-line text input",
    fn: East.function([], UIComponentType, (_$) => {
        return Textarea.Root("", {
            placeholder: "Enter your message...",
            rows: 4,
            resize: "vertical",
        });
    }),
    inputs: [],
});

export const textareaInteractive = example({
    keywords: ["Textarea", "Root", "Reactive", "State", "onChange", "interactive"],
    description: "Type to see character count update",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const textBind = $.let(State.bind([StringType], "form_textarea", ""));
            const text = $.let(textBind.read());
            const onChange = $.const(East.function([StringType], NullType, ($, newValue) => {
                $(textBind.write(newValue));
            }));

            return Stack.VStack([
                Textarea.Root(text, {
                    placeholder: "Write something...",
                    rows: 3,
                    onChange,
                }),
                Stack.HStack([
                    Badge.Root(East.str`${text.length()} chars`, { colorPalette: "blue" }),
                ], { gap: "2" }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const textareaOnFocusBlur = example({
    keywords: ["Textarea", "Root", "Reactive", "State", "onFocus", "onBlur", "interactive"],
    description: "Textarea exercising onFocus and onBlur callbacks",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
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
            return Stack.VStack([
                Textarea.Root("", {
                    placeholder: "Click in/out to fire focus/blur",
                    rows: 3,
                    onFocus,
                    onBlur,
                }),
                Stack.HStack([
                    Badge.Root(East.str`Focus: ${focusCount}`, { colorPalette: "blue" }),
                    Badge.Root(East.str`Blur: ${blurCount}`, { colorPalette: "orange" }),
                ], { gap: "2" }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const textareaOnValidate = example({
    keywords: ["Textarea", "Root", "Reactive", "State", "onValidate", "interactive"],
    description: "Textarea whose onValidate records the latest validated value",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const validBind = $.let(State.bind([StringType], "textarea_validated", ""));
            const last = $.let(validBind.read());
            const onValidate = $.const(East.function([StringType], NullType, ($, val) => {
                $(validBind.write(val));
            }));
            return Stack.VStack([
                Textarea.Root("", {
                    placeholder: "Type — every keystroke fires onValidate",
                    rows: 3,
                    onValidate,
                }),
                Text.Root(East.str`Last validated: ${last}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
