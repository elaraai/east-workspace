/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Button, Icon, Stack, Text, ToggleTip, UIComponentType } from "../../src/index.js";

export const toggleTipBasic = example({
    keywords: ["ToggleTip", "Root", "Icon", "accessible", "click"],
    description: "Click-activated tooltip (accessible)",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.HStack([
            Text.Root("What is this?"),
            ToggleTip.Root(
                Icon.Root("fas", "question-circle", { size: "sm", color: "gray.500" }),
                "ToggleTip is an accessible alternative to hover tooltips. Click to toggle!",
                { placement: "top", hasArrow: true }
            ),
        ], { gap: "2", align: "center" });
    }),
    inputs: [],
});

export const toggleTipInfo = example({
    keywords: ["ToggleTip", "Root", "info", "help", "Button"],
    description: "Help button with toggle tip",
    fn: East.function([], UIComponentType, (_$) => {
        return ToggleTip.Root(
            Button.Root("?", { variant: "outline", size: "sm" }),
            "Click the info button for help. This is useful for touch and keyboard users.",
            { placement: "bottom" }
        );
    }),
    inputs: [],
});
