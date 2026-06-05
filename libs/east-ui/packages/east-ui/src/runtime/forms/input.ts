/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Form `<Input.*>` tags — typed text / number / date inputs. Mirrors the
 * `Input` factory namespace so `<Input.String value={…} />` desugars to
 * `Input.String(value, style)`.
 */

import { Input as InputFactory } from "../../forms/input/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * Typed input tags keyed by value type. Each member is a value-leaf tag:
 * `<Input.String value={…} />`, `<Input.Integer value={…} />`,
 * `<Input.Float value={…} />`, `<Input.DateTime value={…} />`.
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
