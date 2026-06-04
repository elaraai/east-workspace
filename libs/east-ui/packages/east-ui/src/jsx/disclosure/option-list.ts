/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Disclosure `<OptionList>` tag — selectable option list. Maps to `OptionList.Root`. */

import { OptionList as OptionListFactory } from "../../disclosure/option-list/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<OptionList options={[OptionList.Option(…)]} selectedId="alt-1" onSelect={…} />` — selectable option list. Maps to `OptionList.Root`. */
export const OptionList: JsxTag<ValueProps<typeof OptionListFactory.Root, "options">> =
    leaf(OptionListFactory.Root, "options");
