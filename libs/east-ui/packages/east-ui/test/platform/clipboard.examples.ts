/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, NullType, StringType, example } from "@elaraai/east";
import {
    Button,
    Clipboard,
    Reactive,
    Stack,
    State,
    Text,
    UIComponentType,
} from "@elaraai/east-ui";

export const clipboardCopyButton = example({
    keywords: ["Clipboard", "copy", "Button", "onClick"],
    description: "Button that copies a fixed string to the clipboard",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const onClick = $.const(East.function([], NullType, ($) => {
                $(Clipboard.copy("https://app.example.com/scenarios/s1"));
            }));
            return Button.Root("Copy link", { onClick });
        }));
    }),
    inputs: [],
});

export const clipboardCopyReactive = example({
    keywords: ["Clipboard", "copy", "Reactive", "State"],
    description: "Copy the current value of a State-bound key to the clipboard",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([StringType], "share.url", "https://example.com"));
            const url = $.let(bind.read());
            const onClick = $.const(East.function([], NullType, ($) => {
                const current = $.let(bind.read());
                $(Clipboard.copy(current));
            }));
            return Stack.VStack([
                Text.Root(East.str`URL: ${url}`),
                Button.Root("Copy", { onClick }),
            ], { gap: "2", align: "stretch" });
        }));
    }),
    inputs: [],
});
