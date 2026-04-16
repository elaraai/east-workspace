/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, FloatType, NullType, example } from "@elaraai/east";
import { Badge, Box, Reactive, Splitter, Stack, State, Text, UIComponentType } from "../../src/index.js";

export const splitterHorizontal = example({
    keywords: ["Splitter", "Root", "Panel", "orientation", "horizontal"],
    description: "Two panels with horizontal split",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Splitter.Root([
                Splitter.Panel(
                    Box.Root([Text.Root("Left Panel")], { padding: "4", background: "blue.50" }),
                    { id: "left" }
                ),
                Splitter.Panel(
                    Box.Root([Text.Root("Right Panel")], { padding: "4", background: "green.50" }),
                    { id: "right" }
                ),
            ], [50, 50], { orientation: "horizontal" }),
        ], { height: "150px" });
    }),
    inputs: [],
});

export const splitterVertical = example({
    keywords: ["Splitter", "Root", "Panel", "orientation", "vertical"],
    description: "Top and bottom panels",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Splitter.Root([
                Splitter.Panel(
                    Box.Root([Text.Root("Top Panel")], { padding: "4", background: "purple.50" }),
                    { id: "top" }
                ),
                Splitter.Panel(
                    Box.Root([Text.Root("Bottom Panel")], { padding: "4", background: "orange.50" }),
                    { id: "bottom" }
                ),
            ], [40, 60], { orientation: "vertical" }),
        ], { height: "200px" });
    }),
    inputs: [],
});

export const splitterThreePanel = example({
    keywords: ["Splitter", "Root", "Panel", "three", "sidebar", "main"],
    description: "Sidebar, main, and details",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Splitter.Root([
                Splitter.Panel(
                    Box.Root([Text.Root("Sidebar")], { padding: "3", background: "gray.100" }),
                    { id: "sidebar" }
                ),
                Splitter.Panel(
                    Box.Root([Text.Root("Main Content")], { padding: "3", background: "gray.50" }),
                    { id: "main" }
                ),
                Splitter.Panel(
                    Box.Root([Text.Root("Details")], { padding: "3", background: "gray.100" }),
                    { id: "details" }
                ),
            ], [20, 60, 20], { orientation: "horizontal" }),
        ], { height: "150px" });
    }),
    inputs: [],
});

export const splitterConstrained = example({
    keywords: ["Splitter", "Panel", "minSize", "maxSize", "constraints"],
    description: "Panel with min/max sizes",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Splitter.Root([
                Splitter.Panel(
                    Box.Root([Text.Root("Nav (min 15%, max 30%)")], { padding: "3", background: "teal.50" }),
                    { id: "nav", minSize: 15, maxSize: 30 }
                ),
                Splitter.Panel(
                    Box.Root([Text.Root("Content (min 50%)")], { padding: "3", background: "teal.100" }),
                    { id: "content", minSize: 50 }
                ),
            ], [25, 75], { orientation: "horizontal" }),
        ], { height: "120px" });
    }),
    inputs: [],
});

export const splitterAsymmetric = example({
    keywords: ["Splitter", "Panel", "asymmetric", "70/30"],
    description: "Asymmetric default sizes",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Splitter.Root([
                Splitter.Panel(
                    Box.Root([Text.Root("Primary (70%)")], { padding: "3", background: "cyan.50" }),
                    { id: "primary" }
                ),
                Splitter.Panel(
                    Box.Root([Text.Root("Secondary (30%)")], { padding: "3", background: "cyan.100" }),
                    { id: "secondary" }
                ),
            ], [70, 30], { orientation: "horizontal" }),
        ], { height: "120px" });
    }),
    inputs: [],
});

export const splitterEditor = example({
    keywords: ["Splitter", "Panel", "editor", "terminal", "vertical"],
    description: "Code editor with terminal",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Splitter.Root([
                Splitter.Panel(
                    Box.Root([Text.Root("Code Editor")], { padding: "4", background: "gray.800", color: "white" }),
                    { id: "editor", minSize: 30 }
                ),
                Splitter.Panel(
                    Box.Root([Text.Root("Terminal")], { padding: "4", background: "gray.900", color: "green.400" }),
                    { id: "terminal", minSize: 10 }
                ),
            ], [70, 30], { orientation: "vertical" }),
        ], { height: "200px" });
    }),
    inputs: [],
});

export const splitterInteractive = example({
    keywords: ["Splitter", "Panel", "onResize", "Reactive", "State", "interactive", "callback"],
    description: "Drag to see onResize callback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const leftBind = $.let(State.bind([FloatType], "splitter_left_size", 50.0));
            const rightBind = $.let(State.bind([FloatType], "splitter_right_size", 50.0));
            const leftSize = $.let(leftBind.read());
            const rightSize = $.let(rightBind.read());

            const onResize = $.const(East.function(
                [Splitter.Types.ResizeDetails],
                NullType,
                ($, details) => {
                    const sizes = $.let(details.size);
                    $(leftBind.write(sizes.get(0n)));
                    $(rightBind.write(sizes.get(1n)));
                }
            ));

            return Stack.VStack([
                Box.Root([
                    Splitter.Root([
                        Splitter.Panel(
                            Box.Root([Text.Root("Left Panel")], { padding: "4", background: "blue.100" }),
                            { id: "left" }
                        ),
                        Splitter.Panel(
                            Box.Root([Text.Root("Right Panel")], { padding: "4", background: "green.100" }),
                            { id: "right" }
                        ),
                    ], [50, 50], { orientation: "horizontal", onResize }),
                ], { height: "150px" }),
                Stack.HStack([
                    Badge.Root(
                        East.str`Left: ${East.print(leftSize)}%`,
                        { colorPalette: "blue", variant: "solid" }
                    ),
                    Badge.Root(
                        East.str`Right: ${East.print(rightSize)}%`,
                        { colorPalette: "green", variant: "solid" }
                    ),
                ], { gap: "2" }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
