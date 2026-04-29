/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, NullType, StringType, example } from "@elaraai/east";
import { RadioGroup, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const radioGroupBasic = example({
    keywords: ["RadioGroup", "Root", "radio", "select", "single-select"],
    description: "Basic radio group with three options",
    fn: East.function([], UIComponentType, (_$) => {
        return RadioGroup.Root(
            "yes",
            [
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
                { value: "maybe", label: "Maybe" },
            ],
        );
    }),
    inputs: [],
});

export const radioGroupHorizontal = example({
    keywords: ["RadioGroup", "orientation", "horizontal"],
    description: "Horizontal radio group layout",
    fn: East.function([], UIComponentType, (_$) => {
        return RadioGroup.Root(
            "small",
            [
                { value: "small", label: "Small" },
                { value: "medium", label: "Medium" },
                { value: "large", label: "Large" },
            ],
            { orientation: "horizontal", colorPalette: "blue" },
        );
    }),
    inputs: [],
});

export const radioGroupDisabledItem = example({
    keywords: ["RadioGroup", "disabled", "item"],
    description: "Radio group with one disabled item",
    fn: East.function([], UIComponentType, (_$) => {
        return RadioGroup.Root(
            "active",
            [
                { value: "active", label: "Active" },
                { value: "pending", label: "Pending" },
                { value: "archived", label: "Archived", disabled: true },
            ],
        );
    }),
    inputs: [],
});

export const radioGroupReactive = example({
    keywords: ["RadioGroup", "Reactive", "State", "onChange", "interactive"],
    description: "Reactive radio group bound to State — picking an option writes to State and re-renders",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const choiceBind = $.let(State.bind([StringType], "radio_choice", "small"));
            const choice = $.let(choiceBind.read(), StringType);
            const onChange = $.const(East.function([StringType], NullType, ($, next) => {
                $(choiceBind.write(next));
            }));
            return Stack.VStack([
                RadioGroup.Root(
                    choice,
                    [
                        { value: "small", label: "Small" },
                        { value: "medium", label: "Medium" },
                        { value: "large", label: "Large" },
                    ],
                    { onChange, colorPalette: "blue" },
                ),
                Text.Root(East.str`Selected: ${choice}`, { textStyle: "body-sm", color: "fg.muted" }),
            ], { gap: "3", align: "flex-start" });
        }));
    }),
    inputs: [],
});

export const radioGroupColourOverrides = example({
    keywords: ["RadioGroup", "fillColor", "borderColor", "color", "override"],
    description: "Radio group with explicit colour escape hatches for fill / border / label text",
    fn: East.function([], UIComponentType, (_$) => {
        return RadioGroup.Root(
            "low",
            [
                { value: "low", label: "Low priority" },
                { value: "med", label: "Medium priority" },
                { value: "high", label: "High priority" },
            ],
            {
                fillColor: "blue.600",
                borderColor: "blue.300",
                color: "gray.700",
            },
        );
    }),
    inputs: [],
});
