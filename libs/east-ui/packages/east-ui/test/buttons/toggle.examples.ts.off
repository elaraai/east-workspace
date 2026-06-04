/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { Reactive, Stack, State, Text, Toggle, UIComponentType } from "@elaraai/east-ui";

export const toggleGridlines = example({
    keywords: ["Toggle", "Root", "pressed", "toolbar", "gridlines"],
    description: "Toolbar toggle — 'Show gridlines' with a leading icon (presentational)",
    fn: East.function([], UIComponentType, (_$) => {
        return Toggle.Root("Show gridlines", true, {
            icon: { prefix: "fas", name: "table-cells" },
            style: { variant: "subtle", size: "sm" },
        });
    }),
    inputs: [],
});

export const toggleLockColumns = example({
    keywords: ["Toggle", "Root", "pressed", "locked", "icon"],
    description: "Lock-columns toggle in the unpressed state with a lock icon",
    fn: East.function([], UIComponentType, (_$) => {
        return Toggle.Root("Lock columns", false, {
            icon: { prefix: "fas", name: "lock" },
            style: { variant: "outline", size: "sm" },
        });
    }),
    inputs: [],
});

export const toggleAutoRefreshReactive = example({
    keywords: ["Toggle", "Reactive", "State", "onChange", "auto-refresh"],
    description: "Reactive auto-refresh toggle wired through State.bind",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([BooleanType], "auto_refresh", false));
            const pressed = $.let(bind.read());
            const onChange = $.const(East.function([BooleanType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return Stack.HStack([
                Toggle.Root("Auto-refresh", pressed, {
                    icon: { prefix: "fas", name: "rotate" },
                    onChange,
                    style: { variant: "subtle", pressedBackground: "#eef2ff" },
                }),
                Text.Root(pressed.ifElse(_$ => "On", _$ => "Off"), { color: "fg.muted" }),
            ], { gap: "3", align: "center" });
        }));
    }),
    inputs: [],
});
