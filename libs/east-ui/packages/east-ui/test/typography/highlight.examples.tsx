/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, NullType, StringType, StructType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, Highlight, Input, SegmentGroup, Text, VStack, Reactive } from "@elaraai/east-ui";

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
// Highlight — live configurator over every highlight axis
// ============================================================================

export const highlightVariants = example({
    keywords: ["Highlight", "Root", "multiple", "terms", "background", "yellow", "fill", "green", "success", "blue", "info", "search", "result", "no matches", "empty", "Reactive", "State", "interactive", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Highlight configurator — terms-preset and colour axes driving one live passage; the aside re-highlights from a typed Input.String query, reaching the no-match state",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Only the axes need structs here — a terms preset is a passage
                // PLUS the query that belongs to it, and a colour is a
                // background / foreground pair, so neither has a single value
                // to name it by.
                const passages = $.const([
                    { label: "fox",    text: "The quick brown fox jumps over the lazy dog", terms: ["quick", "fox", "dog"] },
                    { label: "search", text: "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript", terms: ["TypeScript", "JavaScript"] },
                    { label: "saved",  text: "Your changes have been saved successfully", terms: ["saved", "successfully"] },
                    { label: "submit", text: "Click the submit button to proceed", terms: ["submit", "button"] },
                ], ArrayType(StructType({ label: StringType, text: StringType, terms: ArrayType(StringType) })));

                const colours = $.const([
                    { label: "native",  bg: "", fg: "" },
                    { label: "warning", bg: "bg.warning.subtle", fg: "fg.default" },
                    { label: "success", bg: "bg.success.subtle", fg: "fg.success" },
                    { label: "brand",   bg: "bg.brand.subtle",   fg: "link" },
                ], ArrayType(StructType({ label: StringType, bg: StringType, fg: StringType })));

                const termsBind  = $.let(State.bind([StringType], "highlight_terms", "fox"));
                const colourBind = $.let(State.bind([StringType], "highlight_color", "warning"));
                const search     = $.let(State.bind([StringType], "highlight_query", "fox"));

                const tKey = $.let(termsBind.read());
                const cKey = $.let(colourBind.read());
                const term = $.let(search.read());

                const onTerms  = $.const(East.function([StringType], NullType, ($, next) => { $(termsBind.write(next)); }));
                const onColour = $.const(East.function([StringType], NullType, ($, next) => { $(colourBind.write(next)); }));
                const onQuery  = $.const(East.function([StringType], NullType, ($, next) => { $(search.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const passage = $.let(passages.filter((_$, o) => o.label.equal(tKey)).get(0n));
                const colour = $.let(colours.filter((_$, o) => o.label.equal(cKey)).get(0n));

                // Native colouring is the absence of the colour props, not a
                // value of them — so the axis picks between the two highlights
                // rather than feeding empty tokens in.
                const highlight = $.const(colour.label.equal("native").ifElse(
                    _$ => <Highlight query={passage.terms}>{passage.text}</Highlight>,
                    _$ => <Highlight query={passage.terms} background={colour.bg} color={colour.fg}>{passage.text}</Highlight>,
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Terms", tKey,
                                <SegmentGroup value={tKey} onChange={onTerms} size="sm"
                                    items={passages.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />,
                                "passage · query follow the preset"),
                            Configurator.Control("Colour", cKey,
                                <SegmentGroup value={cKey} onChange={onColour} size="sm"
                                    items={colours.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />,
                                "native uses the default mark tint"),
                        ]}
                        preview={highlight}
                        aside={{
                            label: "Live query · Reactive",
                            body: (
                                <VStack gap="3" align="stretch">
                                    <Input.String value={term} onChange={onQuery} placeholder="Type a word to highlight" />
                                    <Highlight query={[term]} background="bg.warning.subtle">The quick brown fox jumps over the lazy dog</Highlight>
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Terms", East.print(passage.terms.size())),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
