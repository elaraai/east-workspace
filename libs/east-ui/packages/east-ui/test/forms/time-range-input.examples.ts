/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Reactive, Stack, State, Text, TimeRangeInput, UIComponentType } from "@elaraai/east-ui";

export const timeRangeInputBasic = example({
    keywords: ["TimeRangeInput", "Root", "shift", "time", "range"],
    description: "Basic 06:00 – 14:00 morning window with 15-min step",
    fn: East.function([], UIComponentType, ($) => {
        const start = $.let(360n, IntegerType);
        const end = $.let(840n, IntegerType);
        return TimeRangeInput.Root(start, end, { step: 15n });
    }),
    inputs: [],
});

export const timeRangeInputReactive = example({
    keywords: ["TimeRangeInput", "Reactive", "State", "onChange", "interactive"],
    description: "Reactive range bound to State — both inputs write back through the same callback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const startBind = $.let(State.bind([IntegerType], "trin.start", 360n));
            const endBind = $.let(State.bind([IntegerType], "trin.end", 840n));
            const start = $.let(startBind.read(), IntegerType);
            const end = $.let(endBind.read(), IntegerType);
            const onChange = $.const(East.function([IntegerType, IntegerType], NullType, ($, s, e) => {
                $(startBind.write(s));
                $(endBind.write(e));
            }));
            return Stack.VStack([
                TimeRangeInput.Root(start, end, { step: 15n, onChange }),
                Text.Presets.MonoLabel(East.str`MIN · ${start} → ${end}`),
            ], { gap: "3", align: "flex-start" });
        }));
    }),
    inputs: [],
});

export const timeRangeInputPresets = example({
    keywords: ["TimeRangeInput", "presets", "shift", "morning", "afternoon", "night"],
    description: "Three named shift presets — clicking applies the start/end pair",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const startBind = $.let(State.bind([IntegerType], "trin.preset.start", 360n));
            const endBind = $.let(State.bind([IntegerType], "trin.preset.end", 840n));
            const start = $.let(startBind.read(), IntegerType);
            const end = $.let(endBind.read(), IntegerType);
            const onChange = $.const(East.function([IntegerType, IntegerType], NullType, ($, s, e) => {
                $(startBind.write(s));
                $(endBind.write(e));
            }));
            return TimeRangeInput.Root(start, end, {
                step: 15n,
                onChange,
                presets: [
                    { label: "Morning", start: 360n, end: 840n },        // 06:00 – 14:00
                    { label: "Afternoon", start: 840n, end: 1320n },     // 14:00 – 22:00
                    { label: "Night", start: 1320n, end: 360n },         // 22:00 – 06:00 (overnight)
                ],
            });
        }));
    }),
    inputs: [],
});

export const timeRangeInputColours = example({
    keywords: ["TimeRangeInput", "colour", "color", "escape", "hatches"],
    description: "Explicit colour overrides — text / background / border / focus border",
    fn: East.function([], UIComponentType, ($) => {
        const start = $.let(540n, IntegerType);   // 09:00
        const end = $.let(1020n, IntegerType);    // 17:00
        return TimeRangeInput.Root(start, end, {
            step: 15n,
            color: "fg",
            background: "bg.subtle",
            borderColor: "blue.300",
            focusBorderColor: "blue.500",
        });
    }),
    inputs: [],
});

export const timeRangeInputSizes = example({
    keywords: ["TimeRangeInput", "size", "sm", "md", "lg"],
    description: "All three sizes (sm / md / lg) stacked for comparison",
    fn: East.function([], UIComponentType, ($) => {
        const start = $.let(360n, IntegerType);
        const end = $.let(840n, IntegerType);
        return Stack.VStack([
            TimeRangeInput.Root(start, end, { step: 15n, size: "sm" }),
            TimeRangeInput.Root(start, end, { step: 15n, size: "md" }),
            TimeRangeInput.Root(start, end, { step: 15n, size: "lg" }),
        ], { gap: "3", align: "flex-start" });
    }),
    inputs: [],
});

export const timeRangeInputDisabled = example({
    keywords: ["TimeRangeInput", "disabled", "readonly"],
    description: "Disabled range — no editing, both inputs greyed",
    fn: East.function([], UIComponentType, ($) => {
        const start = $.let(360n, IntegerType);
        const end = $.let(840n, IntegerType);
        return TimeRangeInput.Root(start, end, { step: 15n, disabled: true });
    }),
    inputs: [],
});
