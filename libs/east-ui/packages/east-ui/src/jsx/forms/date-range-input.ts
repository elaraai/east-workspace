/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Form `<DateRangeInput>` tag — paired start / end date fields. Maps to `DateRangeInput.Root`. */

import { DateRangeInput as DateRangeInputFactory, type DateRangeInputStyle } from "../../forms/date-range-input/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<DateRangeInput startValue={…} endValue={…} precision="date" />` — paired date fields with optional presets. Maps to `DateRangeInput.Root`. */
export const DateRangeInput: JsxTag<DateRangeInputStyle> = optionsTag(DateRangeInputFactory.Root);
