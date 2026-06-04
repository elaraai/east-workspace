/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Skeleton, Stack, UIComponentType } from "@elaraai/east-ui";

export const skeletonTextBlock = example({
    keywords: ["Skeleton", "text", "lines"],
    description: "Text skeleton with 3 lines",
    fn: East.function([], UIComponentType, (_$) => {
        return Skeleton.Root("text", { lines: 3n });
    }),
    inputs: [],
});

export const skeletonCard = example({
    keywords: ["Skeleton", "rect", "text", "card shape"],
    description: "Card-shaped skeleton — image + two text lines + button",
    fn: East.function([], UIComponentType, (_$) => {
        return Stack.VStack([
            Skeleton.Root("rect", { style: { width: "100%", height: "120px" } }),
            Skeleton.Root("text", { lines: 2n }),
            Skeleton.Root("rect", { style: { width: "96px", height: "32px" } }),
        ], { gap: "3", align: "stretch" });
    }),
    inputs: [],
});

export const skeletonRow = example({
    keywords: ["Skeleton", "rect", "count", "table row"],
    description: "5-row repeated table-row skeleton using count",
    fn: East.function([], UIComponentType, (_$) => {
        return Skeleton.Root("rect", {
            count: 5n,
            style: { width: "100%", height: "28px" },
        });
    }),
    inputs: [],
});
