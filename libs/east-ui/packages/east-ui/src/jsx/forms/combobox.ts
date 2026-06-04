/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Form `<Combobox>` tag — searchable dropdown. Maps to `Combobox.Root`.
 *
 * The `Item` option builder is attached to the tag, so a single `Combobox`
 * import gives both `<Combobox …/>` and `Combobox.Item(…)` — no separate
 * factory import.
 */

import { Combobox as ComboboxFactory, type ComboboxOptions } from "../../forms/combobox/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** Option builder surfaced on the `<Combobox>` tag (mirrors the `Combobox` factory namespace). */
type ComboboxBuilders = {
    Item: typeof ComboboxFactory.Item;
};

/** `<Combobox value={…} items={[Combobox.Item(…)]} placeholder="…" />` — searchable type-to-filter dropdown. Maps to `Combobox.Root`. */
export const Combobox: JsxTag<ComboboxOptions> & ComboboxBuilders =
    Object.assign(optionsTag(ComboboxFactory.Root), {
        Item: ComboboxFactory.Item,
    });
