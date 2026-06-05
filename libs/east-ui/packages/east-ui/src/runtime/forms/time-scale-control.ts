/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<TimeScaleControl>` tag — see the export's JSDoc.
 */

import { TimeScaleControl as TimeScaleControlFactory } from "../../forms/time-scale-control/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** Types surfaced on the `<TimeScaleControl>` tag (mirrors the `TimeScaleControl` factory namespace). */
type TimeScaleControlBuilders = {
    Types: typeof TimeScaleControlFactory.Types;
};

/**
 * Time-scale segmented selector — a row of segments (minute / hour / day / week /
 * month / quarter / year) for picking the granularity of a time-series view.
 * Reach for it to drive the bucketing of a chart, Gantt or planner. The active
 * scale is the `value` prop; `availableScales` restricts the offered set, and
 * `onChange` carries the picked scale. Supports `variant` and three sizes.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { TimeScaleControl, UIComponentType } from "@elaraai/east-ui";
 *
 * const scale = East.function([], UIComponentType, _$ => (
 *     <TimeScaleControl value="week" availableScales={["day", "week", "month"]} />
 * ));
 * ```
 *
 * @remarks
 * Carries `TimeScaleControl.Types` — in particular `Types.Scale`, the variant
 * type to bind `value`/`onChange` against inside a `<Reactive>` block. Desugars
 * to `TimeScaleControl.Root(value, style)`.
 */
export const TimeScaleControl: JsxTag<ValueProps<typeof TimeScaleControlFactory.Root, "value">> & TimeScaleControlBuilders =
    Object.assign(leaf(TimeScaleControlFactory.Root, "value"), {
        Types: TimeScaleControlFactory.Types,
    });
