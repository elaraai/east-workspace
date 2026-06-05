/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typography `<Highlight query={…}>` tag — highlight matching terms; the text is its child. Maps to `Highlight.Root`. */

import { Highlight as HighlightFactory } from "../../typography/highlight/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<Highlight query={…}>` — highlight matching terms (required `query`); the text is its child. Maps to `Highlight.Root`. */
export const Highlight: JsxTag<ContentProps<typeof HighlightFactory.Root>> & { Types: typeof HighlightFactory.Types } =
    Object.assign(content(HighlightFactory.Root), { Types: HighlightFactory.Types });
