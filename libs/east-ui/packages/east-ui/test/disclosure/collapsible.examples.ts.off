/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { Box, Collapsible, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const collapsibleWhy = example({
    keywords: ["Collapsible", "Root", "why", "show more", "inline drawer"],
    description: "Inline 'Why?' drawer revealing rationale text",
    fn: East.function([], UIComponentType, (_$) => {
        return Collapsible.Root(
            Text.Root("Why did we recommend this?", { color: "blue.500" }),
            Box.Root([
                Text.Root(
                    "Stage 1 was delayed ~6h due to setpoint drift since 02:00. Redirecting feedstock to Stage 2 reduces unmet demand at the cost of 1.2% yield.",
                    { color: "fg.muted" },
                ),
            ], { padding: "3", background: "bg.subtle", borderRadius: "md" }),
            { defaultOpen: false },
        );
    }),
    inputs: [],
});

export const collapsibleDefaultOpen = example({
    keywords: ["Collapsible", "Root", "defaultOpen", "expanded"],
    description: "Collapsible that starts expanded",
    fn: East.function([], UIComponentType, (_$) => {
        return Collapsible.Root(
            "Details",
            Text.Root("This content is visible by default because defaultOpen is true."),
            { defaultOpen: true },
        );
    }),
    inputs: [],
});

export const collapsibleReactive = example({
    keywords: ["Collapsible", "Reactive", "State", "onOpenChange", "interactive"],
    description: "Reactive collapsible that persists its open state",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([BooleanType], "collapsible_open", false));
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, open) => {
                $(bind.write(open));
            }));
            return Stack.VStack([
                Collapsible.Root(
                    Text.Root("Toggle me"),
                    Box.Root([Text.Root("Toggled content")], { padding: "3", background: "bg.subtle" }),
                    { onOpenChange },
                ),
                Text.Root(bind.read().ifElse(_$ => "Open", _$ => "Closed"), { color: "fg.muted" }),
            ], { gap: "2" });
        }));
    }),
    inputs: [],
});

export const collapsibleBranded = example({
    keywords: ["Collapsible", "style", "background", "borderColor", "branded"],
    description: "Branded collapsible with full colour escape hatches",
    fn: East.function([], UIComponentType, (_$) => {
        return Collapsible.Root(
            "Branded trigger",
            Box.Root([Text.Root("Branded content")], { padding: "3" }),
            {
                defaultOpen: true,
                style: {
                    background: "#f9fafb",
                    borderColor: "#3d5cff",
                    triggerColor: "#1a2234",
                    contentColor: "#374151",
                },
            },
        );
    }),
    inputs: [],
});
