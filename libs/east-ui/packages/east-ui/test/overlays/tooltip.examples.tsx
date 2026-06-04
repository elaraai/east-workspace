/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Button, Tooltip } from "@elaraai/east-ui/jsx";

export const tooltipBasic = example({
    keywords: ["Tooltip", "Root", "basic", "hover"],
    description: "Simple tooltip on hover",
    fn: East.function([], UIComponentType, (_$) => {
        return <Tooltip trigger={<Button>Hover me</Button>}>This is a tooltip</Tooltip>;
    }),
    inputs: [],
});

export const tooltipArrow = example({
    keywords: ["Tooltip", "Root", "hasArrow", "arrow"],
    description: "Tooltip with pointing arrow",
    fn: East.function([], UIComponentType, (_$) => {
        return <Tooltip trigger={<Button variant="solid">With Arrow</Button>} hasArrow={true}>This tooltip has an arrow</Tooltip>;
    }),
    inputs: [],
});
