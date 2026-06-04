/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Overlay `<Tooltip>` tag — hover tip. Tip text is the children. Maps to `Tooltip.Root`. */

import { Tooltip as TooltipFactory } from "../../overlays/tooltip/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<Tooltip trigger={Button.Root("Hover")} placement="top">Helpful tip</Tooltip>` — hover tooltip (tip text is children). Maps to `Tooltip.Root`. */
export const Tooltip: JsxTag<ContentProps<typeof TooltipFactory.Root>> = content(TooltipFactory.Root);
