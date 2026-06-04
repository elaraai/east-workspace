/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Button `<Toggle>` tag — pressable toggle; the label is its child. Maps to `Toggle.Root`. */

import { Toggle as ToggleFactory, type ToggleOptions } from "../../buttons/toggle/index.js";
import { content, type JsxTag } from "../combinators.js";

/** `<Toggle pressed={on} onChange={set} variant="outline">Bold</Toggle>` — pressable toggle. Maps to `Toggle.Root`. */
export const Toggle: JsxTag<ToggleOptions & { children: Parameters<typeof ToggleFactory.Root>[0] }> =
    content(ToggleFactory.Root);
