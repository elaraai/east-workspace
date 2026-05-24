/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { IconButton, Reactive, Stack, State, Stat, UIComponentType } from "@elaraai/east-ui";

export const iconButtonBasic = example({
    keywords: ["IconButton", "Root", "label", "aria-label", "close"],
    description: "Icon-only close affordance with required aria-label",
    fn: East.function([], UIComponentType, (_$) => {
        return IconButton.Root("fas", "xmark", "Close", { style: { variant: "ghost" } });
    }),
    inputs: [],
});

export const iconButtonLoading = example({
    keywords: ["IconButton", "Root", "loading", "loadingIcon", "spinner"],
    description: "Loading IconButton with a custom spinner icon swap",
    fn: East.function([], UIComponentType, (_$) => {
        return IconButton.Root("fas", "rotate", "Refresh", {
            loading: true,
            loadingIcon: { prefix: "fas", name: "spinner" },
            style: { variant: "subtle", colorPalette: "blue" },
        });
    }),
    inputs: [],
});

export const iconButtonColoured = example({
    keywords: ["IconButton", "Root", "style", "color", "background", "borderColor", "branded"],
    description: "Branded IconButton with hex colour escape hatches",
    fn: East.function([], UIComponentType, (_$) => {
        return IconButton.Root("fas", "rocket", "Deploy", {
            style: {
                color: "#ffffff",
                background: "#1a2234",
                borderColor: "#3d5cff",
                hoverBackground: "#25345a",
                size: "md",
            },
        });
    }),
    inputs: [],
});

export const iconButtonOnClickReactive = example({
    keywords: ["IconButton", "Root", "onClick", "Reactive", "State", "counter", "interactive"],
    description: "Reactive IconButton that increments a counter on click",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "icon_button_counter", 0n));
            const count = $.let(counter.read());
            const increment = $.const(East.function([], NullType, $ => {
                const current = $.let(counter.read());
                $(counter.write(current.add(1n)));
            }));
            return Stack.VStack([
                Stat.Root("Clicks", East.print(count)),
                IconButton.Root("fas", "plus", "Increment", {
                    onClick: increment,
                    style: { variant: "solid", colorPalette: "blue" },
                }),
            ], { gap: "3", align: 'flex-start' });
        }));
    }),
    inputs: [],
});
