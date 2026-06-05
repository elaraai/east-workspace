/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Form `<TagsInput value={…}>` tag — multi-tag entry. Maps to `TagsInput.Root`. */

import { TagsInput as TagsInputFactory } from "../../forms/tags-input/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<TagsInput value={…}>` — token / tag entry field. Maps to `TagsInput.Root`. */
export const TagsInput: JsxTag<ValueProps<typeof TagsInputFactory.Root, "value">> & { Types: typeof TagsInputFactory.Types } =
    Object.assign(leaf(TagsInputFactory.Root, "value"), { Types: TagsInputFactory.Types });
