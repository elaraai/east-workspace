/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, NullType, OptionType, StringType, example, none } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { TagsInput, Text, VStack, Reactive } from "@elaraai/east-ui";

export const tagsInputBasic = example({
    keywords: ["TagsInput", "Root", "label", "placeholder", "max"],
    description: "Multi-tag entry control",
    fn: East.function([], UIComponentType, (_$) => {
        return <TagsInput value={["react", "typescript"]} label="Technologies" placeholder="Add tag..." max={5} />;
    }),
    inputs: [],
});

export const tagsInputInteractive = example({
    keywords: ["TagsInput", "Root", "Reactive", "State", "onChange", "interactive"],
    description: "Add/remove tags to see onChange callback",
    fn: East.function([], UIComponentType, (_$) => (
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
    )),
    inputs: [],
});

export const tagsInputOnInputChange = example({
    keywords: ["TagsInput", "Root", "Reactive", "State", "onInputChange", "interactive"],
    description: "TagsInput whose onInputChange records every keystroke before commit",
    fn: East.function([], UIComponentType, (_$) => (
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
    )),
    inputs: [],
});

export const tagsInputOnHighlightChange = example({
    keywords: ["TagsInput", "Root", "Reactive", "State", "onHighlightChange", "interactive"],
    description: "TagsInput whose onHighlightChange records the current highlighted tag",
    fn: East.function([], UIComponentType, (_$) => (
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
    )),
    inputs: [],
});
