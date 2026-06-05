/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<DateRangeInput>` tag — see the export's JSDoc.
 */

import { DateRangeInput as DateRangeInputFactory, type DateRangeInputStyle } from "../../forms/date-range-input/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * Paired start / end date fields — a single control for picking a from–to date
 * range with optional quick presets. Reach for it to scope a report or query to a
 * window. `precision` switches between date-only and date+time; `startValue` /
 * `endValue` are the two endpoints; `presets` adds one-click ranges (Last 7 days,
 * MTD, YTD, …). `onChange` carries both endpoints together. See {@link DateRangeInputStyle}.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, DateTimeType } from "@elaraai/east";
 * import { DateRangeInput, UIComponentType } from "@elaraai/east-ui";
 *
 * const range = East.function([], UIComponentType, $ => {
 *     const start = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
 *     const end = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
 *     return <DateRangeInput startValue={start} endValue={end} precision="date" />;
 * });
 * ```
 *
 * @remarks
 * Carries `DateRangeInput.Types`. Bind both endpoints to state and wire the
 * two-arg `onChange` inside a `<Reactive>` block for a live range. Desugars to
 * `DateRangeInput.Root(options)`.
 */
export const DateRangeInput: JsxTag<DateRangeInputStyle> & { Types: typeof DateRangeInputFactory.Types } =
    Object.assign(optionsTag(DateRangeInputFactory.Root), { Types: DateRangeInputFactory.Types });
