/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Planner.Point>` / `<Planner.Span>` tags — see the export's JSDoc.
 */

import type { SubtypeExprOrValue, ArrayType, StructType } from "@elaraai/east";
import {
    Planner as PlannerFactory,
    type PlannerConfig,
    type RowElement,
} from "../../collections/planner/index.js";
import type { UIElement } from "../runtime.js";

/**
 * `<Planner.Point>` — schedule grid for instantaneous events, one cell per
 * axis slot. Each row is a resource / stream; `events` places point markers at
 * `Planner.at.*` slots, each carrying a lifecycle `state` (committed /
 * proposed / rejected). The axis (`Planner.axis.number` / `.ordinal` /
 * `.time`), the frozen identity columns, `groupBy`, `markers`, the `now`-line
 * and `density` live on {@link PlannerConfig}; `data` is a flat prop. Use it
 * for rosters, shift plans, and what-if scheduling. Maps to `Planner.Point`.
 */
function PlannerPoint<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: { data: T } & PlannerConfig<RowElement<T>>,
): UIElement {
    const { data, ...config } = props;
    return PlannerFactory.Point(data, config as PlannerConfig<RowElement<T>>);
}

/**
 * `<Planner.Span>` — the span sibling of `<Planner.Point>`: each event spans
 * from `slot` to `endSlot` across the axis (a horizontal bar rather than a
 * point), giving a lightweight swim-lane timeline. Same {@link PlannerConfig}
 * config and event-state grammar as Point, typically over a `Planner.axis.time`
 * axis. Maps to `Planner.Span`.
 */
function PlannerSpan<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: { data: T } & PlannerConfig<RowElement<T>>,
): UIElement {
    const { data, ...config } = props;
    return PlannerFactory.Span(data, config as PlannerConfig<RowElement<T>>);
}

/**
 * Slot-based scheduling grids — resources down the rows, an axis across the
 * columns, with lifecycle-coloured events in the cells. Pick the member by
 * event shape: {@link Planner.Point} for instantaneous events (one cell per
 * slot), {@link Planner.Span} for events that stretch across a range. Use a
 * planner for rosters, capacity plans, and proposed-vs-committed what-if views.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Planner, UIComponentType } from "@elaraai/east-ui";
 *
 * const roster = East.function([], UIComponentType, _$ => (
 *     <Planner.Point
 *         data={[
 *             { name: "api-01", role: "Lead", team: "Web" },
 *             { name: "api-02", role: "Engineer", team: "Web" },
 *         ]}
 *         axis={Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }], range: { min: 1, max: 4 } })}
 *         groupBy={r => r.team}
 *         columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }]}
 *         events={_r => [
 *             Planner.event({ slot: Planner.at.number(1), bucket: "am", label: "✓", state: "committed" }),
 *             Planner.event({ slot: Planner.at.number(3), bucket: "am", label: "plan", state: "added" }),
 *         ]}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries the axis builders (`Planner.axis.number` / `.ordinal` / `.time`), the
 * slot constructors (`Planner.at.number` / `.ordinal` / `.time`), `Planner.event`
 * (an event with slot / state / label / popover), `Planner.marker` (a
 * status-flag ring), and `Planner.Types` (e.g. `Planner.Types.SelectEvent`).
 * Desugars to `Planner.Point(data, config)` / `Planner.Span(data, config)`.
 */
export const Planner: {
    Point: typeof PlannerPoint;
    Span: typeof PlannerSpan;
    axis: typeof PlannerFactory.axis;
    at: typeof PlannerFactory.at;
    event: typeof PlannerFactory.event;
    marker: typeof PlannerFactory.marker;
    Types: typeof PlannerFactory.Types;
} = {
    Point: PlannerPoint,
    Span: PlannerSpan,
    axis: PlannerFactory.axis,
    at: PlannerFactory.at,
    event: PlannerFactory.event,
    marker: PlannerFactory.marker,
    Types: PlannerFactory.Types,
};
