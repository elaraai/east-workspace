/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Form `<TimeRangeInput>` tag — paired start / end time-of-day fields. Maps to `TimeRangeInput.Root`. */

import { TimeRangeInput as TimeRangeInputFactory, type TimeRangeInputStyle } from "../../forms/time-range-input/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<TimeRangeInput startValue={360n} endValue={840n} step={15n} />` — paired time-of-day fields (minutes since midnight). Maps to `TimeRangeInput.Root`. */
export const TimeRangeInput: JsxTag<TimeRangeInputStyle> = optionsTag(TimeRangeInputFactory.Root);
