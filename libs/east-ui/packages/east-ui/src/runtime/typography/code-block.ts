/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Typography tag for a fenced, multi-line code block — a self-contained
 * source listing with optional syntax highlighting, line numbers, line
 * emphasis, and a scroll cap. For a short inline span use `<Code>`.
 */

import { CodeBlock as CodeBlockFactory } from "../../typography/code-block/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Fenced code block — a multi-line source listing. The code string is the
 * single child; set `language` for syntax highlighting, `showLineNumbers`,
 * `highlightLines` to emphasise rows, `title`, and `maxHeight` to make it
 * scrollable, all via flat props ({@link CodeBlockStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { CodeBlock, UIComponentType } from "@elaraai/east-ui";
 *
 * const listing = East.function([], UIComponentType, _$ => (
 *     <CodeBlock language="typescript" showLineNumbers highlightLines={[4n]}>
 *         {"function calculate() {\n\tconst a = 10;\n\tconst b = 20;\n\treturn a + b;\n}"}
 *     </CodeBlock>
 * ));
 * ```
 *
 * @remarks
 * Carries `CodeBlock.Types` — the East data type and style struct.
 * Desugars to `CodeBlock.Root(code, options)`.
 */
export const CodeBlock: JsxTag<ContentProps<typeof CodeBlockFactory.Root>> & { Types: typeof CodeBlockFactory.Types } =
    Object.assign(content(CodeBlockFactory.Root), { Types: CodeBlockFactory.Types });
