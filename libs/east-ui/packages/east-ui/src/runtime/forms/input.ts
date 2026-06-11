/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Input.*>` namespace tags — see the export's JSDoc.
 */

import { Input as InputFactory } from "../../forms/input/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * Single-line typed input — the value's East type picks the member, which in turn
 * picks the right keyboard, validation and value shape. Reach for the one that
 * matches the data:
 *
 * - `<Input.String>` — plain text entry; supports `placeholder`, `variant`, `size`.
 * - `<Input.Integer>` — whole-number entry with stepper; supports `min`, `max`, `step`.
 * - `<Input.Float>` — decimal entry; adds `precision` on top of the numeric options.
 * - `<Input.DateTime>` — date / time picker; `precision` chooses date-only vs date+time.
 *
 * Every member takes the current value as the `value` prop and the typed
 * `onChange` (plus `onFocus` / `onBlur`) callbacks.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Input, UIComponentType } from "@elaraai/east-ui";
 *
 * const name = East.function([], UIComponentType, _$ => (
 *     <Input.String value="" placeholder="Enter your name" variant="outline" />
 * ));
 * ```
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Input, UIComponentType } from "@elaraai/east-ui";
 *
 * const qty = East.function([], UIComponentType, _$ => (
 *     <Input.Integer value={0n} min={0n} max={100n} step={1n} />
 * ));
 * ```
 *
 * @remarks
 * Carries `Input.Types`. Bind `value` to a state of the matching type and wire the
 * typed `onChange` inside a `<Reactive>` block for a live field. Each member
 * desugars to `Input.<Member>(value, style)`.
 */
export const Input: {
    String: JsxTag<ValueProps<typeof InputFactory.String, "value">>;
    Integer: JsxTag<ValueProps<typeof InputFactory.Integer, "value">>;
    Float: JsxTag<ValueProps<typeof InputFactory.Float, "value">>;
    DateTime: JsxTag<ValueProps<typeof InputFactory.DateTime, "value">>;
    Types: typeof InputFactory.Types;
} = {
    String: leaf(InputFactory.String, "value"),
    Integer: leaf(InputFactory.Integer, "value"),
    Float: leaf(InputFactory.Float, "value"),
    DateTime: leaf(InputFactory.DateTime, "value"),
    Types: InputFactory.Types,
};
