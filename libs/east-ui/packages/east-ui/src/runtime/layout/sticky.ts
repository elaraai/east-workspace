/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Layout `<Sticky>` tag — a single sticky-positioned content. Maps to `Sticky.Root`. */

import { Sticky as StickyFactory } from "../../layout/sticky/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<Sticky>` — sticky-positioned wrapper around a single content element. Maps to `Sticky.Root`. */
export const Sticky: JsxTag<ContentProps<typeof StickyFactory.Root>> =
    content(StickyFactory.Root);
