/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, example } from "@elaraai/east";
import { Note, Stack, Text, UIComponentType } from "@elaraai/east-ui";

export const noteNarrative = example({
    keywords: ["Note", "Root", "variant", "narrative"],
    description: "Narrative prose block (dashed border accent + muted body)",
    fn: East.function([], UIComponentType, (_$) => {
        return Note.Root(
            "A slow process rate combined with setpoint drift since 02:00 is delaying Stage 1 by ~6 hours.",
            { variant: "narrative" },
        );
    }),
    inputs: [],
});

export const noteCallout = example({
    keywords: ["Note", "Root", "variant", "callout"],
    description: "Important callout (solid border accent, info palette)",
    fn: East.function([], UIComponentType, (_$) => {
        return Note.Root(
            "Raising this retrains the workforce chain model — expect ~30 min recompute.",
            { variant: "callout", emphasis: "strong" },
        );
    }),
    inputs: [],
});

export const noteQuote = example({
    keywords: ["Note", "Root", "variant", "quote"],
    description: "Block-quote style Note (indented + italic)",
    fn: East.function([], UIComponentType, (_$) => {
        return Note.Root(
            Text.Root("\u201CThe fastest path to confident decisions is the one we can audit twice.\u201D", {
                fontStyle: "italic",
            }),
            { variant: "quote" },
        );
    }),
    inputs: [],
});

export const noteRichBody = example({
    keywords: ["Note", "Root", "rich", "body", "UIComp"],
    description: "Rich UIComp body — Stack of Text children inside a Note",
    fn: East.function([], UIComponentType, (_$) => {
        return Note.Root(
            Stack.VStack([
                Text.Root("Service level slipped from 92% to 85% this week.", { fontWeight: "semibold" }),
                Text.Root("Root cause: Stage 2 blender #3 downtime 07:00–11:30 on Wednesday.", { color: "fg.muted" }),
            ], { gap: "1", align: "flex-start" }),
            { variant: "narrative" },
        );
    }),
    inputs: [],
});
