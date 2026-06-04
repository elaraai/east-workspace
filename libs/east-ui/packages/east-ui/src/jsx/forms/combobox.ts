/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Form `<Combobox>` tag — searchable dropdown. Maps to `Combobox.Root`. */

import { Combobox as ComboboxFactory, type ComboboxOptions } from "../../forms/combobox/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<Combobox value={…} items={[Combobox.Item(…)]} placeholder="…" />` — searchable type-to-filter dropdown. Maps to `Combobox.Root`. */
export const Combobox: JsxTag<ComboboxOptions> = optionsTag(ComboboxFactory.Root);
