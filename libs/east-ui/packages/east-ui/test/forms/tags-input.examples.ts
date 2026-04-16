/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { East, ArrayType, NullType, StringType, example } from "@elaraai/east";
import { Badge, Reactive, Stack, State, TagsInput, UIComponentType } from "../../src/index.js";

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
