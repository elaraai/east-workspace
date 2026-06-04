/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Display `<Tag>` tag — keyword/chip. Maps to `Tag.Root`. */

import { Tag as TagFactory } from "../../display/tag/index.js";
import { textLeaf, type TextProps, type JsxTag } from "../combinators.js";

/** `<Tag>` — keyword/chip with optional close affordance. Maps to `Tag.Root`. */
export const Tag: JsxTag<TextProps<typeof TagFactory.Root>> = textLeaf(TagFactory.Root);
