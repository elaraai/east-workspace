/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Typography tag for an inline note — a set-apart block of explanatory
 * prose, an aside, a pull-quote, or a soft callout that lives in the flow
 * of a page. The body may be plain text or richer UI children.
 */

import { Note as NoteFactory } from "../../typography/note/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Note — a set-apart prose block. The body is the children (text or nested
 * components); the `variant` (`narrative`, `callout`, `quote`) chooses the
 * accent treatment and `emphasis` its strength, both flat props
 * ({@link NoteStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Note, UIComponentType } from "@elaraai/east-ui";
 *
 * const callout = East.function([], UIComponentType, _$ => (
 *     <Note variant="callout" emphasis="strong">
 *         Raising this retrains the workforce chain model — expect ~30 min recompute.
 *     </Note>
 * ));
 * ```
 *
 * @remarks
 * Carries `Note.Types` — the East data type and style struct. Desugars to
 * `Note.Root(body, options)`.
 */
export const Note: JsxTag<ContentProps<typeof NoteFactory.Root>> & { Types: typeof NoteFactory.Types } =
    Object.assign(content(NoteFactory.Root), { Types: NoteFactory.Types });
