/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, NullType, example } from "@elaraai/east";
import { Button, Icon, Reactive, Stack, State, Text, ToggleTip, UIComponentType } from "@elaraai/east-ui";

export const toggleTipBasic = example({
    keywords: ["ToggleTip", "Root", "Icon", "accessible", "click"],
    description: "Click-activated tooltip (accessible)",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("What is this?"),
            ToggleTip.Root(
                Icon.Root("fas", "question-circle", { size: "sm", color: "gray.500" }),
                "ToggleTip is an accessible alternative to hover tooltips. Click to toggle!",
                { placement: "top", hasArrow: true }
            ),
        ], { gap: "2", align: "center" });
    }),
    inputs: [],
});

export const toggleTipInfo = example({
    keywords: ["ToggleTip", "Root", "info", "help", "Button"],
    description: "Help button with toggle tip",
    fn: East.function([], UIComponentType, (_$) => {
        return ToggleTip.Root(
            Button.Root("?", { variant: "outline", size: "sm" }),
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
                    Button.Root("Toggle me"),
                    "ToggleTip content",
                    { placement: "top", onOpenChange },
                ),
                Text.Root(East.str`Toggled ${East.print(value)} times`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
