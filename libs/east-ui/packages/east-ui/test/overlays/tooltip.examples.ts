/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Button, Tooltip, UIComponentType } from "@elaraai/east-ui";

export const tooltipBasic = example({
    keywords: ["Tooltip", "Root", "basic", "hover"],
    description: "Simple tooltip on hover",
    fn: East.function([], UIComponentType, (_$) => {
        return Tooltip.Root(
            Button.Root("Hover me"),
            "This is a tooltip"
        );
    }),
    inputs: [],
});

export const tooltipArrow = example({
    keywords: ["Tooltip", "Root", "hasArrow", "arrow"],
    description: "Tooltip with pointing arrow",
    fn: East.function([], UIComponentType, (_$) => {
        return Tooltip.Root(
            Button.Root("With Arrow", { style: { variant: "solid" } }),
            "This tooltip has an arrow",
            { hasArrow: true }
        );
    }),
    inputs: [],
});
