/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<TagsInput>` tag — see the export's JSDoc.
 */

import { TagsInput as TagsInputFactory } from "../../forms/tags-input/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * Token / tag entry field — type a value and press Enter to commit it as a chip,
 * building up a list of strings. Reach for it for free-form multi-value entry
 * (technologies, keywords, recipients) where each entry is removable. Supports a
 * `label`, `placeholder` and a `max` count. The string list is the `value` prop;
 * `onChange` carries the full updated array and `onInputChange` the in-progress
 * keystrokes.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { TagsInput, UIComponentType } from "@elaraai/east-ui";
 *
 * const tech = East.function([], UIComponentType, _$ => (
 *     <TagsInput value={["react", "typescript"]} label="Technologies" placeholder="Add tag..." max={5} />
 * ));
 * ```
 *
 * @remarks
 * Carries `TagsInput.Types`. Bind `value` to an `Array<String>` state and wire
 * `onChange` inside a `<Reactive>` block for a live editor. Desugars to
 * `TagsInput.Root(value, style)`.
 */
export const TagsInput: JsxTag<ValueProps<typeof TagsInputFactory.Root, "value">> & { Types: typeof TagsInputFactory.Types } =
    Object.assign(leaf(TagsInputFactory.Root, "value"), { Types: TagsInputFactory.Types });
