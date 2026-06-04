/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typography `<Code>` tag — inline code text. Maps to `Code.Root`. */

import { Code as CodeFactory } from "../../typography/code/index.js";
import { textLeaf, type TextProps, type JsxTag } from "../combinators.js";

/** `<Code>` — inline code text. Maps to `Code.Root`. */
export const Code: JsxTag<TextProps<typeof CodeFactory.Root>> = textLeaf(CodeFactory.Root);
