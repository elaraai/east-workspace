/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Note, VStack, Text } from "@elaraai/east-ui/jsx";

export const noteNarrative = example({
    keywords: ["Note", "Root", "variant", "narrative"],
    description: "Narrative prose block (dashed border accent + muted body)",
    fn: East.function([], UIComponentType, (_$) => {
        return <Note variant="narrative">A slow process rate combined with setpoint drift since 02:00 is delaying Stage 1 by ~6 hours.</Note>;
    }),
    inputs: [],
});

export const noteCallout = example({
    keywords: ["Note", "Root", "variant", "callout"],
    description: "Important callout (solid border accent, info palette)",
    fn: East.function([], UIComponentType, (_$) => {
        return <Note variant="callout" emphasis="strong">Raising this retrains the workforce chain model — expect ~30 min recompute.</Note>;
    }),
    inputs: [],
});

export const noteQuote = example({
    keywords: ["Note", "Root", "variant", "quote"],
    description: "Block-quote style Note (indented + italic)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Note variant="quote">
                <Text fontStyle="italic">{"“The fastest path to confident decisions is the one we can audit twice.”"}</Text>
            </Note>
        );
    }),
    inputs: [],
});

export const noteRichBody = example({
    keywords: ["Note", "Root", "rich", "body", "UIComp"],
    description: "Rich UIComp body — Stack of Text children inside a Note",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Note variant="narrative">
                <VStack gap="1" align="flex-start">
                    <Text fontWeight="semibold">Service level slipped from 92% to 85% this week.</Text>
                    <Text color="fg.muted">Root cause: Stage 2 blender #3 downtime 07:00–11:30 on Wednesday.</Text>
                </VStack>
            </Note>
        );
    }),
    inputs: [],
});
