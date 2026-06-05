/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { HStack, IconButton, Reactive, Text, ToggleTip, VStack } from "@elaraai/east-ui";

export const toggleTipBasic = example({
    keywords: ["ToggleTip", "Root", "Icon", "accessible", "click"],
    description: "Click-activated tip with a circular ink-4 ring affordance",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <HStack gap="2" align="center">
                <Text>What is this?</Text>
                <ToggleTip
                    trigger={<IconButton prefix="fas" name="circle-info" label="What is this" variant="ghost" size="xs" color="fg.muted" />}
                    placement="top"
                    hasArrow={true}
                >ToggleTip is an accessible alternative to hover tooltips. Click to toggle!</ToggleTip>
            </HStack>
        );
    }),
    inputs: [],
});

export const toggleTipInfo = example({
    keywords: ["ToggleTip", "Root", "info", "help"],
    description: "Help affordance — circular ink-4 ring",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <ToggleTip
                trigger={<IconButton prefix="fas" name="circle-info" label="Help" variant="ghost" size="xs" color="fg.muted" />}
                placement="bottom"
            >Click the info button for help. This is useful for touch and keyboard users.</ToggleTip>
        );
    }),
    inputs: [],
});

export const toggleTipInteractive = example({
    keywords: ["ToggleTip", "Reactive", "State", "interactive", "onOpenChange"],
    description: "ToggleTip whose onOpenChange counts open/close transitions",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([IntegerType], "toggletip_toggles", 0n));
            const value = $.let(bind.read());
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, _open) => {
                const cur = $.let(bind.read());
                $(bind.write(cur.add(1n)));
            }));
            return (
                <VStack gap="3" align="flex-start">
                    <ToggleTip
                        trigger={<IconButton prefix="fas" name="circle-info" label="Toggle me" variant="ghost" size="xs" color="fg.muted" />}
                        placement="top"
                        onOpenChange={onOpenChange}
                    >ToggleTip content</ToggleTip>
                    {Text.Presets.MonoLabel(East.str`TOGGLED · ${East.print(value)}`)}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
