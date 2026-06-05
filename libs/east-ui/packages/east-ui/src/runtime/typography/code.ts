/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Typography tag for inline code — a short span of monospaced text set
 * inside a sentence: a command, identifier, file path, or literal value.
 * For multi-line, fenced source use `<CodeBlock>` instead.
 */

import { Code as CodeFactory } from "../../typography/code/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Inline code — a monospaced run for commands, identifiers, and literals
 * embedded in prose. The code string is the child; pick a `variant`
 * (`subtle`, `surface`, `outline`), `size`, and `colorPalette` via flat
 * props ({@link CodeStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Code, UIComponentType } from "@elaraai/east-ui";
 *
 * const cmd = East.function([], UIComponentType, _$ => (
 *     <Code variant="subtle" colorPalette="blue">npm install</Code>
 * ));
 * ```
 *
 * @remarks
 * Carries `Code.Types` — the East data type and style struct. Desugars to
 * `Code.Root(code, options)`.
 */
export const Code: JsxTag<ContentProps<typeof CodeFactory.Root>> & { Types: typeof CodeFactory.Types } =
    Object.assign(content(CodeFactory.Root), { Types: CodeFactory.Types });
