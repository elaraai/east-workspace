/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typography `<Numeric value={…}>` tag — formatted numeric value. Maps to `Numeric.Root`. */

import { Numeric as NumericFactory } from "../../typography/numeric/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<Numeric value={…}>` — formatted numeric value (set `format`/`sentiment`). Maps to `Numeric.Root`. */
export const Numeric: JsxTag<ValueProps<typeof NumericFactory.Root, "value">> & { Types: typeof NumericFactory.Types } =
    Object.assign(leaf(NumericFactory.Root, "value"), { Types: NumericFactory.Types });
