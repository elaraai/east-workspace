/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Overlay `<ToggleTip>` tag — click-activated tip. Tip text is the children. Maps to `ToggleTip.Root`. */

import { ToggleTip as ToggleTipFactory } from "../../overlays/toggle-tip/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<ToggleTip trigger={IconButton.Root(…)}>Info text</ToggleTip>` — click-activated tip (text is children). Maps to `ToggleTip.Root`. */
export const ToggleTip: JsxTag<ContentProps<typeof ToggleTipFactory.Root>> = content(ToggleTipFactory.Root);
