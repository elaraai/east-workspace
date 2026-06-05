/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Disclosure `<OptionList>` tag — selectable option list. Maps to
 * `OptionList.Root`.
 *
 * The `Option` builder is attached to the tag, so a single `OptionList`
 * import gives both `<OptionList …/>` and `OptionList.Option(…)` — no
 * separate factory import.
 */

import { OptionList as OptionListFactory } from "../../disclosure/option-list/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** Option builder surfaced on the `<OptionList>` tag (mirrors the `OptionList` factory namespace). */
type OptionListBuilders = {
    Option: typeof OptionListFactory.Option;
    Types: typeof OptionListFactory.Types;
};

/** `<OptionList options={[OptionList.Option(…)]} selectedId="alt-1" onSelect={…} />` — selectable option list. Maps to `OptionList.Root`. */
export const OptionList: JsxTag<ValueProps<typeof OptionListFactory.Root, "options">> & OptionListBuilders =
    Object.assign(leaf(OptionListFactory.Root, "options"), {
        Option: OptionListFactory.Option,
        Types: OptionListFactory.Types,
    });
