/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Overlay `<ActionBar>` tag — selection action bar. Maps to `ActionBar.Root`. */

import { ActionBar as ActionBarFactory } from "../../overlays/action-bar/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<ActionBar items={[ActionBar.Action(…)]} />` — contextual selection action bar. Maps to `ActionBar.Root`. */
export const ActionBar: JsxTag<ValueProps<typeof ActionBarFactory.Root, "items">> =
    leaf(ActionBarFactory.Root, "items");
