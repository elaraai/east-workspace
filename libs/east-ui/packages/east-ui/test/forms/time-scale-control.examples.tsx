/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, variant, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Text, TimeScaleControl, VStack, Reactive } from "@elaraai/east-ui";

export const timeScaleControlBasic = example({
    keywords: ["TimeScaleControl", "Root", "scale", "segment", "control"],
    description: "All seven scales — minute / hour / day / week / month / quarter / year",
    fn: East.function([], UIComponentType, (_$) => {
        return <TimeScaleControl value="day" />;
    }),
    inputs: [],
});

export const timeScaleControlAvailable = example({
    keywords: ["TimeScaleControl", "availableScales", "subset"],
    description: "Restricted scale set — only day / week / month shown",
    fn: East.function([], UIComponentType, (_$) => {
        return <TimeScaleControl value="week" availableScales={["day", "week", "month"]} />;
    }),
    inputs: [],
});

export const timeScaleControlReactive = example({
    keywords: ["TimeScaleControl", "Reactive", "State", "onChange", "interactive"],
    description: "Reactive scale picker bound to State — clicking a segment writes to State",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const scaleBind = $.let(State.bind([TimeScaleControl.Types.Scale], "scale", variant("day", null)));
            const scale = $.let(scaleBind.read(), TimeScaleControl.Types.Scale);
            const onChange = $.const(East.function([TimeScaleControl.Types.Scale], NullType, ($, next) => {
                $(scaleBind.write(next));
            }));
            return (
                <VStack gap="3" align="flex-start">
                    <TimeScaleControl value={scale} availableScales={["day", "week", "month", "quarter", "year"]} onChange={onChange} />
                    {Text.Presets.MonoLabel(East.str`SCALE · ${scale.getTag()}`)}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const timeScaleControlSubtleVariant = example({
    keywords: ["TimeScaleControl", "variant", "subtle", "outline"],
    description: "Subtle visual variant — low-emphasis chrome",
    fn: East.function([], UIComponentType, (_$) => {
        return <TimeScaleControl value="month" availableScales={["day", "week", "month"]} variant="subtle" size="sm" />;
    }),
    inputs: [],
});

export const timeScaleControlSizes = example({
    keywords: ["TimeScaleControl", "size", "sm", "md", "lg"],
    description: "All three sizes (sm / md / lg) stacked for comparison",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" align="flex-start">
                <TimeScaleControl value="day" availableScales={["day", "week", "month"]} size="sm" />
                <TimeScaleControl value="day" availableScales={["day", "week", "month"]} size="md" />
                <TimeScaleControl value="day" availableScales={["day", "week", "month"]} size="lg" />
            </VStack>
        );
    }),
    inputs: [],
});
