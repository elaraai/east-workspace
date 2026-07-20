/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Calendar>` tag — see the export's JSDoc. */

import { type ExprType, type SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import {
    Calendar as CalendarFactory,
    type CalendarConfig,
    type RowElement,
} from "../../collections/calendar/index.js";
import { UIComponentType } from "../../component.js";

/**
 * `<Calendar>` — a day-of-week × week grid coloured by intensity (forecast,
 * demand, OT exposure). Visualisation only: clicking drills into a day, but
 * there are no events, no committed/proposed state, and no drag & drop. The
 * component owns the week — columns are always Mon–Sun; rows appear in
 * first-appearance order of the `week` field.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Calendar, UIComponentType } from "@elaraai/east-ui";
 *
 * const demand = East.function([], UIComponentType, _$ => (
 *     <Calendar
 *         data={[
 *             { week: "W37", day: "Tue", demand: 102.0, lastYear: 95.0 },
 *             { week: "W37", day: "Wed", demand: 110.0, lastYear: 101.0 },
 *             { week: "W38", day: "Thu", demand: 131.0, lastYear: 112.0 },
 *         ]}
 *         cell={d => ({
 *             week: d.week, day: d.day, value: d.demand, compare: d.lastYear,
 *         })}
 *         totals={Calendar.totals()}
 *         aggregateRow={Calendar.aggregateRow()}
 *         footer={Calendar.footer({ valueLabel: "predicted", compareLabel: "last yr", legend: true })}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Desugars to `Calendar.Root(data, config)`. The `Calendar.scale` / `totals` /
 * `aggregateRow` / `footer` sub-factories are exposed on the tag too.
 */
function CalendarTag<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: { data: T } & CalendarConfig<RowElement<T>>,
): ExprType<UIComponentType> {
    const { data, ...config } = props;
    return CalendarFactory.Root(data, config as CalendarConfig<RowElement<T>>);
}

export const Calendar: typeof CalendarTag & {
    Types: typeof CalendarFactory.Types;
    scale: typeof CalendarFactory.scale;
    totals: typeof CalendarFactory.totals;
    aggregateRow: typeof CalendarFactory.aggregateRow;
    footer: typeof CalendarFactory.footer;
} = Object.assign(CalendarTag, {
    Types: CalendarFactory.Types,
    scale: CalendarFactory.scale,
    totals: CalendarFactory.totals,
    aggregateRow: CalendarFactory.aggregateRow,
    footer: CalendarFactory.footer,
});
