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
    keywords: ["Progress", "Root", "colorPalette"],
    description: "Different color palettes via style.colorPalette",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Progress.Root(80.0, { label: "Blue", style: { colorPalette: "blue" } }),
            Progress.Root(60.0, { label: "Green", style: { colorPalette: "green" } }),
            Progress.Root(40.0, { label: "Orange", style: { colorPalette: "orange" } }),
            Progress.Root(20.0, { label: "Red", style: { colorPalette: "red" } }),
        ], { gap: "4", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

export const progressSizes = example({
    keywords: ["Progress", "Root", "size"],
    description: "Available sizes via style.size",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Progress.Root(50.0, { style: { size: "xs", colorPalette: "blue" } }),
            Progress.Root(50.0, { style: { size: "sm", colorPalette: "blue" } }),
            Progress.Root(50.0, { style: { size: "md", colorPalette: "blue" } }),
            Progress.Root(50.0, { style: { size: "lg", colorPalette: "blue" } }),
        ], { gap: "4", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

export const progressStriped = example({
    keywords: ["Progress", "Root", "striped", "animated"],
    description: "Striped pattern for visual emphasis",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Progress.Root(65.0, { style: { striped: true, colorPalette: "blue" } }),
            Progress.Root(45.0, { style: { striped: true, animated: true, colorPalette: "green" } }),
        ], { gap: "4", align: "stretch", width: "100%" });
    }),
    inputs: [],
});

export const progressRange = example({
    keywords: ["Progress", "Root", "min", "max"],
    description: "Progress with custom min/max",
    fn: East.function([], UIComponentType, (_$) => {
        return Progress.Root(7.5, {
            min: 0,
            max: 10,
            label: "Rating",
            valueText: "7.5 / 10",
            style: { colorPalette: "purple" },
        });
    }),
    inputs: [],
});

export const progressIndeterminate = example({
    keywords: ["Progress", "indeterminate"],
    description: "Indeterminate progress — no known completion percentage",
    fn: East.function([], UIComponentType, (_$) => {
        return Progress.Root(0.0, {
            indeterminate: true,
            label: "Solver running…",
            style: { colorPalette: "blue" },
        });
    }),
    inputs: [],
});

export const progressWithETA = example({
    keywords: ["Progress", "estimatedDuration", "startedAt", "ETA"],
    description: "Progress with an estimated duration + startedAt drives an ETA label in the renderer",
    fn: East.function([], UIComponentType, (_$) => {
        return Progress.Root(42.0, {
            label: "Solver running",
            estimatedDuration: 120n,
            startedAt: new Date("2026-01-01T09:00:00Z"),
            showValue: true,
            style: { colorPalette: "blue" },
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
                Progress.Root(value, { min: 0, max: 100, style: { colorPalette: "blue", striped: true } }),
                Slider.Root(value, { min: 0, max: 100, colorPalette: "blue", onChange }),
                Text.Root(East.str`Progress: ${East.print(value)}%`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
