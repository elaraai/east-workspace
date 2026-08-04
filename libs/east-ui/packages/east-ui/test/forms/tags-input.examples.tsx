/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, NullType, OptionType, StringType, example, none } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { TagsInput, Text, VStack, Reactive } from "@elaraai/east-ui";

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
// Suggestions — autocomplete + the full event contract on one bound input
// ============================================================================

export const tagsInputSuggestions = example({
    keywords: ["TagsInput", "Root", "suggestions", "autocomplete", "hints", "datalist", "Reactive", "State", "onChange", "interactive", "onInputChange", "onHighlightChange"],
    description: "Suggestions plus the full event contract on one bound TagsInput — autocomplete as you type, onChange commits the tags, onInputChange records every keystroke, onHighlightChange tracks the highlighted tag",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const tagsBind = $.let(State.bind([ArrayType(StringType)], "form_tags", ["NA"]));
            const inputBind = $.let(State.bind([StringType], "tags_inputvalue", ""));
            const hiBind = $.let(State.bind([OptionType(StringType)], "tags_highlight", none));
            const tags = $.let(tagsBind.read());
            const last = $.let(inputBind.read());
            const hi = $.let(hiBind.read());
            const onChange = $.const(East.function([ArrayType(StringType)], NullType, ($, newValue) => {
                $(tagsBind.write(newValue));
            }));
            const onInputChange = $.const(East.function([StringType], NullType, ($, val) => {
                $(inputBind.write(val));
            }));
            const onHighlightChange = $.const(East.function([OptionType(StringType)], NullType, ($, val) => {
                $(hiBind.write(val));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <TagsInput
                        value={tags}
                        label="Regions"
                        placeholder="Add region..."
                        suggestions={["NA", "EU", "APAC", "LATAM"]}
                        onChange={onChange}
                        onInputChange={onInputChange}
                        onHighlightChange={onHighlightChange}
                    />
                    {<Text.MonoLabel>{East.str`${tags.size()} TAGS`}</Text.MonoLabel>}
                    <Text>{East.str`Last typed: ${last}`}</Text>
                    <Text>{East.str`Highlighted: ${hi.match({ none: _$ => "(none)", some: ($, v) => v })}`}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
