/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Checkbox>` tag — see the export's JSDoc.
 */

import { Checkbox as CheckboxFactory } from "../../forms/checkbox/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * Boolean selection control — a labelled checkbox for opt-in / accept / toggle
 * choices. Reach for it when a single true/false answer needs an explicit tick;
 * supports an indeterminate (partial) state, a disabled state and three sizes.
 * The boolean is the `checked` prop; the visible text is `label`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Checkbox, UIComponentType } from "@elaraai/east-ui";
 *
 * const terms = East.function([], UIComponentType, _$ => (
 *     <Checkbox checked={false} label="Accept terms" />
 * ));
 * ```
 *
 * @remarks
 * Carries `Checkbox.Types`. Bind `checked` to state and wire `onChange` inside a
 * `<Reactive>` block for a live control. Desugars to `Checkbox.Root(checked, style)`.
 */
export const Checkbox: JsxTag<ValueProps<typeof CheckboxFactory.Root, "checked">> & { Types: typeof CheckboxFactory.Types } =
    Object.assign(leaf(CheckboxFactory.Root, "checked"), { Types: CheckboxFactory.Types });
