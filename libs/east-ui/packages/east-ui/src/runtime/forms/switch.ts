/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Form `<Switch checked={…}>` tag — on/off switch. Maps to `Switch.Root`. */

import { Switch as SwitchFactory } from "../../forms/switch/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<Switch checked={…}>` — on/off switch. Maps to `Switch.Root`. */
export const Switch: JsxTag<ValueProps<typeof SwitchFactory.Root, "checked">> & { Types: typeof SwitchFactory.Types } =
    Object.assign(leaf(SwitchFactory.Root, "checked"), { Types: SwitchFactory.Types });
