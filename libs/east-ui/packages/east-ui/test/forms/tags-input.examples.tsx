/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, NullType, OptionType, StringType, example, none } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Separator, TagsInput, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const tagsInputBasic = example({
    keywords: ["TagsInput", "Root", "label", "placeholder", "max"],
    description: "Multi-tag entry control",
    fn: East.function([], UIComponentType, (_$) => {
        return <TagsInput value={["react", "typescript"]} label="Technologies" placeholder="Add tag..." max={5} />;
    }),
    inputs: [],
});

// ============================================================================
// Suggestions — the autocomplete contract
// ============================================================================

export const tagsInputSuggestions = example({
    keywords: ["TagsInput", "Root", "suggestions", "autocomplete", "hints", "datalist"],
    description: "Autocomplete suggestions surfaced as you type (free entry still allowed)",
    fn: East.function([], UIComponentType, (_$) => {
        return <TagsInput value={["NA"]} label="Regions" placeholder="Add region..." suggestions={["NA", "EU", "APAC", "LATAM"]} />;
    }),
    inputs: [],
});

// ============================================================================
// TagsInput — onChange + onInputChange + onHighlightChange logs (events panel)
// ============================================================================

export const tagsInputEvents = example({
    keywords: ["TagsInput", "Root", "Reactive", "State", "onChange", "interactive", "onInputChange", "onHighlightChange"],
    description: "TagsInput events panel — input interactive (add/remove tags to see onChange callback), input on input change (TagsInput whose onInputChange records every keystroke before commit), input on highlight change (TagsInput whose onHighlightChange records the current highlighted tag)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="INPUT INTERACTIVE" align="start" />
                <Reactive>{$ => {
                    const tagsBind = $.let(State.bind([ArrayType(StringType)], "form_tags", ["initial"]));
                    const tags = $.let(tagsBind.read());
                    const onChange = $.const(East.function([ArrayType(StringType)], NullType, ($, newValue) => {
                        $(tagsBind.write(newValue));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <TagsInput value={tags} placeholder="Add tag..." onChange={onChange} />
                            {<Text.MonoLabel>{East.str`${tags.size()} TAGS`}</Text.MonoLabel>}
                        </VStack>
                    );
                }}</Reactive>
                <Separator label="INPUT ON INPUT CHANGE" align="start" />
                <Reactive>{$ => {
                    const inputBind = $.let(State.bind([StringType], "tags_inputvalue", ""));
                    const last = $.let(inputBind.read());
                    const onInputChange = $.const(East.function([StringType], NullType, ($, val) => {
                        $(inputBind.write(val));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <TagsInput value={[]} placeholder="Type, then press Enter…" onInputChange={onInputChange} />
                            <Text>{East.str`Last typed: ${last}`}</Text>
                        </VStack>
                    );
                }}</Reactive>
                <Separator label="INPUT ON HIGHLIGHT CHANGE" align="start" />
                <Reactive>{$ => {
                    const hiBind = $.let(State.bind([OptionType(StringType)], "tags_highlight", none));
                    const hi = $.let(hiBind.read());
                    const onHighlightChange = $.const(East.function([OptionType(StringType)], NullType, ($, val) => {
                        $(hiBind.write(val));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <TagsInput value={["alpha", "beta", "gamma"]} placeholder="Use arrow keys to highlight…" onHighlightChange={onHighlightChange} />
                            <Text>{East.str`Highlighted: ${hi.match({ none: _$ => "(none)", some: ($, v) => v })}`}</Text>
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
