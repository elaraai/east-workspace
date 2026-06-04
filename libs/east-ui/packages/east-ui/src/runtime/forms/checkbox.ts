/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Form `<Checkbox checked={…}>` tag — boolean toggle. Maps to `Checkbox.Root`. */

import { Checkbox as CheckboxFactory } from "../../forms/checkbox/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<Checkbox checked={…}>` — boolean toggle. Maps to `Checkbox.Root`. */
export const Checkbox: JsxTag<ValueProps<typeof CheckboxFactory.Root, "checked">> =
    leaf(CheckboxFactory.Root, "checked");
