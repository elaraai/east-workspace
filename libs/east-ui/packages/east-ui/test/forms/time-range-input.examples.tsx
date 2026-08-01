/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Separator, Text, TimeRangeInput, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const timeRangeInputBasic = example({
    keywords: ["TimeRangeInput", "Root", "shift", "time", "range"],
    description: "Basic 06:00 – 14:00 morning window with 15-min step",
    fn: East.function([], UIComponentType, ($) => {
        const start = $.let(360n, IntegerType);
        const end = $.let(840n, IntegerType);
        return <TimeRangeInput startValue={start} endValue={end} step={15n} />;
    }),
    inputs: [],
});

// ============================================================================
// Reactive — both inputs write back through the same callback
// ============================================================================

export const timeRangeInputReactive = example({
    keywords: ["TimeRangeInput", "Reactive", "State", "onChange", "interactive"],
    description: "Reactive range bound to State — both inputs write back through the same callback",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const startBind = $.let(State.bind([IntegerType], "trin.start", 360n));
            const endBind = $.let(State.bind([IntegerType], "trin.end", 840n));
            const start = $.let(startBind.read(), IntegerType);
            const end = $.let(endBind.read(), IntegerType);
            const onChange = $.const(East.function([IntegerType, IntegerType], NullType, ($, s, e) => {
                $(startBind.write(s));
                $(endBind.write(e));
            }));
            return (
                <VStack gap="3" align="flex-start">
                    <TimeRangeInput startValue={start} endValue={end} step={15n} onChange={onChange} />
                    {<Text.MonoLabel>{East.str`MIN · ${start} → ${end}`}</Text.MonoLabel>}
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// TimeRangeInput — presets, colours, sizes, disabled (variant panel)
// ============================================================================

export const timeRangeInputVariants = example({
    keywords: ["TimeRangeInput", "presets", "shift", "morning", "afternoon", "night", "colour", "color", "escape", "hatches", "size", "sm", "md", "lg", "disabled", "readonly"],
    description: "TimeRangeInput variant panel — range input presets (three named shift presets — clicking applies the start/end pair), range input colours (explicit colour overrides — text / background / border / focus border), range input sizes (all three sizes sm / md / lg stacked for comparison), range input disabled (disabled range — no editing, both inputs greyed)",
    fn: East.function([], UIComponentType, ($) => {
        const coloursStart = $.let(540n, IntegerType);
        const coloursEnd = $.let(1020n, IntegerType);
        const sizesStart = $.let(360n, IntegerType);
        const sizesEnd = $.let(840n, IntegerType);
        const disabledStart = $.let(360n, IntegerType);
        const disabledEnd = $.let(840n, IntegerType);
        return (
            <VStack gap="4" align="stretch">
                <Separator label="RANGE INPUT PRESETS" align="start" />
                <Reactive>{$ => {
                        const startBind = $.let(State.bind([IntegerType], "trin.preset.start", 360n));
                        const endBind = $.let(State.bind([IntegerType], "trin.preset.end", 840n));
                        const start = $.let(startBind.read(), IntegerType);
                        const end = $.let(endBind.read(), IntegerType);
                        const onChange = $.const(East.function([IntegerType, IntegerType], NullType, ($, s, e) => {
                            $(startBind.write(s));
                            $(endBind.write(e));
                        }));
                        return (
                            <TimeRangeInput
                                startValue={start}
                                endValue={end}
                                step={15n}
                                onChange={onChange}
                                presets={[
                                    { label: "Morning", start: 360n, end: 840n },
                                    { label: "Afternoon", start: 840n, end: 1320n },
                                    { label: "Night", start: 1320n, end: 360n },
                                ]}
                            />
                        );
                    }}</Reactive>
                <Separator label="RANGE INPUT COLOURS" align="start" />
                <TimeRangeInput startValue={coloursStart} endValue={coloursEnd} step={15n} color="fg" background="bg.subtle" borderColor="blue.300" focusBorderColor="blue.500" />
                <Separator label="RANGE INPUT SIZES" align="start" />
                <VStack gap="3" align="flex-start">
                    <TimeRangeInput startValue={sizesStart} endValue={sizesEnd} step={15n} size="sm" />
                    <TimeRangeInput startValue={sizesStart} endValue={sizesEnd} step={15n} size="md" />
                    <TimeRangeInput startValue={sizesStart} endValue={sizesEnd} step={15n} size="lg" />
                </VStack>
                <Separator label="RANGE INPUT DISABLED" align="start" />
                <TimeRangeInput startValue={disabledStart} endValue={disabledEnd} step={15n} disabled={true} />
            </VStack>
        );
    }),
    inputs: [],
});
