/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Skeleton, VStack } from "@elaraai/east-ui";

export const skeletonTextBlock = example({
    keywords: ["Skeleton", "text", "lines"],
    description: "Text skeleton with 3 lines",
    fn: East.function([], UIComponentType, (_$) => {
        return <Skeleton shape="text" lines={3n} />;
    }),
    inputs: [],
});

export const skeletonCard = example({
    keywords: ["Skeleton", "rect", "text", "card shape"],
    description: "Card-shaped skeleton — image + two text lines + button",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="3" align="stretch">
                <Skeleton shape="rect" width="100%" height="120px" />
                <Skeleton shape="text" lines={2n} />
                <Skeleton shape="rect" width="96px" height="32px" />
            </VStack>
        );
    }),
    inputs: [],
});

export const skeletonRow = example({
    keywords: ["Skeleton", "rect", "count", "table row"],
    description: "5-row repeated table-row skeleton using count",
    fn: East.function([], UIComponentType, (_$) => {
        return <Skeleton shape="rect" count={5n} width="100%" height="28px" />;
    }),
    inputs: [],
});
