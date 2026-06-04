/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Form `<TimeScaleControl value={…}>` tag — time-scale selector. Maps to
 * `TimeScaleControl.Root`.
 *
 * `Types` is attached to the tag, so a single `TimeScaleControl` import gives
 * both `<TimeScaleControl …/>` and `TimeScaleControl.Types.*` (e.g. the
 * change-detail type for an `onChange` closure) — no separate factory import.
 */

import { TimeScaleControl as TimeScaleControlFactory } from "../../forms/time-scale-control/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** Types surfaced on the `<TimeScaleControl>` tag (mirrors the `TimeScaleControl` factory namespace). */
type TimeScaleControlBuilders = {
    Types: typeof TimeScaleControlFactory.Types;
};

/** `<TimeScaleControl value="day" />` — time-scale segmented selector. Maps to `TimeScaleControl.Root`. */
export const TimeScaleControl: JsxTag<ValueProps<typeof TimeScaleControlFactory.Root, "value">> & TimeScaleControlBuilders =
    Object.assign(leaf(TimeScaleControlFactory.Root, "value"), {
        Types: TimeScaleControlFactory.Types,
    });
