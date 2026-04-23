/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { ScrollArea, Stack, Text, Box, UIComponentType } from "@elaraai/east-ui";

export const scrollAreaDriverList = example({
    keywords: ["ScrollArea", "Root", "vertical", "driver-list", "radix", "scroll"],
    description: "Vertical ScrollArea wrapping a 40-item list — consistent scrollbar across browsers",
    fn: East.function([], UIComponentType, (_$) => {
        const items = Array.from({ length: 40 }, (_, i) =>
            Box.Root([Text.Root(`Driver ${i + 1}`)], {
                padding: "2",
                borderColor: "gray.100",
                borderWidth: "thin",
            }),
        );
        return ScrollArea.Root(
            Stack.VStack(items, { gap: "1" }),
            { orientation: "vertical", scrollbarStyle: "overlay" },
        );
    }),
    inputs: [],
});

export const scrollAreaTableInDrawer = example({
    keywords: ["ScrollArea", "Root", "both", "horizontal", "reserved", "wide-content"],
    description: "ScrollArea with both-axis scroll and reserved gutter (no layout shift)",
    fn: East.function([], UIComponentType, (_$) => {
        const wide = Box.Root(
            [Text.Root("A wide block — ".repeat(20))],
            { padding: "3", width: "1200px", background: "white" },
        );
        return Box.Root([
            ScrollArea.Root(wide, {
                orientation: "both",
                scrollbarStyle: "reserved",
                style: { background: "gray.50" },
            }),
        ], { width: "400px", height: "200px", borderColor: "gray.300", borderWidth: "thin" });
    }),
    inputs: [],
});
