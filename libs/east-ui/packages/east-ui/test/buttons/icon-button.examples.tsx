/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { IconButton, Reactive, VStack, Stat } from "@elaraai/east-ui";

export const iconButtonBasic = example({
    keywords: ["IconButton", "Root", "label", "aria-label", "close"],
    description: "Icon-only close affordance with required aria-label",
    fn: East.function([], UIComponentType, (_$) => {
        return <IconButton prefix="fas" name="xmark" label="Close" variant="ghost" />;
    }),
    inputs: [],
});

export const iconButtonLoading = example({
    keywords: ["IconButton", "Root", "loading", "loadingIcon", "spinner"],
    description: "Loading IconButton with a custom spinner icon swap",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <IconButton
                prefix="fas"
                name="rotate"
                label="Refresh"
                loading
                loadingIcon={{ prefix: "fas", name: "spinner" }}
                variant="subtle"
                colorPalette="blue"
            />
        );
    }),
    inputs: [],
});

export const iconButtonColoured = example({
    keywords: ["IconButton", "Root", "style", "color", "background", "borderColor", "branded"],
    description: "Branded IconButton with hex colour escape hatches",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <IconButton
                prefix="fas"
                name="rocket"
                label="Deploy"
                color="#ffffff"
                background="#1a2234"
                borderColor="#3d5cff"
                hoverBackground="#25345a"
                size="md"
            />
        );
    }),
    inputs: [],
});

export const iconButtonOnClickReactive = example({
    keywords: ["IconButton", "Root", "onClick", "Reactive", "State", "counter", "interactive"],
    description: "Reactive IconButton that increments a counter on click",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const counter = $.let(State.bind([IntegerType], "icon_button_counter", 0n));
            const count = $.let(counter.read());
            const increment = $.const(East.function([], NullType, $ => {
                const current = $.let(counter.read());
                $(counter.write(current.add(1n)));
            }));
            return (
                <VStack gap="3" align="flex-start">
                    <Stat label="Clicks" value={East.print(count)} />
                    <IconButton prefix="fas" name="plus" label="Increment" onClick={increment} variant="solid" colorPalette="blue" />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
