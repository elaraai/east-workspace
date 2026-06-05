/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Layout `<ScrollArea>` tag — a single scrollable content. Maps to `ScrollArea.Root`. */

import { ScrollArea as ScrollAreaFactory } from "../../layout/scroll-area/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<ScrollArea>` — scroll container around a single content element. Maps to `ScrollArea.Root`. */
export const ScrollArea: JsxTag<ContentProps<typeof ScrollAreaFactory.Root>> & { Types: typeof ScrollAreaFactory.Types } =
    Object.assign(content(ScrollAreaFactory.Root), { Types: ScrollAreaFactory.Types });
