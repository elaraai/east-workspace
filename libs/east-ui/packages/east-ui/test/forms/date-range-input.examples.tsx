/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, DateTimeType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { DateRangeInput, Text, VStack, Reactive } from "@elaraai/east-ui";

export const dateRangeInputBasic = example({
    keywords: ["DateRangeInput", "Root", "date", "range", "basic"],
    description: "Basic date range — April 1 → April 30 2026",
    fn: East.function([], UIComponentType, ($) => {
        const start = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
        const end = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
        return <DateRangeInput startValue={start} endValue={end} precision="date" />;
    }),
    inputs: [],
});

export const dateRangeInputDateTime = example({
    keywords: ["DateRangeInput", "precision", "datetime", "time", "hours"],
    description: "DateTime precision — picker exposes date + time-of-day",
    fn: East.function([], UIComponentType, ($) => {
        const start = $.let(new Date("2026-04-01T09:00:00Z"), DateTimeType);
        const end = $.let(new Date("2026-04-01T17:00:00Z"), DateTimeType);
        return <DateRangeInput startValue={start} endValue={end} precision="datetime" />;
    }),
    inputs: [],
});

export const dateRangeInputReactive = example({
    keywords: ["DateRangeInput", "Reactive", "State", "onChange", "interactive"],
    description: "Reactive range bound to State — both fields write back through one callback",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const startBind = $.let(State.bind([DateTimeType], "drin.start", new Date("2026-04-01T00:00:00Z")));
            const endBind = $.let(State.bind([DateTimeType], "drin.end", new Date("2026-04-07T00:00:00Z")));
            const start = $.let(startBind.read(), DateTimeType);
            const end = $.let(endBind.read(), DateTimeType);
            const onChange = $.const(East.function([DateTimeType, DateTimeType], NullType, ($, s, e) => {
                $(startBind.write(s));
                $(endBind.write(e));
            }));
            return (
                <VStack gap="3" align="flex-start">
                    <DateRangeInput startValue={start} endValue={end} precision="date" onChange={onChange} />
                    {Text.Presets.MonoLabel(East.str`${start} → ${end}`)}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const dateRangeInputPresets = example({
    keywords: ["DateRangeInput", "presets", "relative", "MTD", "YTD", "Last 7 days"],
    description: "Range with five canonical presets — Last 7 days / MTD / QTD / YTD / Q2 2026",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const startBind = $.let(State.bind([DateTimeType], "drin.preset.start", new Date("2026-04-21T00:00:00Z")));
            const endBind = $.let(State.bind([DateTimeType], "drin.preset.end", new Date("2026-04-28T00:00:00Z")));
            const start = $.let(startBind.read(), DateTimeType);
            const end = $.let(endBind.read(), DateTimeType);
            const onChange = $.const(East.function([DateTimeType, DateTimeType], NullType, ($, s, e) => {
                $(startBind.write(s));
                $(endBind.write(e));
            }));
            return (
                <DateRangeInput
                    startValue={start}
                    endValue={end}
                    precision="date"
                    onChange={onChange}
                    presets={[
                        { label: "Last 7 days", start: new Date("2026-04-21T00:00:00Z"), end: new Date("2026-04-28T00:00:00Z") },
                        { label: "MTD", start: new Date("2026-04-01T00:00:00Z"), end: new Date("2026-04-28T00:00:00Z") },
                        { label: "QTD", start: new Date("2026-04-01T00:00:00Z"), end: new Date("2026-04-28T00:00:00Z") },
                        { label: "YTD", start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-04-28T00:00:00Z") },
                        { label: "Q2 2026", start: new Date("2026-04-01T00:00:00Z"), end: new Date("2026-06-30T00:00:00Z") },
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const dateRangeInputColours = example({
    keywords: ["DateRangeInput", "colour", "color", "escape", "hatches"],
    description: "Explicit colour overrides — text / background / border / focus border",
    fn: East.function([], UIComponentType, ($) => {
        const start = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
        const end = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
        return <DateRangeInput startValue={start} endValue={end} precision="date" color="fg" background="bg.subtle" borderColor="blue.300" focusBorderColor="blue.500" />;
    }),
    inputs: [],
});

export const dateRangeInputSizes = example({
    keywords: ["DateRangeInput", "size", "sm", "md", "lg"],
    description: "All three sizes (sm / md / lg) stacked for comparison",
    fn: East.function([], UIComponentType, ($) => {
        const start = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
        const end = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
        return (
            <VStack gap="3" align="flex-start">
                <DateRangeInput startValue={start} endValue={end} precision="date" size="sm" />
                <DateRangeInput startValue={start} endValue={end} precision="date" size="md" />
                <DateRangeInput startValue={start} endValue={end} precision="date" size="lg" />
            </VStack>
        );
    }),
    inputs: [],
});

export const dateRangeInputDisabled = example({
    keywords: ["DateRangeInput", "disabled", "readonly"],
    description: "Disabled range — both inputs read-only",
    fn: East.function([], UIComponentType, ($) => {
        const start = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
        const end = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
        return <DateRangeInput startValue={start} endValue={end} precision="date" disabled={true} />;
    }),
    inputs: [],
});
