/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Gantt>` tag — see the export's JSDoc.
 */

import type { SubtypeExprOrValue, ArrayType, StructType, ExprType, TypeOf } from "@elaraai/east";
import {
    Gantt as GanttFactory,
    type ColumnSpec,
    type DataFieldKeys,
    type GanttStyle,
    type GanttTaskType,
    type GanttMilestoneType,
} from "../../collections/gantt/index.js";
import { hasKeys } from "../combinators.js";
import type { UIElement } from "../runtime.js";

/**
 * `<Gantt data={rows} columns={["name"]} rowSpec={row => ({ tasks: … })} />` —
 * schema-typed gantt. Maps to `Gantt.Root`. `columns` is typed directly as
 * `ColumnSpec<T>` (not an inferred generic) so an object-form column map gets
 * excess-property checked — a key that is not a data field is a type error.
 */
function GanttTag<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    props: {
        data: T;
        columns: ColumnSpec<T>;
        rowSpec: (row: ExprType<TypeOf<T> extends ArrayType<infer E> ? E : never>) => {
            tasks?: SubtypeExprOrValue<ArrayType<GanttTaskType>>;
            milestones?: SubtypeExprOrValue<ArrayType<GanttMilestoneType>>;
        };
    } & GanttStyle<DataFieldKeys<T>>,
): UIElement {
    const { data, columns, rowSpec, ...style } = props;
    return GanttFactory.Root(
        data,
        columns,
        rowSpec,
        (hasKeys(style) ? style : undefined) as GanttStyle<DataFieldKeys<T>>,
    );
}

/**
 * Schema-typed Gantt chart — a frozen identity grid on the left, a time axis on
 * the right. Each data row becomes a chart row whose bars and diamonds come from
 * `rowSpec`: it returns the row's tasks and milestones built from the row's
 * fields. `columns` is the left-grid column list / config ({@link ColumnSpec}),
 * and the remaining display options (the `axis` window/tier/format, `striped`,
 * `showToday` now-line, `density`, `frozen` columns, `rowStatus`, drag steps,
 * interaction callbacks) are flat ({@link GanttStyle}). Use it for project plans,
 * roadmaps, and sprint timelines.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Gantt, UIComponentType } from "@elaraai/east-ui";
 *
 * const plan = East.function([], UIComponentType, _$ => (
 *     <Gantt
 *         data={[
 *             { task: "Planning", owner: "Alice", start: new Date("2024-01-01"), end: new Date("2024-01-15") },
 *             { task: "Design", owner: "Bob", start: new Date("2024-01-10"), end: new Date("2024-02-01") },
 *         ]}
 *         columns={["task", "owner"]}
 *         rowSpec={row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `Gantt.Task` (a duration bar — start/end, label, progress, status,
 * popover) and `Gantt.Milestone` (a point diamond — date, label, kind) for use
 * inside `rowSpec`, plus `Gantt.Types` for the task / milestone event types
 * (`Gantt.Types.TaskClickEvent`, `Gantt.Types.TaskDragEvent`,
 * `Gantt.Types.MilestoneClickEvent`, …; left-grid clicks use the shared
 * `Table.Types.*` events). Desugars to `Gantt.Root(data, columns, rowSpec, style)`.
 */
export const Gantt: typeof GanttTag & {
    Task: typeof GanttFactory.Task;
    Milestone: typeof GanttFactory.Milestone;
    Types: typeof GanttFactory.Types;
} = Object.assign(GanttTag, {
    Task: GanttFactory.Task,
    Milestone: GanttFactory.Milestone,
    Types: GanttFactory.Types,
});
