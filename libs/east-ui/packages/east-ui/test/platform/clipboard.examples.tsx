/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, example } from "@elaraai/east";
import { Clipboard, State, UIComponentType } from "@elaraai/east-ui";
import { Button, Reactive, Text, VStack } from "@elaraai/east-ui/jsx";

export const clipboardCopyButton = example({
    keywords: ["Clipboard", "copy", "Button", "onClick"],
    description: "Button that copies a fixed string to the clipboard",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const onClick = $.const(East.function([], NullType, ($) => {
                $(Clipboard.copy("https://app.example.com/scenarios/s1"));
            }));
            return <Button onClick={onClick}>Copy link</Button>;
        }}</Reactive>
    )),
    inputs: [],
});

export const clipboardCopyReactive = example({
    keywords: ["Clipboard", "copy", "Reactive", "State"],
    description: "Copy the current value of a State-bound key to the clipboard",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([StringType], "share.url", "https://example.com"));
            const url = $.let(bind.read());
            const onClick = $.const(East.function([], NullType, ($) => {
                const current = $.let(bind.read());
                $(Clipboard.copy(current));
            }));
            return (
                <VStack gap="2" align="stretch">
                    <Text>{East.str`URL: ${url}`}</Text>
                    <Button onClick={onClick}>Copy</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
