/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { BooleanType, East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, HStack, IconButton, Reactive, Text, ToggleTip } from "@elaraai/east-ui";

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

export const toggleTipVariants = example({
    keywords: ["ToggleTip", "Root", "info", "help", "placement", "hasArrow", "Reactive", "State", "onOpenChange", "interactive", "Configurator", "configurator"],
    description: "ToggleTip configurator — a placement axis on one live tip; the aside counts open/close transitions",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const togglesBind = $.let(State.bind([IntegerType], "toggletip_toggles", 0n));
            const toggles = $.let(togglesBind.read());
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, _open) => {
                const cur = $.let(togglesBind.read());
                $(togglesBind.write(cur.add(1n)));
            }));

            // ONE toggle tip — arrowed, bottom-placed.
            const preview = $.const(
                <ToggleTip
                    trigger={<IconButton prefix="fas" name="circle-info" label="Help" variant="ghost" size="xs" color="fg.muted" />}
                    placement="bottom"
                    hasArrow={true}
                    onOpenChange={onOpenChange}
                >ToggleTip is an accessible alternative to hover tooltips. Click to toggle!</ToggleTip>,
            );

            return (
                <Configurator
                    controls={[
                    ]}
                    preview={preview}
                    aside={{
                        label: "onOpenChange · Reactive",
                        body: <Text.MonoLabel>{East.str`TOGGLED · ${East.print(toggles)}`}</Text.MonoLabel>,
                    }}
                    spec={[
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const toggleTipOpenFromState = example({
    keywords: ["ToggleTip", "open", "onOpenChange", "State", "Reactive", "controlled", "callback"],
    description: "A toggle tip a button opens: its `open` reads State the button writes, and it hangs from its own trigger",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const shown = $.let(State.bind([BooleanType], "toggletip_open_from_state", false));
            const openIt = $.const(East.function([], NullType, ($) => { $(shown.write(true)); }));
            return (
                <HStack gap="2" align="center">
                    <Button variant="outline" onClick={openIt}>Explain the score</Button>
                    <ToggleTip
                        trigger={<IconButton prefix="fas" name="circle-info" label="What is the score" variant="ghost" size="xs" color="fg.muted" />}
                        hasArrow={true}
                        open={shown.read()}
                        onOpenChange={shown.write}
                    >The score weighs the last four weeks.</ToggleTip>
                </HStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
