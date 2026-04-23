/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, NullType, StringType, example } from "@elaraai/east";
import { Highlight, Input, Reactive, Stack, State, UIComponentType } from "@elaraai/east-ui";

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
    keywords: ["Highlight", "Root", "background", "yellow", "fill"],
    description: "Yellow highlight background",
    fn: East.function([], UIComponentType, (_$) => {
        return Highlight.Root("Important information here", ["Important"], { background: "yellow.200" });
    }),
    inputs: [],
});

export const highlightGreen = example({
    keywords: ["Highlight", "Root", "background", "green", "success"],
    description: "Success-themed highlight",
    fn: East.function([], UIComponentType, (_$) => {
        return Highlight.Root(
            "Your changes have been saved successfully",
            ["saved", "successfully"],
            { background: "green.100", color: "green.900" },
        );
    }),
    inputs: [],
});

export const highlightBlue = example({
    keywords: ["Highlight", "Root", "background", "blue", "info"],
    description: "Info-themed highlight",
    fn: East.function([], UIComponentType, (_$) => {
        return Highlight.Root(
            "Click the submit button to proceed",
            ["submit", "button"],
            { background: "blue.100", color: "blue.900" },
        );
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
            { background: "yellow.200" }
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

export const highlightInteractive = example({
    keywords: ["Highlight", "Reactive", "State", "interactive", "search"],
    description: "Type a query to live-highlight matching words",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const search = $.let(State.bind([StringType], "highlight_query", "fox"));
            const term = $.let(search.read());
            const onChange = $.const(East.function([StringType], NullType, ($, next) => {
                $(search.write(next));
            }));
            return Stack.VStack([
                Input.String(term, { onChange, placeholder: "Type a word to highlight" }),
                Highlight.Root(
                    "The quick brown fox jumps over the lazy dog",
                    [term],
                    { background: "yellow.300" },
                ),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
