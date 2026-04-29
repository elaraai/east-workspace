/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, NullType, example } from "@elaraai/east";
import { Button, CoachMark, IconButton, Stack, Text, UIComponentType } from "@elaraai/east-ui";

export const coachMarkBasic = example({
    keywords: ["CoachMark", "Root", "hint", "wrapped target"],
    description: "Basic coach mark wrapping a Button — popover anchored to the wrapped target",
    fn: East.function([], UIComponentType, (_$) => {
        return CoachMark.Root(
            Button.Root("Bulk edit", { style: { variant: "outline" } }),
            "Bulk edit",
            "Right-click rows to edit them in bulk.",
        );
    }),
    inputs: [],
});

export const coachMarkShowOnce = example({
    keywords: ["CoachMark", "showOnce", "dismiss", "persistent"],
    description: "Coach mark wrapping an IconButton with a showOnce key — never re-shows after dismissal",
    fn: East.function([], UIComponentType, (_$) => {
        return CoachMark.Root(
            IconButton.Root("fas", "filter", "Open filters"),
            "New: filter chips",
            "Click the filter icon to narrow the visible rows.",
            { showOnce: "coach.filter", placement: "bottom" },
        );
    }),
    inputs: [],
});

export const coachMarkColours = example({
    keywords: ["CoachMark", "colour", "color", "escape", "hatches"],
    description: "Coach mark with explicit colour overrides",
    fn: East.function([], UIComponentType, (_$) => {
        return CoachMark.Root(
            Button.Root("Approve", { style: { variant: "solid", colorPalette: "blue" } }),
            "Approve in one click",
            "Use ⌘↵ to commit the highlighted recommendation.",
            {
                placement: "right",
                background: "blue.50",
                borderColor: "blue.300",
                arrowColor: "blue.300",
            },
        );
    }),
    inputs: [],
});

export const coachMarkOnContent = example({
    keywords: ["CoachMark", "onDismiss", "callback", "Stack"],
    description: "Coach mark wrapping a small content block — Stack of label + value — with a dismiss callback",
    fn: East.function([], UIComponentType, (_$) => {
        const onDismiss = East.function([], NullType, (_$) => { /* track dismissal */ });
        return CoachMark.Root(
            Stack.VStack([
                Text.Root("Order #4827", { textStyle: "label-sm", color: "fg.muted" }),
                Text.Root("$12,400", { textStyle: "heading-sm" }),
            ], { gap: "1", align: "flex-start" }),
            "Pro tip",
            "Click any order card to expand its line items and audit trail.",
            { showOnce: "coach.orderCard", placement: "top", onDismiss },
        );
    }),
    inputs: [],
});
