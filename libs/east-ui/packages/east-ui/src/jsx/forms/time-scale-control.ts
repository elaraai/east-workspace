/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Form `<TimeScaleControl value={…}>` tag — time-scale selector. Maps to `TimeScaleControl.Root`. */

import { TimeScaleControl as TimeScaleControlFactory } from "../../forms/time-scale-control/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<TimeScaleControl value="day" />` — time-scale segmented selector. Maps to `TimeScaleControl.Root`. */
export const TimeScaleControl: JsxTag<ValueProps<typeof TimeScaleControlFactory.Root, "value">> =
    leaf(TimeScaleControlFactory.Root, "value");
