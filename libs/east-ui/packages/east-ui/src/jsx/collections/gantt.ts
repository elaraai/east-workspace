/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Collection `<Gantt>` tag — schema-typed gantt chart. Maps to `Gantt.Root`.
 *
 * Generic like `<Table>`, plus a per-row `rowSpec` callback (returning the
 * row's tasks / milestones). `data` / `columns` / `rowSpec` are flat props;
 * the remaining `GanttStyle` fields spread in. The `rowSpec` row parameter
 * mirrors the factory's `ExprType<element of T>` so it stays inferred.
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
 * `<Gantt data={rows} columns={…} rowSpec={…} />` — schema-typed gantt. Maps to
 * `Gantt.Root`. The `Gantt.Task` / `Gantt.Milestone` row-spec builders and
 * `Gantt.Types` (event types) are carried through alongside the tag.
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
