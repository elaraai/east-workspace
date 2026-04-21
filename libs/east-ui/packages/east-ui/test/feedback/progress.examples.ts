/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, FloatType, NullType, example } from "@elaraai/east";
import { Progress, Reactive, Slider, Stack, State, Text, UIComponentType } from "@elaraai/east-ui";

export const progressBasic = example({
    keywords: ["Progress", "Root", "basic"],
    description: "Simple progress bar",
    fn: East.function([], UIComponentType, (_$) => {
        return Progress.Root(60.0);
    }),
    inputs: [],
});

export const progressLabeled = example({
    keywords: ["Progress", "Root", "label", "valueText"],
    description: "Progress with label and value text",
    fn: East.function([], UIComponentType, (_$) => {
        return Progress.Root(75.0, {
            label: "Upload Progress",
            valueText: "75%",
        });
    }),
    inputs: [],
});

export const progressColors = example({
    keywords: ["Progress", "Root", "colorPalette", "blue", "green", "orange", "red"],
    description: "Different color palettes",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Progress.Root(80.0, { colorPalette: "blue", label: "Blue" }),
            Progress.Root(60.0, { colorPalette: "green", label: "Green" }),
            Progress.Root(40.0, { colorPalette: "orange", label: "Orange" }),
            Progress.Root(20.0, { colorPalette: "red", label: "Red" }),
        ], { gap: "4", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

export const progressSizes = example({
    keywords: ["Progress", "Root", "size", "xs", "sm", "md", "lg"],
    description: "Available sizes: xs, sm, md, lg",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Progress.Root(50.0, { size: "xs", colorPalette: "blue" }),
            Progress.Root(50.0, { size: "sm", colorPalette: "blue" }),
            Progress.Root(50.0, { size: "md", colorPalette: "blue" }),
            Progress.Root(50.0, { size: "lg", colorPalette: "blue" }),
        ], { gap: "4", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

export const progressStriped = example({
    keywords: ["Progress", "Root", "striped", "animated"],
    description: "Striped pattern for visual emphasis",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Progress.Root(65.0, { striped: true, colorPalette: "blue" }),
            Progress.Root(45.0, { striped: true, animated: true, colorPalette: "green" }),
        ], { gap: "4", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

export const progressRange = example({
    keywords: ["Progress", "Root", "min", "max", "label", "valueText"],
    description: "Progress with custom min/max",
    fn: East.function([], UIComponentType, (_$) => {
        return Progress.Root(7.5, {
            min: 0,
            max: 10,
            label: "Rating",
            valueText: "7.5 / 10",
            colorPalette: "purple",
        });
    }),
    inputs: [],
});

export const progressInteractive = example({
    keywords: ["Progress", "Reactive", "State", "Slider", "interactive"],
    description: "Progress driven by a Slider — slider's onChange updates the bar",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const bind = $.let(State.bind([FloatType], "progress_value", 50.0));
            const value = $.let(bind.read());
            const onChange = $.const(East.function([FloatType], NullType, ($, next) => {
                $(bind.write(next));
            }));
            return Stack.VStack([
                Progress.Root(value, { min: 0, max: 100, colorPalette: "blue", striped: true }),
                Slider.Root(value, { min: 0, max: 100, colorPalette: "blue", onChange }),
                Text.Root(East.str`Progress: ${East.print(value)}%`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
