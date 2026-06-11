/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<RadioGroup>` tag — see the export's JSDoc.
 */

import { RadioGroup as RadioGroupFactory, type RadioGroupStyle } from "../../forms/radio-group/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * Single-select radio list — a set of mutually exclusive options shown all at
 * once. Reach for it (over a `<Select>`) when there are only a few choices and
 * seeing them laid out aids the decision. `items` is the `{ value, label,
 * disabled? }` list, `value` the current selection, `orientation` stacks them
 * vertically or in a row, and `onChange` carries the picked value. See
 * {@link RadioGroupStyle}.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { RadioGroup, UIComponentType } from "@elaraai/east-ui";
 *
 * const answer = East.function([], UIComponentType, _$ => (
 *     <RadioGroup
 *         value="yes"
 *         items={[
 *             { value: "yes", label: "Yes" },
 *             { value: "no", label: "No" },
 *             { value: "maybe", label: "Maybe" },
 *         ]}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `RadioGroup.Types`. Bind `value` to a `String` state and wire
 * `onChange` inside a `<Reactive>` block for a live control. Desugars to
 * `RadioGroup.Root(options)`.
 */
export const RadioGroup: JsxTag<RadioGroupStyle> & { Types: typeof RadioGroupFactory.Types } =
    Object.assign(optionsTag(RadioGroupFactory.Root), { Types: RadioGroupFactory.Types });
