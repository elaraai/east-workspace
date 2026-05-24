/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, NullType, example } from "@elaraai/east";
import { IconButton, Reactive, Stack, State, Text, ToggleTip, UIComponentType } from "@elaraai/east-ui";

export const toggleTipBasic = example({
    keywords: ["ToggleTip", "Root", "Icon", "accessible", "click"],
    description: "Click-activated tip with a circular ink-4 ring affordance",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("What is this?"),
            ToggleTip.Root(
                IconButton.Root("fas", "circle-info", "What is this", {
                    style: { variant: "ghost", size: "xs", color: "fg.muted" },
                }),
                "ToggleTip is an accessible alternative to hover tooltips. Click to toggle!",
                { placement: "top", hasArrow: true }
            ),
        ], { gap: "2", align: "center" });
    }),
    inputs: [],
});

export const toggleTipInfo = example({
    keywords: ["ToggleTip", "Root", "info", "help"],
    description: "Help affordance — circular ink-4 ring",
    fn: East.function([], UIComponentType, (_$) => {
        return ToggleTip.Root(
            IconButton.Root("fas", "circle-info", "Help", {
                style: { variant: "ghost", size: "xs", color: "fg.muted" },
            }),
            "Click the info button for help. This is useful for touch and keyboard users.",
            { placement: "bottom" }
        );
    }),
    inputs: [],
});

export const toggleTipInteractive = example({
    keywords: ["ToggleTip", "Reactive", "State", "interactive", "onOpenChange"],
    description: "ToggleTip whose onOpenChange counts open/close transitions",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([IntegerType], "toggletip_toggles", 0n));
            const value = $.let(bind.read());
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, _open) => {
                const cur = $.let(bind.read());
                $(bind.write(cur.add(1n)));
            }));
            return Stack.VStack([
                ToggleTip.Root(
                    IconButton.Root("fas", "circle-info", "Toggle me", {
                        style: { variant: "ghost", size: "xs", color: "fg.muted" },
                    }),
                    "ToggleTip content",
                    { placement: "top", onOpenChange },
                ),
                Text.Presets.MonoLabel(East.str`TOGGLED · ${East.print(value)}`),
            ], { gap: "3", align: "flex-start" });
        }));
    }),
    inputs: [],
});
