/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, NullType, StringType, example } from "@elaraai/east";
import { RadioCardGroup, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const radioCardGroupBasic = example({
    keywords: ["RadioCardGroup", "Root", "card", "radio", "select"],
    description: "Pricing-tier card group with description per option",
    fn: East.function([], UIComponentType, (_$) => {
        return RadioCardGroup.Root(
            "team",
            [
                { value: "starter", label: "Starter", description: "Up to 5 users" },
                { value: "team", label: "Team", description: "Up to 50 users" },
                { value: "business", label: "Business", description: "Unlimited" },
            ],
        );
    }),
    inputs: [],
});

export const radioCardGroupHorizontal = example({
    keywords: ["RadioCardGroup", "horizontal", "orientation"],
    description: "Horizontal radio cards laid out as a row",
    fn: East.function([], UIComponentType, (_$) => {
        return RadioCardGroup.Root(
            "monthly",
            [
                { value: "monthly", label: "Monthly", description: "$49 / mo" },
                { value: "yearly", label: "Yearly", description: "$490 / yr (save 16%)" },
            ],
            { orientation: "horizontal" },
        );
    }),
    inputs: [],
});

export const radioCardGroupReactive = example({
    keywords: ["RadioCardGroup", "Reactive", "State", "onChange", "interactive"],
    description: "Reactive radio cards bound to State — picking a card writes to State and re-renders the selected-value indicator below",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const planBind = $.let(State.bind([StringType], "plan_choice", "team"));
            const plan = $.let(planBind.read(), StringType);
            const onChange = $.const(East.function([StringType], NullType, ($, next) => {
                $(planBind.write(next));
            }));
            return Stack.VStack([
                RadioCardGroup.Root(
                    plan,
                    [
                        { value: "starter", label: "Starter", description: "Up to 5 users" },
                        { value: "team", label: "Team", description: "Up to 50 users" },
                        { value: "business", label: "Business", description: "Unlimited" },
                    ],
                    { onChange },
                ),
                Text.Root(East.str`Selected plan: ${plan}`, { textStyle: "body-sm", color: "fg.muted" }),
            ], { gap: "3", align: "flex-start" });
        }));
    }),
    inputs: [],
});

export const radioCardGroupDisabledItem = example({
    keywords: ["RadioCardGroup", "disabled", "item"],
    description: "Card group with one disabled card",
    fn: East.function([], UIComponentType, (_$) => {
        return RadioCardGroup.Root(
            "active",
            [
                { value: "active", label: "Active", description: "Available now" },
                { value: "queued", label: "Queued", description: "Pending review" },
                { value: "archived", label: "Archived", description: "Read-only", disabled: true },
            ],
        );
    }),
    inputs: [],
});

export const radioCardGroupColourOverrides = example({
    keywords: ["RadioCardGroup", "selectedBorderColor", "selectedCardBackground", "override"],
    description: "Card group with explicit colour escape hatches for selected card border / background and description text",
    fn: East.function([], UIComponentType, (_$) => {
        return RadioCardGroup.Root(
            "med",
            [
                { value: "low", label: "Low priority", description: "Resolved within 7 days" },
                { value: "med", label: "Medium priority", description: "Resolved within 2 days" },
                { value: "high", label: "High priority", description: "Resolved same day" },
            ],
            {
                selectedCardBackground: "blue.50",
                selectedBorderColor: "blue.500",
                descriptionColor: "gray.600",
            },
        );
    }),
    inputs: [],
});
