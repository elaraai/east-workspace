/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, FloatType, NullType, example } from "@elaraai/east";
import { Badge, Reactive, Slider, Stack, State, Text, UIComponentType } from "../../src/index.js";

export const sliderBasic = example({
    keywords: ["Slider", "Root", "min", "max", "step", "colorPalette"],
    description: "Numeric range selection",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Slider.Root(50.0, { min: 0, max: 100, colorPalette: "blue" }),
            Slider.Root(25.0, { min: 0, max: 100, step: 25, colorPalette: "green" }),
            Slider.Root(75.0, { min: 0, max: 100, disabled: true }),
        ], { gap: "4", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

export const sliderInteractive = example({
    keywords: ["Slider", "Root", "Reactive", "State", "onChange", "interactive"],
    description: "Drag to see live value updates",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const sliderBind = $.let(State.bind([FloatType], "form_slider", 50.0));
            const value = $.let(sliderBind.read());
            const onChange = $.const(East.function([FloatType], NullType, ($, newValue) => {
                $(sliderBind.write(newValue));
            }));

            return Stack.VStack([
                Slider.Root(value, {
                    min: 0,
                    max: 100,
                    colorPalette: "blue",
                    onChange,
                }),
                Text.Root(East.str`Value: ${East.print(value)}`),
                Badge.Root(
                    East.str`${East.print(value)}%`,
                    { colorPalette: "blue", variant: "solid" }
                ),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
