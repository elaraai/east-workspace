/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Highlight, Input, Reactive, Text, VStack } from "@elaraai/east-ui";

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
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">MULTIPLE TERMS</Text>
                    <Highlight query={["quick", "fox", "dog"]}>The quick brown fox jumps over the lazy dog</Highlight>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">CUSTOM COLOR</Text>
                    <Highlight query={["Important"]} background="yellow.200">Important information here</Highlight>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">GREEN</Text>
                    <Highlight query={["saved", "successfully"]} background="green.100" color="green.900">Your changes have been saved successfully</Highlight>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">BLUE</Text>
                    <Highlight query={["submit", "button"]} background="blue.100" color="blue.900">Click the submit button to proceed</Highlight>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SEARCH RESULT</Text>
                    <Highlight query={["TypeScript", "JavaScript"]} background="yellow.200">TypeScript is a typed superset of JavaScript that compiles to plain JavaScript</Highlight>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">NO MATCHES</Text>
                    <Highlight query={["xyz"]}>This text has no highlighted words</Highlight>
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">INTERACTIVE</Text>
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
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
