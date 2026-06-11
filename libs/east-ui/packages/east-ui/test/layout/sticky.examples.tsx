/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Box, Sticky, Text, VStack, HStack } from "@elaraai/east-ui";

export const stickyHeader = example({
    keywords: ["Sticky", "Root", "header", "position", "sticky", "scrolling"],
    description: "Sticky header that stays pinned to the top of its scroll container while body scrolls",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box overflowY="auto" height="240px" borderColor="gray.300" borderWidth="thin">
                <Sticky offset="0" boundary="parent" background="white" borderColor="gray.200">
                    <Box padding="3" background="white" borderColor="gray.200" borderWidth="thin">
                        <Text>Section header — stays pinned</Text>
                    </Box>
                </Sticky>
                <VStack gap="2" padding="3">
                    <Text>Row 1</Text>
                    <Text>Row 2</Text>
                    <Text>Row 3</Text>
                    <Text>Row 4</Text>
                    <Text>Row 5</Text>
                    <Text>Row 6</Text>
                    <Text>Row 7</Text>
                    <Text>Row 8</Text>
                </VStack>
            </Box>
        );
    }),
    inputs: [],
});

export const stickySubnav = example({
    keywords: ["Sticky", "Root", "subnav", "side-panel", "sticky"],
    description: "Left-column subnav that sticks at top: 0 while the main content scrolls",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Box overflowY="auto" height="300px" borderColor="gray.300" borderWidth="thin">
                <HStack gap="4" align="flex-start">
                    <Sticky offset="0" boundary="parent">
                        <VStack gap="2" padding="3" background="gray.50" borderColor="gray.200" borderWidth="thin" borderRadius="md">
                            <Text>Overview</Text>
                            <Text>Details</Text>
                            <Text>Audit</Text>
                            <Text>Settings</Text>
                        </VStack>
                    </Sticky>
                    <VStack gap="3" padding="3">
                        {Array.from({ length: 20 }, (_, i) => <Text>{`Paragraph ${i + 1}`}</Text>)}
                    </VStack>
                </HStack>
            </Box>
        );
    }),
    inputs: [],
});
