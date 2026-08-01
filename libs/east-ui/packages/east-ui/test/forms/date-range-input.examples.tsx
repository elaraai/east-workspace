/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, DateTimeType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { DateRangeInput, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

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

// ============================================================================
// Reactive — both fields write back through one callback
// ============================================================================

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
                    {<Text.MonoLabel>{East.str`${start} → ${end}`}</Text.MonoLabel>}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// DateRangeInput — precision, presets, colours, sizes, disabled (variant panel)
// ============================================================================

export const dateRangeInputVariants = example({
    keywords: ["DateRangeInput", "precision", "datetime", "time", "hours", "presets", "relative", "MTD", "YTD", "Last 7 days", "colour", "color", "escape", "hatches", "size", "sm", "md", "lg", "disabled", "readonly"],
    description: "DateRangeInput variant panel — range input date time (DateTime precision — picker exposes date + time-of-day), range input presets (range with five canonical presets — Last 7 days / MTD / QTD / YTD / Q2 2026), range input colours (explicit colour overrides — text / background / border / focus border), range input sizes (all three sizes sm / md / lg stacked for comparison), range input disabled (disabled range — both inputs read-only)",
    fn: East.function([], UIComponentType, ($) => {
        const dateTimeStart = $.let(new Date("2026-04-01T09:00:00Z"), DateTimeType);
        const dateTimeEnd = $.let(new Date("2026-04-01T17:00:00Z"), DateTimeType);
        const coloursStart = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
        const coloursEnd = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
        const sizesStart = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
        const sizesEnd = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
        const disabledStart = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
        const disabledEnd = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RANGE INPUT DATE TIME</Text>
                    <DateRangeInput startValue={dateTimeStart} endValue={dateTimeEnd} precision="datetime" />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RANGE INPUT PRESETS</Text>
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
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RANGE INPUT COLOURS</Text>
                    <DateRangeInput startValue={coloursStart} endValue={coloursEnd} precision="date" color="fg" background="bg.subtle" borderColor="blue.300" focusBorderColor="blue.500" />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RANGE INPUT SIZES</Text>
                    <VStack gap="3" align="flex-start">
                        <DateRangeInput startValue={sizesStart} endValue={sizesEnd} precision="date" size="sm" />
                        <DateRangeInput startValue={sizesStart} endValue={sizesEnd} precision="date" size="md" />
                        <DateRangeInput startValue={sizesStart} endValue={sizesEnd} precision="date" size="lg" />
                    </VStack>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">RANGE INPUT DISABLED</Text>
                    <DateRangeInput startValue={disabledStart} endValue={disabledEnd} precision="date" disabled={true} />
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
