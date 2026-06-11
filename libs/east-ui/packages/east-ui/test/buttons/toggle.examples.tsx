/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Toggle, HStack, Text, Reactive } from "@elaraai/east-ui";

export const toggleGridlines = example({
    keywords: ["Toggle", "Root", "pressed", "toolbar", "gridlines"],
    description: "Toolbar toggle — 'Show gridlines' with a leading icon (presentational)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Toggle pressed icon={{ prefix: "fas", name: "table-cells" }} variant="subtle" size="sm">
                Show gridlines
            </Toggle>
        );
    }),
    inputs: [],
});

export const toggleLockColumns = example({
    keywords: ["Toggle", "Root", "pressed", "locked", "icon"],
    description: "Lock-columns toggle in the unpressed state with a lock icon",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Toggle pressed={false} icon={{ prefix: "fas", name: "lock" }} variant="outline" size="sm">
                Lock columns
            </Toggle>
        );
    }),
    inputs: [],
});

export const toggleAutoRefreshReactive = example({
    keywords: ["Toggle", "Reactive", "State", "onChange", "auto-refresh"],
    description: "Reactive auto-refresh toggle wired through State.bind",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([BooleanType], "auto_refresh", false));
            const pressed = $.let(bind.read());
            const onChange = $.const(East.function([BooleanType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return (
                <HStack gap="3" align="center">
                    <Toggle pressed={pressed} icon={{ prefix: "fas", name: "rotate" }} onChange={onChange} variant="subtle" pressedBackground="#eef2ff">
                        Auto-refresh
                    </Toggle>
                    <Text color="fg.muted">{pressed.ifElse(_$ => "On", _$ => "Off")}</Text>
                </HStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
