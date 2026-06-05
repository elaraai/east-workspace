/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Form `<Select>` tag — dropdown selection. Maps to `Select.Root`.
 *
 * The `Item` option builder is attached to the tag, so a single `Select`
 * import gives both `<Select …/>` and `Select.Item(…)` — no separate factory
 * import.
 */

import { Select as SelectFactory, type SelectOptions } from "../../forms/select/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** Option builder + types surfaced on the `<Select>` tag (mirrors the `Select` factory namespace). */
type SelectBuilders = {
    Item: typeof SelectFactory.Item;
    Types: typeof SelectFactory.Types;
};

/** `<Select value={…} items={[Select.Item(…)]} placeholder="…" />` — dropdown selection. Maps to `Select.Root`. */
export const Select: JsxTag<SelectOptions> & SelectBuilders =
    Object.assign(optionsTag(SelectFactory.Root), {
        Item: SelectFactory.Item,
        Types: SelectFactory.Types,
    });
