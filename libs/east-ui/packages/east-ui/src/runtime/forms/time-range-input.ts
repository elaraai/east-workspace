/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<TimeRangeInput>` tag — see the export's JSDoc.
 */

import { TimeRangeInput as TimeRangeInputFactory, type TimeRangeInputStyle } from "../../forms/time-range-input/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * Paired start / end time-of-day fields — a from–to picker for a within-day
 * window (a work shift, an opening period). Reach for it when only the clock time
 * matters, not the date. `startValue` / `endValue` are minutes since midnight,
 * `step` quantises the picker, and `presets` adds named shift ranges. `onChange`
 * carries both endpoints together. See {@link TimeRangeInputStyle}.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, IntegerType } from "@elaraai/east";
 * import { TimeRangeInput, UIComponentType } from "@elaraai/east-ui";
 *
 * const shift = East.function([], UIComponentType, $ => {
 *     const start = $.let(360n, IntegerType);
 *     const end = $.let(840n, IntegerType);
 *     return <TimeRangeInput startValue={start} endValue={end} step={15n} />;
 * });
 * ```
 *
 * @remarks
 * Carries `TimeRangeInput.Types`. Bind both endpoints to state and wire the
 * two-arg `onChange` inside a `<Reactive>` block for a live range. Desugars to
 * `TimeRangeInput.Root(options)`.
 */
export const TimeRangeInput: JsxTag<TimeRangeInputStyle> & { Types: typeof TimeRangeInputFactory.Types } =
    Object.assign(optionsTag(TimeRangeInputFactory.Root), { Types: TimeRangeInputFactory.Types });
