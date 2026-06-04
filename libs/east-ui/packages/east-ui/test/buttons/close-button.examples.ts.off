/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { CloseButton, Reactive, State, UIComponentType } from "@elaraai/east-ui";

export const closeButtonBasic = example({
    keywords: ["CloseButton", "Root", "dismiss", "default"],
    description: "Default CloseButton — aria-label renders as 'Close'",
    fn: East.function([], UIComponentType, (_$) => {
        return CloseButton.Root();
    }),
    inputs: [],
});

export const closeButtonLabelled = example({
    keywords: ["CloseButton", "Root", "label", "aria-label", "localised"],
    description: "CloseButton with a custom aria-label",
    fn: East.function([], UIComponentType, (_$) => {
        return CloseButton.Root({
            label: "Dismiss banner",
            style: { variant: "ghost", size: "sm" },
        });
    }),
    inputs: [],
});

export const closeButtonReactive = example({
    keywords: ["CloseButton", "Root", "onClick", "Reactive", "State", "dismiss"],
    description: "Reactive CloseButton that flips a dismiss flag in state",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const visible = $.let(State.bind([BooleanType], "banner_visible", true));
            const dismiss = $.const(East.function([], NullType, $ => {
                $(visible.write(false));
            }));
            return CloseButton.Root({
                label: "Dismiss banner",
                onClick: dismiss,
                style: { variant: "subtle" },
            });
        }));
    }),
    inputs: [],
});

export const closeButtonBranded = example({
    keywords: ["CloseButton", "Root", "style", "color", "background", "branded"],
    description: "Branded CloseButton with hex colour escape hatches",
    fn: East.function([], UIComponentType, (_$) => {
        return CloseButton.Root({
            label: "Dismiss",
            style: {
                variant: "solid",
                color: "#ffffff",
                background: "#1a2234",
                hoverBackground: "#25345a",
            },
        });
    }),
    inputs: [],
});
