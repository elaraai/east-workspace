/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Typography tag that emphasises matching terms inside a run of text —
 * for search-result snippets and live find-as-you-type, where the words
 * in `query` are visually marked wherever they appear in the body.
 */

import { Highlight as HighlightFactory } from "../../typography/highlight/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Highlight — marks every occurrence of the `query` terms within its body
 * text. The full text is the child; `query` (an array of terms) is
 * required, and the mark colours come from flat props ({@link HighlightStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Highlight, UIComponentType } from "@elaraai/east-ui";
 *
 * const snippet = East.function([], UIComponentType, _$ => (
 *     <Highlight query={["TypeScript", "JavaScript"]} background="yellow.200">
 *         TypeScript is a typed superset of JavaScript
 *     </Highlight>
 * ));
 * ```
 *
 * @remarks
 * Carries `Highlight.Types` — the East data type and style struct.
 * Desugars to `Highlight.Root(text, options)`.
 */
export const Highlight: JsxTag<ContentProps<typeof HighlightFactory.Root>> & { Types: typeof HighlightFactory.Types } =
    Object.assign(content(HighlightFactory.Root), { Types: HighlightFactory.Types });
