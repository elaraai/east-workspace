/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, ArrayType, NullType, OptionType, StringType, example, none } from "@elaraai/east";
import { Badge, Reactive, Stack, State, TagsInput, Text, UIComponentType } from "@elaraai/east-ui";

export const tagsInputBasic = example({
    keywords: ["TagsInput", "Root", "label", "placeholder", "max", "colorPalette"],
    description: "Multi-tag entry control",
    fn: East.function([], UIComponentType, (_$) => {
        return TagsInput.Root(["react", "typescript"], {
            label: "Technologies",
            placeholder: "Add tag...",
            max: 5,
            colorPalette: "blue",
        });
    }),
    inputs: [],
});

export const tagsInputInteractive = example({
    keywords: ["TagsInput", "Root", "Reactive", "State", "onChange", "interactive"],
    description: "Add/remove tags to see onChange callback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const tagsBind = $.let(State.bind([ArrayType(StringType)], "form_tags", ["initial"]));
            const tags = $.let(tagsBind.read());
            const onChange = $.const(East.function([ArrayType(StringType)], NullType, ($, newValue) => {
                $(tagsBind.write(newValue));
            }));

            return Stack.VStack([
                TagsInput.Root(tags, {
                    placeholder: "Add tag...",
                    colorPalette: "purple",
                    onChange,
                }),
                Badge.Root(East.str`${tags.size()} tags`, { colorPalette: "purple" }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const tagsInputOnInputChange = example({
    keywords: ["TagsInput", "Root", "Reactive", "State", "onInputChange", "interactive"],
    description: "TagsInput whose onInputChange records every keystroke before commit",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const inputBind = $.let(State.bind([StringType], "tags_inputvalue", ""));
            const last = $.let(inputBind.read());
            const onInputChange = $.const(East.function([StringType], NullType, ($, val) => {
                $(inputBind.write(val));
            }));
            return Stack.VStack([
                TagsInput.Root([], {
                    placeholder: "Type, then press Enter…",
                    onInputChange,
                }),
                Text.Root(East.str`Last typed: ${last}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const tagsInputOnHighlightChange = example({
    keywords: ["TagsInput", "Root", "Reactive", "State", "onHighlightChange", "interactive"],
    description: "TagsInput whose onHighlightChange records the current highlighted tag",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const hiBind = $.let(State.bind([OptionType(StringType)], "tags_highlight", none));
            const hi = $.let(hiBind.read());
            const onHighlightChange = $.const(East.function([OptionType(StringType)], NullType, ($, val) => {
                $(hiBind.write(val));
            }));
            return Stack.VStack([
                TagsInput.Root(["alpha", "beta", "gamma"], {
                    placeholder: "Use arrow keys to highlight…",
                    colorPalette: "teal",
                    onHighlightChange,
                }),
                Text.Root(East.str`Highlighted: ${hi.match({
                    none: _$ => "(none)",
                    some: ($, v) => v,
                })}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
