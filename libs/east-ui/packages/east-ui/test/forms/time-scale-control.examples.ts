/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, NullType, variant, example } from "@elaraai/east";
import { Reactive, Stack, State, Text, TimeScaleControl, UIComponentType } from "@elaraai/east-ui";

export const timeScaleControlBasic = example({
    keywords: ["TimeScaleControl", "Root", "scale", "segment", "control"],
    description: "All seven scales — minute / hour / day / week / month / quarter / year",
    fn: East.function([], UIComponentType, (_$) => {
        return TimeScaleControl.Root("day");
    }),
    inputs: [],
});

export const timeScaleControlAvailable = example({
    keywords: ["TimeScaleControl", "availableScales", "subset"],
    description: "Restricted scale set — only day / week / month shown",
    fn: East.function([], UIComponentType, (_$) => {
        return TimeScaleControl.Root("week", {
            availableScales: ["day", "week", "month"],
        });
    }),
    inputs: [],
});

export const timeScaleControlReactive = example({
    keywords: ["TimeScaleControl", "Reactive", "State", "onChange", "interactive"],
    description: "Reactive scale picker bound to State — clicking a segment writes to State",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const scaleBind = $.let(State.bind([TimeScaleControl.Types.Scale], "scale", variant("day", null)));
            const scale = $.let(scaleBind.read(), TimeScaleControl.Types.Scale);
            const onChange = $.const(East.function([TimeScaleControl.Types.Scale], NullType, ($, next) => {
                $(scaleBind.write(next));
            }));
            return Stack.VStack([
                TimeScaleControl.Root(scale, {
                    availableScales: ["day", "week", "month", "quarter", "year"],
                    onChange,
                }),
                Text.Presets.MonoLabel(East.str`SCALE · ${scale.getTag()}`),
            ], { gap: "3", align: "flex-start" });
        }));
    }),
    inputs: [],
});

export const timeScaleControlSubtleVariant = example({
    keywords: ["TimeScaleControl", "variant", "subtle", "outline"],
    description: "Subtle visual variant — low-emphasis chrome",
    fn: East.function([], UIComponentType, (_$) => {
        return TimeScaleControl.Root("month", {
            availableScales: ["day", "week", "month"],
            variant: "subtle",
            size: "sm",
        });
    }),
    inputs: [],
});

export const timeScaleControlSizes = example({
    keywords: ["TimeScaleControl", "size", "sm", "md", "lg"],
    description: "All three sizes (sm / md / lg) stacked for comparison",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            TimeScaleControl.Root("day", { availableScales: ["day", "week", "month"], size: "sm" }),
            TimeScaleControl.Root("day", { availableScales: ["day", "week", "month"], size: "md" }),
            TimeScaleControl.Root("day", { availableScales: ["day", "week", "month"], size: "lg" }),
        ], { gap: "3", align: "flex-start" });
    }),
    inputs: [],
});
