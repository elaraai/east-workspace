/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Sticky, Stack, Text, Box, UIComponentType } from "@elaraai/east-ui";

export const stickyHeader = example({
    keywords: ["Sticky", "Root", "header", "position", "sticky", "scrolling"],
    description: "Sticky header that stays pinned to the top of its scroll container while body scrolls",
    fn: East.function([], UIComponentType, (_$) => {
        return Box.Root([
            Sticky.Root(
                Box.Root([Text.Root("Section header — stays pinned")], {
                    padding: "3",
                    background: "white",
                    borderColor: "gray.200",
                    borderWidth: "thin",
                }),
                {
                    offset: "0",
                    boundary: "parent",
                    style: { background: "white", borderColor: "gray.200" },
                },
            ),
            Stack.VStack([
                Text.Root("Row 1"),
                Text.Root("Row 2"),
                Text.Root("Row 3"),
                Text.Root("Row 4"),
                Text.Root("Row 5"),
                Text.Root("Row 6"),
                Text.Root("Row 7"),
                Text.Root("Row 8"),
            ], { gap: "2", padding: "3" }),
        ], { overflowY: "auto", height: "240px", borderColor: "gray.300", borderWidth: "thin" });
    }),
    inputs: [],
});

export const stickySubnav = example({
    keywords: ["Sticky", "Root", "subnav", "side-panel", "sticky"],
    description: "Left-column subnav that sticks at top: 0 while the main content scrolls",
    fn: East.function([], UIComponentType, (_$) => {
        const subnav = Sticky.Root(
            Stack.VStack([
                Text.Root("Overview"),
                Text.Root("Details"),
                Text.Root("Audit"),
                Text.Root("Settings"),
            ], { gap: "2", padding: "3", background: "gray.50", borderColor: "gray.200", borderWidth: "thin", borderRadius: "md" }),
            { offset: "0", boundary: "parent" },
        );
        const main = Stack.VStack(
            Array.from({ length: 20 }, (_, i) => Text.Root(`Paragraph ${i + 1}`)),
            { gap: "3", padding: "3" },
        );
        return Box.Root([
            Stack.HStack([subnav, main], { gap: "4", align: "flex-start" }),
        ], { overflowY: "auto", height: "300px", borderColor: "gray.300", borderWidth: "thin" });
    }),
    inputs: [],
});
