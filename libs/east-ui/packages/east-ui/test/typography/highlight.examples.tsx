/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Highlight, Input, Reactive, VStack } from "@elaraai/east-ui";

export const highlightSingleTerm = example({
    keywords: ["Highlight", "Root", "single", "term", "search"],
    description: "Highlighting one word",
    fn: East.function([], UIComponentType, (_$) => {
        return <Highlight query={["React"]}>React is a JavaScript library</Highlight>;
    }),
    inputs: [],
});

export const highlightMultipleTerms = example({
    keywords: ["Highlight", "Root", "multiple", "terms"],
    description: "Highlighting several words",
    fn: East.function([], UIComponentType, (_$) => {
        return <Highlight query={["quick", "fox", "dog"]}>The quick brown fox jumps over the lazy dog</Highlight>;
    }),
    inputs: [],
});

export const highlightCustomColor = example({
    keywords: ["Highlight", "Root", "background", "yellow", "fill"],
    description: "Yellow highlight background",
    fn: East.function([], UIComponentType, (_$) => {
        return <Highlight query={["Important"]} background="yellow.200">Important information here</Highlight>;
    }),
    inputs: [],
});

export const highlightGreen = example({
    keywords: ["Highlight", "Root", "background", "green", "success"],
    description: "Success-themed highlight",
    fn: East.function([], UIComponentType, (_$) => {
        return <Highlight query={["saved", "successfully"]} background="green.100" color="green.900">Your changes have been saved successfully</Highlight>;
    }),
    inputs: [],
});

export const highlightBlue = example({
    keywords: ["Highlight", "Root", "background", "blue", "info"],
    description: "Info-themed highlight",
    fn: East.function([], UIComponentType, (_$) => {
        return <Highlight query={["submit", "button"]} background="blue.100" color="blue.900">Click the submit button to proceed</Highlight>;
    }),
    inputs: [],
});

export const highlightSearchResult = example({
    keywords: ["Highlight", "Root", "search", "result"],
    description: "Typical search result display",
    fn: East.function([], UIComponentType, (_$) => {
        return <Highlight query={["TypeScript", "JavaScript"]} background="yellow.200">TypeScript is a typed superset of JavaScript that compiles to plain JavaScript</Highlight>;
    }),
    inputs: [],
});

export const highlightNoMatches = example({
    keywords: ["Highlight", "Root", "no matches", "empty"],
    description: "When query doesn't match",
    fn: East.function([], UIComponentType, (_$) => {
        return <Highlight query={["xyz"]}>This text has no highlighted words</Highlight>;
    }),
    inputs: [],
});

export const highlightInteractive = example({
    keywords: ["Highlight", "Reactive", "State", "interactive", "search"],
    description: "Type a query to live-highlight matching words",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const search = $.let(State.bind([StringType], "highlight_query", "fox"));
            const term = $.let(search.read());
            const onChange = $.const(East.function([StringType], NullType, ($, next) => {
                $(search.write(next));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Input.String value={term} onChange={onChange} placeholder="Type a word to highlight" />
                    <Highlight query={[term]} background="yellow.300">The quick brown fox jumps over the lazy dog</Highlight>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
