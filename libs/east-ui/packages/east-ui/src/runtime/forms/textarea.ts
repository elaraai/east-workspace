/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Textarea>` tag — see the export's JSDoc.
 */

import { Textarea as TextareaFactory } from "../../forms/textarea/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * Multi-line text input — a resizable box for longer free text (messages,
 * descriptions, notes). Reach for it over `<Input.String>` whenever the answer
 * may wrap across lines. Supports `rows`, a `resize` mode and a `placeholder`.
 * The string is the `value` prop; `onChange` carries each edit, `onFocus` /
 * `onBlur` the focus transitions.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Textarea, UIComponentType } from "@elaraai/east-ui";
 *
 * const message = East.function([], UIComponentType, _$ => (
 *     <Textarea value="" placeholder="Enter your message..." rows={4} resize="vertical" />
 * ));
 * ```
 *
 * @remarks
 * Carries `Textarea.Types`. Bind `value` to a `String` state and wire `onChange`
 * inside a `<Reactive>` block for a live editor. Desugars to
 * `Textarea.Root(value, style)`.
 */
export const Textarea: JsxTag<ValueProps<typeof TextareaFactory.Root, "value">> & { Types: typeof TextareaFactory.Types } =
    Object.assign(leaf(TextareaFactory.Root, "value"), { Types: TextareaFactory.Types });
