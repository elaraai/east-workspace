/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Combobox>` tag — see the export's JSDoc.
 */

import { Combobox as ComboboxFactory, type ComboboxOptions } from "../../forms/combobox/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** Option builder + types surfaced on the `<Combobox>` tag (mirrors the `Combobox` factory namespace). */
type ComboboxBuilders = {
    Item: typeof ComboboxFactory.Item;
    Types: typeof ComboboxFactory.Types;
};

/**
 * Searchable dropdown — like {@link Select}, but the user types to filter the
 * options as they go. Reach for it when the list is long enough that scanning is
 * slow (countries, frameworks, tags). `items` is a list of `Combobox.Item(value,
 * label)` options, `value` the current selection, and `placeholder` the search
 * hint. Set `allowCustomValue` to accept entries not in the list, or `multiple`
 * for multi-select (driving `onChangeMultiple`); single-select uses `onChange`.
 * See {@link ComboboxOptions}.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Combobox, UIComponentType } from "@elaraai/east-ui";
 *
 * const country = East.function([], UIComponentType, _$ => (
 *     <Combobox
 *         value=""
 *         items={[
 *             Combobox.Item("us", "United States"),
 *             Combobox.Item("uk", "United Kingdom"),
 *             Combobox.Item("ca", "Canada"),
 *         ]}
 *         placeholder="Search countries..."
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `Combobox.Types` and the `Combobox.Item(value, label, options?)` option
 * builder. Bind `value` to state and wire `onChange` / `onChangeMultiple` inside a
 * `<Reactive>` block. Desugars to `Combobox.Root(options)`.
 */
export const Combobox: JsxTag<ComboboxOptions> & ComboboxBuilders =
    Object.assign(optionsTag(ComboboxFactory.Root), {
        Item: ComboboxFactory.Item,
        Types: ComboboxFactory.Types,
    });
