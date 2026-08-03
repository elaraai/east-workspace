/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Highlight, Input, Reactive, Separator, VStack } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const highlightBasic = example({
    keywords: ["Highlight", "Root", "single", "term", "search", "basic"],
    description: "Highlighting one word",
    fn: East.function([], UIComponentType, (_$) => {
        return <Highlight query={["React"]}>React is a JavaScript library</Highlight>;
    }),
    inputs: [],
});

// ============================================================================
// Highlight — terms, colours, search flows (variant panel)
// ============================================================================

export const highlightVariants = example({
    keywords: ["Highlight", "Root", "multiple", "terms", "background", "yellow", "fill", "green", "success", "blue", "info", "search", "result", "no matches", "empty", "Reactive", "State", "interactive"],
    description: "Highlight variant panel — multiple terms (highlighting several words), custom color (yellow highlight background), green (success-themed highlight), blue (info-themed highlight), search result (typical search result display), no matches (when query doesn't match), interactive (type a query to live-highlight matching words)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="MULTIPLE TERMS" align="start" />
                <Highlight query={["quick", "fox", "dog"]}>The quick brown fox jumps over the lazy dog</Highlight>
                <Separator label="CUSTOM COLOR" align="start" />
                <Highlight query={["Important"]} background="bg.warning.subtle">Important information here</Highlight>
                <Separator label="GREEN" align="start" />
                <Highlight query={["saved", "successfully"]} background="bg.success.subtle" color="fg.success">Your changes have been saved successfully</Highlight>
                <Separator label="BLUE" align="start" />
                <Highlight query={["submit", "button"]} background="bg.brand.subtle" color="link">Click the submit button to proceed</Highlight>
                <Separator label="SEARCH RESULT" align="start" />
                <Highlight query={["TypeScript", "JavaScript"]} background="bg.warning.subtle">TypeScript is a typed superset of JavaScript that compiles to plain JavaScript</Highlight>
                <Separator label="NO MATCHES" align="start" />
                <Highlight query={["xyz"]}>This text has no highlighted words</Highlight>
                <Separator label="INTERACTIVE" align="start" />
                <Reactive>{$ => {
                    const search = $.let(State.bind([StringType], "highlight_query", "fox"));
                    const term = $.let(search.read());
                    const onChange = $.const(East.function([StringType], NullType, ($, next) => {
                        $(search.write(next));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <Input.String value={term} onChange={onChange} placeholder="Type a word to highlight" />
                            <Highlight query={[term]} background="bg.warning.subtle">The quick brown fox jumps over the lazy dog</Highlight>
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
