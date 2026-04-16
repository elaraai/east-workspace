/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, NullType, StringType, example } from "@elaraai/east";
import { Badge, Reactive, Stack, State, Textarea, UIComponentType } from "../../src/index.js";

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
