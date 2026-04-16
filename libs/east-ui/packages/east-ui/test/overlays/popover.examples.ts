/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Button, Chart, Popover, Text, UIComponentType } from "../../src/index.js";

export const popoverBasic = example({
    keywords: ["Popover", "Root", "title", "description", "click"],
    description: "Click-triggered floating panel",
    fn: East.function([], UIComponentType, (_$) => {
        return Popover.Root(
            Button.Root("Open Popover"),
            [Text.Root("This is the popover content. You can put any UI components here.")],
            { title: "Popover Title", description: "A helpful description" }
        );
    }),
    inputs: [],
});

export const popoverChart = example({
    keywords: ["Popover", "Root", "Chart", "Area", "hasArrow"],
    description: "Rich content with area chart",
    fn: East.function([], UIComponentType, (_$) => {
        return Popover.Root(
            Button.Root("View Stats", { variant: "solid", colorPalette: "blue" }),
            [
                Chart.Area(
                    [
                        { day: "Mon", value: 120 },
                        { day: "Tue", value: 150 },
                        { day: "Wed", value: 180 },
                        { day: "Thu", value: 140 },
                        { day: "Fri", value: 200 },
                    ],
                    {
                        value: { color: "blue.solid" },
                    },
                    {
                        xAxis: { dataKey: "day" },
                        fillOpacity: 0.3,
                        margin: { top: 30n, right: 0n, bottom: 0n, left: -20n },
                    }
                ),
            ],
            { hasArrow: true, title: "Weekly Sales" }
        );
    }),
    inputs: [],
});
