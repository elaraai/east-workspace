/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Box, ScrollArea, Text, VStack } from "@elaraai/east-ui";

export const scrollAreaDriverList = example({
    keywords: ["ScrollArea", "Root", "vertical", "driver-list", "radix", "scroll"],
    description: "Vertical ScrollArea wrapping a 40-item list — consistent scrollbar across browsers",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <ScrollArea scrollbarStyle="overlay" orientation="vertical">
                <VStack gap="1">
                    {Array.from({ length: 40 }, (_, i) => (
                        <Box padding="2" borderColor="gray.100" borderWidth="thin"><Text>{`Driver ${i + 1}`}</Text></Box>
                    ))}
                </VStack>
            </ScrollArea>
        );
    }),
    inputs: [],
});

export const scrollAreaTableInDrawer = example({
    keywords: ["ScrollArea", "Root", "both", "horizontal", "reserved", "wide-content"],
    description: "ScrollArea with both-axis scroll and reserved gutter (no layout shift)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box width="400px" height="200px" borderColor="gray.300" borderWidth="thin">
                <ScrollArea scrollbarStyle="reserved" orientation="both" background="gray.50">
                    <Box padding="3" width="1200px" background="white">
                        <Text>{"A wide block — ".repeat(20)}</Text>
                    </Box>
                </ScrollArea>
            </Box>
        );
    }),
    inputs: [],
});
