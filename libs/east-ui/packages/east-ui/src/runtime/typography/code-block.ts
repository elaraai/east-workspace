/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typography `<CodeBlock>` tag — multi-line code block. Maps to `CodeBlock.Root`. */

import { CodeBlock as CodeBlockFactory } from "../../typography/code-block/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<CodeBlock>` — fenced code block; the code string is its single child. Maps to `CodeBlock.Root`. */
export const CodeBlock: JsxTag<ContentProps<typeof CodeBlockFactory.Root>> & { Types: typeof CodeBlockFactory.Types } =
    Object.assign(content(CodeBlockFactory.Root), { Types: CodeBlockFactory.Types });
