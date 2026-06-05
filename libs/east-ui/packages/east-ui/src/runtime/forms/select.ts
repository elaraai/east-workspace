/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Select>` tag — see the export's JSDoc.
 */

import { Select as SelectFactory, type SelectOptions } from "../../forms/select/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** Option builder + types surfaced on the `<Select>` tag (mirrors the `Select` factory namespace). */
type SelectBuilders = {
    Item: typeof SelectFactory.Item;
    Types: typeof SelectFactory.Types;
};

/**
 * Dropdown selection — a compact control that reveals its options on click.
 * Reach for it when the choices are many enough that a radio list would crowd the
 * layout. `items` is a list of `Select.Item(value, label)` options, `value` the
 * current selection, and `placeholder` the empty-state text. Set `multiple` for
 * multi-select, in which case `onChangeMultiple` carries the chosen array; the
 * single-select `onChange` carries one value. See {@link SelectOptions}.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Select, UIComponentType } from "@elaraai/east-ui";
 *
 * const country = East.function([], UIComponentType, _$ => (
 *     <Select
 *         value=""
 *         items={[
 *             Select.Item("us", "United States"),
 *             Select.Item("uk", "United Kingdom"),
 *             Select.Item("ca", "Canada"),
 *         ]}
 *         placeholder="Select a country"
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `Select.Types` and the `Select.Item(value, label)` option builder. Bind
 * `value` to state and wire `onChange` / `onChangeMultiple` inside a `<Reactive>`
 * block. Desugars to `Select.Root(options)`.
 */
export const Select: JsxTag<SelectOptions> & SelectBuilders =
    Object.assign(optionsTag(SelectFactory.Root), {
        Item: SelectFactory.Item,
        Types: SelectFactory.Types,
    });
