/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, FloatType, NullType, example } from "@elaraai/east";
import { Reactive, Slider, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const sliderBasic = example({
    keywords: ["Slider", "Root", "min", "max", "step"],
    description: "Numeric range selection",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Slider.Root(50.0, { min: 0, max: 100 }),
            Slider.Root(25.0, { min: 0, max: 100, step: 25 }),
            Slider.Root(75.0, { min: 0, max: 100, disabled: true }),
        ], { gap: "4", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

export const sliderInteractive = example({
    keywords: ["Slider", "Root", "Reactive", "State", "onChange", "interactive"],
    description: "Drag to see live value updates — paired with mono tabular readout",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const sliderBind = $.let(State.bind([FloatType], "form_slider", 50.0));
            const value = $.let(sliderBind.read());
            const onChange = $.const(East.function([FloatType], NullType, ($, newValue) => {
                $(sliderBind.write(newValue));
            }));

            return Stack.VStack([
                Slider.Root(value, { min: 0, max: 100, onChange }),
                Text.Presets.MonoKpi(East.str`${East.print(value)} %`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const sliderOnChangeEnd = example({
    keywords: ["Slider", "Reactive", "State", "onChangeEnd", "commit", "interactive"],
    description: "Slider that only commits on release via onChangeEnd",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([FloatType], "form_slider_commit", 50.0));
            const value = $.let(bind.read());
            const onChangeEnd = $.const(East.function([FloatType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return Stack.VStack([
                Slider.Root(value, { min: 0, max: 100, onChangeEnd }),
                Text.Presets.MonoLabel(East.str`COMMITTED · ${East.print(value)}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
