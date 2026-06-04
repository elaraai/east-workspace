/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Display `<Kbd keys={…}>` tag — keyboard shortcut. Maps to `Kbd.Root`. */

import { Kbd as KbdFactory } from "../../display/kbd/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<Kbd keys={["⌘","K"]}>` — keyboard-key cluster. Maps to `Kbd.Root`. */
export const Kbd: JsxTag<ValueProps<typeof KbdFactory.Root, "keys">> =
    leaf(KbdFactory.Root, "keys");
