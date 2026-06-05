/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Typography tag for marked text — a short inline run given a coloured
 * fill or tint to call it out: a status word, a "NEW" flag, a deprecated
 * term. For matching search terms in a longer body, reach for `<Highlight>`.
 */

import { Mark as MarkFactory } from "../../typography/mark/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Mark — an inline run set apart with a coloured background or tint. The
 * marked text is the child; pick a `variant` (`subtle`, `solid`, `text`,
 * `plain`) and `colorPalette` via flat props ({@link MarkStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Mark, UIComponentType } from "@elaraai/east-ui";
 *
 * const flag = East.function([], UIComponentType, _$ => (
 *     <Mark variant="solid" colorPalette="green">NEW</Mark>
 * ));
 * ```
 *
 * @remarks
 * Carries `Mark.Types` — the East data type and style struct. Desugars to
 * `Mark.Root(text, options)`.
 */
export const Mark: JsxTag<ContentProps<typeof MarkFactory.Root>> & { Types: typeof MarkFactory.Types } =
    Object.assign(content(MarkFactory.Root), { Types: MarkFactory.Types });
