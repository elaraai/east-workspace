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

/** `<Gantt data={rows} columns={["name"]} rowSpec={row => ({ tasks: … })} />` — schema-typed gantt. Maps to `Gantt.Root`. */
export function Gantt<
    T extends SubtypeExprOrValue<ArrayType<StructType>>,
    C extends ColumnSpec<T> = ColumnSpec<T>,
>(
    props: {
        data: T;
        columns: C;
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
