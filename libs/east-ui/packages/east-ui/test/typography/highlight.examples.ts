/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, example } from "@elaraai/east";
import { Highlight, UIComponentType } from "../../src/index.js";

export const highlightSingleTerm = example({
    keywords: ["Highlight", "Root", "single", "term", "search"],
    description: "Highlighting one word",
    fn: East.function([], UIComponentType, (_$) => {
        return Highlight.Root("React is a JavaScript library", ["React"]);
    }),
    inputs: [],
});

export const highlightMultipleTerms = example({
    keywords: ["Highlight", "Root", "multiple", "terms"],
    description: "Highlighting several words",
    fn: East.function([], UIComponentType, (_$) => {
        return Highlight.Root("The quick brown fox jumps over the lazy dog", ["quick", "fox", "dog"]);
    }),
    inputs: [],
});

export const highlightCustomColor = example({
    keywords: ["Highlight", "Root", "color", "yellow"],
    description: "Yellow highlight background",
    fn: East.function([], UIComponentType, (_$) => {
        return Highlight.Root("Important information here", ["Important"], { color: "yellow.200" });
    }),
    inputs: [],
});

export const highlightGreen = example({
    keywords: ["Highlight", "Root", "color", "green", "success"],
    description: "Success-themed highlight",
    fn: East.function([], UIComponentType, (_$) => {
        return Highlight.Root("Your changes have been saved successfully", ["saved", "successfully"], { color: "green.100" });
    }),
    inputs: [],
});

export const highlightBlue = example({
    keywords: ["Highlight", "Root", "color", "blue", "info"],
    description: "Info-themed highlight",
    fn: East.function([], UIComponentType, (_$) => {
        return Highlight.Root("Click the submit button to proceed", ["submit", "button"], { color: "blue.100" });
    }),
    inputs: [],
});

export const highlightSearchResult = example({
    keywords: ["Highlight", "Root", "search", "result"],
    description: "Typical search result display",
    fn: East.function([], UIComponentType, (_$) => {
        return Highlight.Root(
            "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript",
            ["TypeScript", "JavaScript"],
            { color: "yellow.200" }
        );
    }),
    inputs: [],
});

export const highlightNoMatches = example({
    keywords: ["Highlight", "Root", "no matches", "empty"],
    description: "When query doesn't match",
    fn: East.function([], UIComponentType, (_$) => {
        return Highlight.Root("This text has no highlighted words", ["xyz"]);
    }),
    inputs: [],
});
