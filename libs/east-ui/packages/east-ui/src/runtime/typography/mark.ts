/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typography `<Mark>` tag — highlighted text. Maps to `Mark.Root`. */

import { Mark as MarkFactory } from "../../typography/mark/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<Mark>` — highlighted text. Maps to `Mark.Root`. */
export const Mark: JsxTag<ContentProps<typeof MarkFactory.Root>> & { Types: typeof MarkFactory.Types } =
    Object.assign(content(MarkFactory.Root), { Types: MarkFactory.Types });
