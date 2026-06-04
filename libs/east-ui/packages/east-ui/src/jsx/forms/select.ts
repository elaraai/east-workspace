/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Form `<Select>` tag — dropdown selection. Maps to `Select.Root`. */

import { Select as SelectFactory, type SelectOptions } from "../../forms/select/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<Select value={…} items={[Select.Item(…)]} placeholder="…" />` — dropdown selection. Maps to `Select.Root`. */
export const Select: JsxTag<SelectOptions> = optionsTag(SelectFactory.Root);
